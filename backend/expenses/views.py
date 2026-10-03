from django.db import DatabaseError
from django.http import JsonResponse
from django.views.decorators.http import require_GET
from rest_framework.generics import ListAPIView

from expenses.models import Participant
from expenses.serializers import ParticipantSerializer


class ParticipantList(ListAPIView):
    queryset = Participant.objects.order_by("name", "id")
    serializer_class = ParticipantSerializer


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
