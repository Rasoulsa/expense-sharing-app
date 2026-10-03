from django.urls import path

from expenses.views import ParticipantList, live, ready

urlpatterns = [
    path("api/participants/", ParticipantList.as_view(), name="participants"),
    path("health/live/", live, name="live"),
    path("health/ready/", ready, name="ready"),
]
