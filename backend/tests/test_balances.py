from decimal import Decimal

import pytest
from django.test import Client

from expenses.models import Expense, Participant
from expenses.services import calculate_balances

pytestmark = pytest.mark.django_db


@pytest.fixture
def participants():
    # Names deliberately differ from ID order.
    return [Participant.objects.create(name=name) for name in ["Zoe", "Aaron", "Maya", "Bob"]]


def expected_rows(participants, debts):
    return [
        {
            "debtor": {"id": participants[debtor].id, "name": participants[debtor].name},
            "creditor": {"id": participants[creditor].id, "name": participants[creditor].name},
            "amount": amount,
        }
        for debtor, creditor, amount in debts
    ]


@pytest.mark.parametrize(
    ("payments", "debts"),
    [
        ([(0, 1, 1234)], [(1, 0, "12.34")]),
        ([(1, 0, 1)], [(0, 1, "0.01")]),
        ([(0, 1, 1234), (0, 1, 1)], [(1, 0, "12.35")]),
        ([(0, 1, 5000), (1, 0, 2000)], [(1, 0, "30.00")]),
        ([(0, 1, 2000), (1, 0, 5000)], [(0, 1, "30.00")]),
        ([(0, 1, 2000), (0, 1, 3000), (1, 0, 5000)], []),
        ([(0, 1, 500), (2, 3, 700)], [(1, 0, "5.00"), (3, 2, "7.00")]),
        ([(0, 1, 500), (0, 2, 700)], [(1, 0, "5.00"), (2, 0, "7.00")]),
        ([(0, 1, 500), (1, 0, 500), (2, 3, 700)], [(3, 2, "7.00")]),
        ([(1, 0, 5000), (2, 1, 5000)], [(0, 1, "50.00"), (1, 2, "50.00")]),
        (
            [(1, 0, 5000), (2, 1, 5000), (0, 2, 5000)],
            [(0, 1, "50.00"), (1, 2, "50.00"), (2, 0, "50.00")],
        ),
        (
            [(3, 2, 700), (3, 0, 300), (2, 1, 100), (1, 0, 500)],
            [(0, 1, "5.00"), (0, 3, "3.00"), (1, 2, "1.00"), (2, 3, "7.00")],
        ),
        ([(0, 1, 99999999), (0, 1, 99999999)], [(1, 0, "1999999.98")]),
    ],
    ids=[
        "single",
        "higher-id-payer",
        "repeated",
        "reverse-partial",
        "reverse-flips-debt",
        "exact-cancellation",
        "independent-pairs",
        "shared-participant",
        "cancelled-pair-omitted",
        "no-transitive-simplification",
        "cycle-remains",
        "debtor-then-creditor-id-order",
        "total-exceeds-single-expense-cap",
    ],
)
def test_pairwise_balances(client, participants, payments, debts):
    for payer, beneficiary, cents in payments:
        Expense.objects.create(
            paid_by=participants[payer],
            expense_for=participants[beneficiary],
            amount_cents=cents,
            description="Persisted expense",
        )

    assert calculate_balances() == [
        {
            "debtor": participants[debtor],
            "creditor": participants[creditor],
            "amount_cents": int(Decimal(amount) * 100),
        }
        for debtor, creditor, amount in debts
    ]
    response = client.get("/api/balances/")
    assert response.status_code == 200
    assert response.json() == expected_rows(participants, debts)


@pytest.mark.parametrize("seeded", [False, True])
def test_empty_balances_are_anonymous(client, seeded):
    if seeded:
        Participant.objects.create(name="Alice")
        Participant.objects.create(name="Bob")
    assert calculate_balances() == []
    response = client.get("/api/balances/")
    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.parametrize("method", ["post", "put", "patch", "delete", "head", "options", "trace"])
def test_balances_reject_other_methods(client, participants, method):
    expense = Expense.objects.create(
        paid_by=participants[0], expense_for=participants[1], amount_cents=1234
    )
    before = list(Expense.objects.values())
    response = getattr(client, method)("/api/balances/")
    assert response.status_code == 405
    assert list(Expense.objects.values()) == before
    expense.refresh_from_db()
    assert expense.amount_cents == 1234


def test_requery_preserves_expenses_and_reads_new_persisted_payments(participants):
    client = Client(enforce_csrf_checks=True)
    payload = {
        "paid_by": participants[0].id,
        "expense_for": participants[1].id,
        "amount": "50.00",
        "description": "Lunch",
    }
    created = client.post("/api/expenses/", data=payload, content_type="application/json")
    assert created.status_code == 201
    before = list(Expense.objects.values())
    expected = expected_rows(participants, [(1, 0, "50.00")])
    for _ in range(2):
        response = Client(enforce_csrf_checks=True).get("/api/balances/")
        assert response.status_code == 200
        assert response.json() == expected
    assert list(Expense.objects.values()) == before
    assert client.get("/api/expenses/").json() == [created.json()]

    reverse = client.post(
        "/api/expenses/",
        data={
            **payload,
            "paid_by": participants[1].id,
            "expense_for": participants[0].id,
            "amount": "20.00",
        },
        content_type="application/json",
    )
    assert reverse.status_code == 201
    response = Client().get("/api/balances/")
    assert response.status_code == 200
    assert response.json() == expected_rows(participants, [(1, 0, "30.00")])
    assert Expense.objects.count() == 2
    assert Expense.objects.filter(id=created.json()["id"]).values().get() == before[0]
