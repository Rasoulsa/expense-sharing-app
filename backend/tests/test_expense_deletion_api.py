import pytest
from django.test import Client

from expenses.models import Expense, Participant

pytestmark = pytest.mark.django_db


@pytest.fixture
def opposing_expenses():
    alice = Participant.objects.create(name="Alice")
    bob = Participant.objects.create(name="Bob")
    charlie = Participant.objects.create(name="Charlie")
    forward = Expense.objects.create(
        paid_by=alice, expense_for=bob, amount_cents=5000, description="Shared lunch"
    )
    reverse = Expense.objects.create(
        paid_by=bob, expense_for=alice, amount_cents=2000, description="Return payment"
    )
    Expense.objects.create(
        paid_by=alice, expense_for=charlie, amount_cents=700, description="Coffee"
    )
    return forward, reverse


@pytest.mark.parametrize(
    ("removed_index", "debtor", "creditor", "amount"),
    [(0, "Alice", "Bob", "20.00"), (1, "Bob", "Alice", "50.00")],
)
def test_anonymous_deletion_removes_only_one_expense_and_recalculates_pair(
    opposing_expenses, removed_index, debtor, creditor, amount
):
    client = Client(enforce_csrf_checks=True)
    removed = opposing_expenses[removed_index]
    participants_before = list(Participant.objects.values())
    expenses_before = client.get("/api/expenses/").json()
    balances_before = client.get("/api/balances/").json()
    assert [
        (balance["debtor"]["name"], balance["creditor"]["name"], balance["amount"])
        for balance in balances_before
    ] == [("Bob", "Alice", "30.00"), ("Charlie", "Alice", "7.00")]

    response = client.delete(f"/api/expenses/{removed.id}/")

    assert response.status_code == 204
    assert response.content == b""
    assert list(Participant.objects.values()) == participants_before
    assert client.get("/api/expenses/").json() == [
        expense for expense in expenses_before if expense["id"] != removed.id
    ]
    assert [
        (balance["debtor"]["name"], balance["creditor"]["name"], balance["amount"])
        for balance in client.get("/api/balances/").json()
    ] == [(debtor, creditor, amount), ("Charlie", "Alice", "7.00")]


def test_unknown_expense_returns_404_without_changing_data(client, opposing_expenses):
    expenses_before = list(Expense.objects.values())
    participants_before = list(Participant.objects.values())
    balances_before = client.get("/api/balances/").json()
    response = client.delete("/api/expenses/999999/")
    assert response.status_code == 404
    assert response.json()["detail"]
    assert list(Expense.objects.values()) == expenses_before
    assert list(Participant.objects.values()) == participants_before
    assert client.get("/api/balances/").json() == balances_before


def test_repeated_deletion_returns_404_and_preserves_remaining_expenses(client, opposing_expenses):
    endpoint = f"/api/expenses/{opposing_expenses[0].id}/"
    assert client.delete(endpoint).status_code == 204
    remaining = list(Expense.objects.values())
    assert client.delete(endpoint).status_code == 404
    assert list(Expense.objects.values()) == remaining


@pytest.mark.parametrize("method", ["get", "post", "put", "patch", "head", "trace"])
def test_expense_detail_rejects_other_methods(client, opposing_expenses, method):
    before = list(Expense.objects.values())
    response = getattr(client, method)(f"/api/expenses/{opposing_expenses[0].id}/")
    assert response.status_code == 405
    assert list(Expense.objects.values()) == before
