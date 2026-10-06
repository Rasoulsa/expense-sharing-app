from unittest.mock import patch

import pytest
from django.db import OperationalError, connection

from expenses.models import Expense, Occasion, Participant


@pytest.mark.django_db
def test_participants_get_is_anonymous_and_stably_ordered(client):
    bob = Participant.objects.create(name="Bob")
    alice = Participant.objects.create(name="Alice")
    expected = [{"id": alice.id, "name": "Alice"}, {"id": bob.id, "name": "Bob"}]
    for _ in range(2):
        response = client.get("/api/participants/")
        assert response.status_code == 200
        assert response.json() == expected


@pytest.mark.django_db
def test_participants_empty_list(client):
    response = client.get("/api/participants/")
    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.django_db
@pytest.mark.parametrize("method", ["post", "put", "patch", "delete", "trace"])
def test_participants_reject_writes_and_preserve_existing_data(client, method):
    alice = Participant.objects.create(name="Alice")
    eve = Participant.objects.create(name="Eve")
    Expense.objects.create(paid_by=alice, expense_for=eve, amount_cents=500)
    participants_before = list(Participant.objects.values())
    expenses_before = list(Expense.objects.values())
    balances_before = client.get("/api/balances/").json()
    response = getattr(client, method)(
        "/api/participants/", data='{"name":"Eve"}', content_type="application/json"
    )
    assert response.status_code == 405
    assert list(Participant.objects.values()) == participants_before
    assert list(Expense.objects.values()) == expenses_before
    assert client.get("/api/balances/").json() == balances_before


def test_liveness_without_database_access(client):
    with patch.object(connection, "cursor", side_effect=AssertionError("Database accessed")):
        response = client.get("/health/live/")
    assert response.status_code == 200
    assert response.json() == {"status": "alive"}


@pytest.mark.django_db
def test_readiness_with_empty_usable_tables(client):
    response = client.get("/health/ready/")
    assert response.status_code == 200
    assert response.json() == {"status": "ready"}


@pytest.mark.django_db
def test_readiness_with_unavailable_database(client):
    with patch.object(connection, "ensure_connection", side_effect=OperationalError("unavailable")):
        response = client.get("/health/ready/")
    assert response.status_code == 503
    assert response.json() == {"status": "not_ready"}


@pytest.mark.django_db
@pytest.mark.parametrize("model", [Participant, Occasion, Expense])
def test_readiness_with_missing_schema(client, monkeypatch, model):
    monkeypatch.setattr(model._meta, "db_table", "missing_table")
    response = client.get("/health/ready/")
    assert response.status_code == 503
    assert response.json() == {"status": "not_ready"}


@pytest.mark.django_db
def test_readiness_with_missing_expense_occasion_column(client, monkeypatch):
    monkeypatch.setattr(Expense._meta.get_field("occasion"), "column", "missing_occasion_id")
    response = client.get("/health/ready/")
    assert response.status_code == 503
    assert response.json() == {"status": "not_ready"}


@pytest.mark.django_db
def test_readiness_with_missing_occasion_canonical_column(client, monkeypatch):
    monkeypatch.setattr(Occasion._meta.get_field("canonical_name"), "column", "missing_key")
    response = client.get("/health/ready/")
    assert response.status_code == 503
    assert response.json() == {"status": "not_ready"}
    assert client.get("/health/live/").status_code == 200
