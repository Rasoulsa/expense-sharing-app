from django.db import DatabaseError
from django.http import JsonResponse
from django.views.decorators.http import require_GET
from rest_framework.generics import DestroyAPIView, ListAPIView, ListCreateAPIView
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from expenses.models import Expense, Occasion, Participant
from expenses.serializers import (
    BalanceSerializer,
    ExpenseSerializer,
    OccasionFilterSerializer,
    OccasionSerializer,
    ParticipantSerializer,
)
from expenses.services import calculate_balances


class ParticipantList(ListAPIView):
    queryset = Participant.objects.order_by("name", "id")
    serializer_class = ParticipantSerializer
    permission_classes = [AllowAny]
    http_method_names = ["get", "head", "options"]


class OccasionListCreate(ListCreateAPIView):
    queryset = Occasion.objects.order_by("name", "id")
    serializer_class = OccasionSerializer
    permission_classes = [AllowAny]
    http_method_names = ["get", "post", "head", "options"]


class ExpenseListCreate(ListCreateAPIView):
    queryset = Expense.objects.select_related("paid_by", "expense_for", "occasion").order_by(
        "-created_at", "-id"
    )
    serializer_class = ExpenseSerializer
    permission_classes = [AllowAny]
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        queryset = super().get_queryset()
        filters = OccasionFilterSerializer(data=self.request.query_params.dict())
        filters.is_valid(raise_exception=True)
        if "occasion" in filters.validated_data:
            queryset = queryset.filter(occasion_id=filters.validated_data["occasion"])
        return queryset


class ExpenseDelete(DestroyAPIView):
    queryset = Expense.objects.all()
    serializer_class = ExpenseSerializer
    permission_classes = [AllowAny]
    http_method_names = ["delete", "options"]


class BalanceList(APIView):
    permission_classes = [AllowAny]
    http_method_names = ["get"]

    def get(self, request):
        filters = OccasionFilterSerializer(data=request.query_params.dict())
        filters.is_valid(raise_exception=True)
        balances = calculate_balances(occasion_id=filters.validated_data.get("occasion"))
        return Response(BalanceSerializer(balances, many=True).data)


@require_GET
def live(request):
    return JsonResponse({"status": "alive"})


@require_GET
def ready(request):
    try:
        # Empty tables are ready too; select new columns to catch partial migrations.
        Participant.objects.exists()
        Occasion.objects.values_list("canonical_name", flat=True).first()
        Expense.objects.values_list("occasion_id", flat=True).first()
    except DatabaseError:
        return JsonResponse({"status": "not_ready"}, status=503)
    return JsonResponse({"status": "ready"})
