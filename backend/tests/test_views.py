import json
from contextlib import nullcontext
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
@pytest.mark.parametrize("method", ["put", "patch", "delete"])
def test_participants_reject_edit_and_delete(client, method):
    response = getattr(client, method)(
        "/api/participants/", data='{"name":"Eve"}', content_type="application/json"
    )
    assert response.status_code == 405
    assert Participant.objects.count() == 0


@pytest.mark.django_db
def test_participant_creation_trims_name_and_preserves_get_order(client):
    bob = Participant.objects.create(name="Bob")
    response = client.post(
        "/api/participants/", data={"name": " \tAlice\n "}, content_type="application/json"
    )
    assert response.status_code == 201
    created = response.json()
    assert created == {"id": Participant.objects.get(name="Alice").id, "name": "Alice"}
    assert type(created["id"]) is int
    expected = [created, {"id": bob.id, "name": "Bob"}]
    for _ in range(2):
        assert client.get("/api/participants/").json() == expected


@pytest.mark.django_db
@pytest.mark.parametrize(
    "data",
    [{}, {"name": ""}, {"name": " \t\n "}, {"name": None}, {"name": "x" * 101}, {"name": []}],
)
def test_participant_creation_returns_name_errors_for_invalid_input(client, data):
    response = client.post(
        "/api/participants/", data=json.dumps(data), content_type="application/json"
    )
    assert response.status_code == 400
    assert response.json()["name"]
    assert Participant.objects.count() == 0


@pytest.mark.django_db
def test_participant_creation_accepts_limit_after_trimming_and_ignores_client_id(client):
    name = "🍽" * 100
    response = client.post(
        "/api/participants/",
        data={"name": f"  {name}  ", "id": 999},
        content_type="application/json",
    )
    assert response.status_code == 201
    assert response.json() == {"id": Participant.objects.get().id, "name": name}
    assert response.json()["id"] != 999


@pytest.mark.django_db
@pytest.mark.parametrize("concurrent", [False, True])
def test_participant_creation_rejects_duplicate_trimmed_name(client, concurrent):
    existing = Participant.objects.create(name="Alice")
    # Skipping uniqueness validation simulates a name claimed before the insert.
    validation = (
        patch("rest_framework.validators.UniqueValidator.__call__") if concurrent else nullcontext()
    )
    with validation:
        response = client.post(
            "/api/participants/", data={"name": " Alice "}, content_type="application/json"
        )
    assert response.status_code == 400
    assert response.json()["name"]
    assert list(Participant.objects.values("id", "name")) == [{"id": existing.id, "name": "Alice"}]


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
