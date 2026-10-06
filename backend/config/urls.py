from django.urls import path

from expenses.views import (
    BalanceList,
    ExpenseDelete,
    ExpenseListCreate,
    OccasionListCreate,
    ParticipantList,
    live,
    ready,
)

urlpatterns = [
    path("api/participants/", ParticipantList.as_view(), name="participants"),
    path("api/occasions/", OccasionListCreate.as_view(), name="occasions"),
    path("api/expenses/", ExpenseListCreate.as_view(), name="expenses"),
    path("api/expenses/<int:pk>/", ExpenseDelete.as_view(), name="expense-delete"),
    path("api/balances/", BalanceList.as_view(), name="balances"),
    path("health/live/", live, name="live"),
    path("health/ready/", ready, name="ready"),
]
