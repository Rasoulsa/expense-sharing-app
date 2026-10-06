from decimal import Decimal

import pytest
from django.test import Client

from expenses.models import Expense, Occasion, Participant
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


def test_balances_are_global_by_default_and_recomputed_for_each_occasion(client, participants):
    dinner = Occasion.objects.create(name="Dinner")
    trip = Occasion.objects.create(name="Trip")
    for payer, beneficiary, cents, occasion in [
        (0, 1, 5000, dinner),
        (1, 0, 2000, trip),
        (1, 0, 500, None),
        (1, 2, 2500, trip),
        (2, 0, 1000, dinner),
    ]:
        Expense.objects.create(
            paid_by=participants[payer],
            expense_for=participants[beneficiary],
            amount_cents=cents,
            occasion=occasion,
        )
    before = list(Expense.objects.values())
    expected = expected_rows(participants, [(0, 2, "10.00"), (1, 0, "25.00"), (2, 1, "25.00")])
    # A chain and cycle still keep separate pair debts, even across different occasions.
    assert client.get("/api/balances/").json() == expected
    for occasion, debts in [
        (dinner, [(0, 2, "10.00"), (1, 0, "50.00")]),
        (trip, [(0, 1, "20.00"), (2, 1, "25.00")]),
    ]:
        assert client.get("/api/expenses/", {"occasion": occasion.id}).status_code == 200
        assert client.get("/api/balances/", {"occasion": occasion.id}).json() == expected_rows(
            participants, debts
        )
    empty = Occasion.objects.create(name="Empty")
    assert client.get("/api/balances/", {"occasion": empty.id}).json() == []
    assert client.get("/api/balances/", {"occasion": 999999}).json() == []
    assert client.get("/api/balances/").json() == expected
    assert list(Expense.objects.values()) == before


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


@pytest.mark.parametrize(
    "occasion_id",
    ["", "0", "-1", "1.0", "1e0", "true", "null", " 1 ", "1\n", "١", str(2**63), "9" * 100],
)
def test_balance_filter_validation_matches_expense_filter(client, participants, occasion_id):
    Expense.objects.create(paid_by=participants[0], expense_for=participants[1], amount_cents=100)
    before = list(Expense.objects.values())
    balances = client.get("/api/balances/", {"occasion": occasion_id})
    expenses = client.get("/api/expenses/", {"occasion": occasion_id})
    assert balances.status_code == expenses.status_code == 400
    assert balances.json() == expenses.json()
    assert set(balances.json()) == {"occasion"}
    assert list(Expense.objects.values()) == before


def test_filtered_balances_keep_pairs_that_cancel_globally_and_refresh_after_deletion(
    client, participants
):
    birthday = Occasion.objects.create(name="Birthday")
    trip = Occasion.objects.create(name="Trip")
    forward = Expense.objects.create(
        paid_by=participants[0], expense_for=participants[1], amount_cents=5000, occasion=birthday
    )
    Expense.objects.create(
        paid_by=participants[1], expense_for=participants[0], amount_cents=5000, occasion=trip
    )
    assert client.get("/api/balances/").json() == []
    assert client.get("/api/balances/", {"occasion": birthday.id}).json() == expected_rows(
        participants, [(1, 0, "50.00")]
    )
    assert client.get("/api/balances/", {"occasion": trip.id}).json() == expected_rows(
        participants, [(0, 1, "50.00")]
    )
    assert calculate_balances(occasion_id=birthday.id)[0]["amount_cents"] == 5000
    assert client.delete(f"/api/expenses/{forward.id}/").status_code == 204
    assert client.get("/api/balances/", {"occasion": birthday.id}).json() == []
    assert (
        client.get("/api/balances/").json()
        == client.get("/api/balances/", {"occasion": trip.id}).json()
    )


def test_ungrouped_expense_cancels_global_pair_but_not_occasion_pair(client):
    alice = Participant.objects.create(name="Alice")
    charlie = Participant.objects.create(name="Charlie")
    birthday = Occasion.objects.create(name="Birthday")
    Expense.objects.create(paid_by=charlie, expense_for=alice, amount_cents=5000, occasion=birthday)
    historical = Expense.objects.create(paid_by=alice, expense_for=charlie, amount_cents=5000)

    assert client.get("/api/balances/").json() == []
    assert client.get("/api/balances/", {"occasion": birthday.id}).json() == [
        {
            "debtor": {"id": alice.id, "name": "Alice"},
            "creditor": {"id": charlie.id, "name": "Charlie"},
            "amount": "50.00",
        }
    ]
    historical.refresh_from_db()
    assert historical.occasion_id is None
    assert Expense.objects.count() == 2
