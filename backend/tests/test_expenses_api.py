import json
from datetime import datetime, timedelta

import pytest
from django.test import Client
from django.utils import timezone

from expenses.models import Expense, Participant

pytestmark = pytest.mark.django_db


@pytest.fixture
def expense_payload():
    payer = Participant.objects.create(name="Alice")
    beneficiary = Participant.objects.create(name="Bob")
    return {
        "paid_by": payer.id,
        "expense_for": beneficiary.id,
        "amount": "12.34",
        "description": "Lunch",
    }


def post_expense(client, payload):
    return client.post("/api/expenses/", data=payload, content_type="application/json")


def assert_field_error(response, field):
    assert response.status_code == 400
    assert response.json()[field]
    assert Expense.objects.count() == 0


def test_anonymous_creation_and_listing(expense_payload):
    client = Client(enforce_csrf_checks=True)
    payload = {
        **expense_payload,
        "description": " \tLunch\n ",
        "created_at": "2000-01-01T00:00:00Z",
        "id": 987654,
        "amount_cents": 1,
    }
    before = timezone.now()
    with timezone.override("Asia/Tehran"):
        response = post_expense(client, payload)
        assert response.status_code == 201
        expense = Expense.objects.get()
        created_at = datetime.fromisoformat(response.json()["created_at"])
        assert before <= created_at <= timezone.now()
        assert created_at.utcoffset() == timedelta(0)
        assert response.json()["created_at"].endswith("Z")
        assert expense.created_at == created_at
        assert expense.amount_cents == 1234
        assert expense.id != payload["id"]
        expected = {
            "id": expense.id,
            "paid_by": {"id": expense_payload["paid_by"], "name": "Alice"},
            "expense_for": {"id": expense_payload["expense_for"], "name": "Bob"},
            "amount": "12.34",
            "description": "Lunch",
            "created_at": response.json()["created_at"],
        }
        assert response.json() == expected
        listing = client.get("/api/expenses/")
        assert listing.status_code == 200
        assert listing.json() == [expected]


def test_empty_expense_list(client):
    response = client.get("/api/expenses/")
    assert response.status_code == 200
    assert response.json() == []


def test_list_orders_by_descending_timestamp_then_id(client, expense_payload):
    ids = [post_expense(client, expense_payload).json()["id"] for _ in range(3)]
    timestamp = timezone.now()
    Expense.objects.filter(id__in=ids[:2]).update(created_at=timestamp)
    Expense.objects.filter(id=ids[2]).update(created_at=timestamp - timedelta(days=1))
    for _ in range(2):
        response = client.get("/api/expenses/")
        assert response.status_code == 200
        assert [item["id"] for item in response.json()] == [ids[1], ids[0], ids[2]]


@pytest.mark.parametrize("method", ["put", "patch", "delete", "trace"])
def test_expenses_reject_other_methods(client, expense_payload, method):
    created = post_expense(client, expense_payload)
    assert created.status_code == 201
    response = getattr(client, method)(
        "/api/expenses/", data=expense_payload, content_type="application/json"
    )
    assert response.status_code == 405
    assert Expense.objects.count() == 1
    assert client.get("/api/expenses/").json() == [created.json()]


@pytest.mark.parametrize("field", ["paid_by", "expense_for", "amount", "description"])
def test_required_fields(client, expense_payload, field):
    del expense_payload[field]
    assert_field_error(post_expense(client, expense_payload), field)


@pytest.mark.parametrize("field", ["paid_by", "expense_for"])
@pytest.mark.parametrize("participant", [999999, 0, -1, None, "missing", {"id": 1}])
def test_invalid_participants(client, expense_payload, field, participant):
    expense_payload[field] = participant
    assert_field_error(post_expense(client, expense_payload), field)


@pytest.mark.parametrize("field", ["paid_by", "expense_for"])
@pytest.mark.parametrize(
    "invalid_json_id",
    [
        "ID.9",
        "ID.0",
        "IDe0",
        "true",
        "false",
        '"ID.9"',
        '"ID.0"',
        '"ID"',
        '"missing"',
        '""',
        "null",
        "[]",
        '{"id":ID}',
    ],
)
def test_noninteger_participant_ids_leave_expenses_and_balances_unchanged(
    client, expense_payload, field, invalid_json_id
):
    created = post_expense(client, expense_payload)
    assert created.status_code == 201
    expenses_before = list(Expense.objects.values())
    balances_before = client.get("/api/balances/")
    assert balances_before.status_code == 200
    assert balances_before.json()

    participant_id = expense_payload[field]
    expense_payload[field] = json.loads(invalid_json_id.replace("ID", str(participant_id)))
    response = post_expense(client, expense_payload)

    assert response.status_code == 400
    assert set(response.json()) == {field}
    assert response.json()[field]
    assert Expense.objects.count() == len(expenses_before)
    assert list(Expense.objects.values()) == expenses_before
    balances_after = client.get("/api/balances/")
    assert balances_after.status_code == 200
    assert balances_after.json() == balances_before.json()


def test_same_participant_is_rejected(client, expense_payload):
    expense_payload["expense_for"] = expense_payload["paid_by"]
    assert_field_error(post_expense(client, expense_payload), "expense_for")


@pytest.mark.parametrize("description", ["", " \t\n ", "x" * 501, None])
def test_invalid_descriptions(client, expense_payload, description):
    expense_payload["description"] = description
    assert_field_error(post_expense(client, expense_payload), "description")


def test_description_model_limit_after_trimming(client, expense_payload):
    limit = Expense._meta.get_field("description").max_length
    expense_payload["description"] = " \t" + "x" * limit + "\n "
    response = post_expense(client, expense_payload)
    assert response.status_code == 201
    assert response.json()["description"] == "x" * limit
    assert Expense.objects.get().description == "x" * limit


@pytest.mark.parametrize(
    ("amount", "cents", "formatted"),
    [
        ("0.01", 1, "0.01"),
        ("0.1", 10, "0.10"),
        ("0.29", 29, "0.29"),
        ("1", 100, "1.00"),
        ("12.3", 1230, "12.30"),
        ("999999.99", 99999999, "999999.99"),
    ],
)
def test_valid_money_boundaries(client, expense_payload, amount, cents, formatted):
    expense_payload["amount"] = amount
    response = post_expense(client, expense_payload)
    assert response.status_code == 201
    assert response.json()["amount"] == formatted
    assert Expense.objects.get().amount_cents == cents
    assert client.get("/api/expenses/").json()[0]["amount"] == formatted


@pytest.mark.parametrize(
    "amount",
    [
        1,
        12.34,
        0,
        True,
        None,
        [],
        {},
        "",
        "0",
        "0.00",
        "-0.01",
        "-1",
        "0.001",
        "1.230",
        "999999.999",
        "1000000",
        "1000000.00",
        "1e2",
        "1E+2",
        "1e-2",
        "NaN",
        "Infinity",
        "+1.00",
        ".50",
        "1.",
        "1,000.00",
        " 1.00 ",
        "1.00\n",
        "١.٠٠",
    ],
)
def test_invalid_money(client, expense_payload, amount):
    expense_payload["amount"] = amount
    assert_field_error(post_expense(client, expense_payload), "amount")


def test_numeric_json_exponent_is_rejected(client, expense_payload):
    response = client.post(
        "/api/expenses/",
        data=(
            f'{{"paid_by":{expense_payload["paid_by"]},'
            f'"expense_for":{expense_payload["expense_for"]},'
            '"amount":1e2,"description":"Lunch"}'
        ),
        content_type="application/json",
    )
    assert_field_error(response, "amount")
