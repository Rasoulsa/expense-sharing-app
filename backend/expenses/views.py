from django.db import DatabaseError
from django.http import JsonResponse
from django.views.decorators.http import require_GET
from rest_framework.generics import DestroyAPIView, ListCreateAPIView
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from expenses.models import Expense, Participant
from expenses.serializers import BalanceSerializer, ExpenseSerializer, ParticipantSerializer
from expenses.services import calculate_balances


class ParticipantList(ListCreateAPIView):
    queryset = Participant.objects.order_by("name", "id")
    serializer_class = ParticipantSerializer
    permission_classes = [AllowAny]
    http_method_names = ["get", "post", "head", "options"]


class ExpenseListCreate(ListCreateAPIView):
    queryset = Expense.objects.select_related("paid_by", "expense_for").order_by(
        "-created_at", "-id"
    )
    serializer_class = ExpenseSerializer
    permission_classes = [AllowAny]
    http_method_names = ["get", "post", "head", "options"]


class ExpenseDelete(DestroyAPIView):
    queryset = Expense.objects.all()
    serializer_class = ExpenseSerializer
    permission_classes = [AllowAny]
    http_method_names = ["delete", "options"]


class BalanceList(APIView):
    permission_classes = [AllowAny]
    http_method_names = ["get"]

    def get(self, request):
        return Response(BalanceSerializer(calculate_balances(), many=True).data)


@require_GET
def live(request):
    return JsonResponse({"status": "alive"})


@require_GET
def ready(request):
    try:
        # An empty result still proves that the connection and table are usable.
        Participant.objects.exists()
    except DatabaseError:
        return JsonResponse({"status": "not_ready"}, status=503)
    return JsonResponse({"status": "ready"})
