from unittest.mock import patch

import pytest
from django.db import OperationalError, connection

from expenses.models import Participant


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
@pytest.mark.parametrize("method", ["post", "put", "patch", "delete"])
def test_participants_reject_writes(client, method):
    response = getattr(client, method)(
        "/api/participants/", data='{"name":"Eve"}', content_type="application/json"
    )
    assert response.status_code == 405
    assert Participant.objects.count() == 0


def test_liveness_without_database_access(client):
    with patch.object(connection, "cursor", side_effect=AssertionError("Database accessed")):
        response = client.get("/health/live/")
    assert response.status_code == 200
    assert response.json() == {"status": "alive"}


@pytest.mark.django_db
def test_readiness_with_empty_usable_table(client):
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
def test_readiness_with_missing_schema(client, monkeypatch):
    monkeypatch.setattr(Participant._meta, "db_table", "missing_participant_table")
    response = client.get("/health/ready/")
    assert response.status_code == 503
    assert response.json() == {"status": "not_ready"}
