from django.urls import path

from expenses.views import BalanceList, ExpenseListCreate, ParticipantList, live, ready

urlpatterns = [
    path("api/participants/", ParticipantList.as_view(), name="participants"),
    path("api/expenses/", ExpenseListCreate.as_view(), name="expenses"),
    path("api/balances/", BalanceList.as_view(), name="balances"),
    path("health/live/", live, name="live"),
    path("health/ready/", ready, name="ready"),
]
