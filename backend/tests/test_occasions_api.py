import pytest
from django.test import Client

from expenses.models import Occasion
from expenses.names import canonical_occasion_name

pytestmark = pytest.mark.django_db


def test_occasions_empty_list(client):
    response = client.get("/api/occasions/")
    assert response.status_code == 200
    assert response.json() == []


def test_anonymous_occasion_creation_trims_name_and_preserves_list_order():
    client = Client(enforce_csrf_checks=True)
    trip = Occasion.objects.create(name="Trip")
    response = client.post(
        "/api/occasions/", data={"name": " \tDinner\n "}, content_type="application/json"
    )
    assert response.status_code == 201
    created = {"id": Occasion.objects.get(name="Dinner").id, "name": "Dinner"}
    assert response.json() == created
    expected = [created, {"id": trip.id, "name": "Trip"}]
    for _ in range(2):
        listing = client.get("/api/occasions/")
        assert listing.status_code == 200
        assert listing.json() == expected


@pytest.mark.parametrize(
    "data",
    [
        {},
        {"name": ""},
        {"name": " \t\n "},
        {"name": "\u00a0\u2003"},
        {"name": None},
        {"name": "x" * 101},
        {"name": "🍽" * 101},
        {"name": []},
        {"name": {}},
        {"name": True},
    ],
)
def test_invalid_occasions_return_field_errors_and_preserve_existing_rows(client, data):
    existing = Occasion.objects.create(name="Dinner")
    response = client.post("/api/occasions/", data=data, content_type="application/json")
    assert response.status_code == 400
    assert set(response.json()) == {"name"}
    assert response.json()["name"]
    assert list(Occasion.objects.values("id", "name")) == [{"id": existing.id, "name": "Dinner"}]


@pytest.mark.parametrize("character", ["x", "🍽"])
def test_occasion_accepts_limit_after_trimming_and_ignores_client_id(client, character):
    name = character * 100
    response = client.post(
        "/api/occasions/",
        data={"name": f" \t{name}\n ", "id": 999},
        content_type="application/json",
    )
    assert response.status_code == 201
    assert response.json() == {"id": Occasion.objects.get().id, "name": name}
    assert response.json()["id"] != 999


@pytest.mark.parametrize("concurrent", [False, True])
@pytest.mark.parametrize("name", ["Birthday", "birthday", "BIRTHDAY", " Birthday ", "  bIrThDaY  "])
def test_occasion_rejects_duplicate_trimmed_case_insensitive_name(
    client, monkeypatch, concurrent, name
):
    existing = Occasion.objects.create(name="Birthday")
    if concurrent:
        # Both requests may validate before the competing insert commits.
        monkeypatch.setattr(
            "expenses.serializers.OccasionSerializer.validate_name", lambda self, value: value
        )
    response = client.post("/api/occasions/", data={"name": name}, content_type="application/json")
    assert response.status_code == 400
    assert set(response.json()) == {"name"}
    assert response.json()["name"]
    assert list(Occasion.objects.values("id", "name")) == [{"id": existing.id, "name": "Birthday"}]


@pytest.mark.parametrize("method", ["put", "patch", "delete", "trace"])
def test_occasions_reject_other_methods_without_changing_data(client, method):
    Occasion.objects.create(name="Dinner")
    before = list(Occasion.objects.values())
    response = getattr(client, method)(
        "/api/occasions/", data={"name": "Trip"}, content_type="application/json"
    )
    assert response.status_code == 405
    assert list(Occasion.objects.values()) == before


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize(
    ("first_name", "second_name"),
    [("Birthday", " birthday "), ("Été", "été"), ("Été", "E\u0301te\u0301"), ("Straße", "STRASSE")],
)
def test_concurrent_equivalent_requests_return_one_created_and_one_field_error(
    monkeypatch, first_name, second_name
):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier, Event

    from django.db import connections

    from expenses.serializers import OccasionSerializer

    validated = Barrier(2)
    committed = Event()
    validate_name = OccasionSerializer.validate_name
    create = OccasionSerializer.create

    def validate_together(self, value):
        result = validate_name(self, value)
        validated.wait(timeout=10)
        return result

    def insert_after_competing_commit(self, data):
        # Interleave real HTTP requests after both validated. Serializing only the
        # inserts avoids SQLite's shared-memory table locks masking the unique check.
        if data["name"] == second_name.strip():
            assert committed.wait(timeout=10)
            return create(self, data)
        try:
            return create(self, data)
        finally:
            committed.set()

    def request(name):
        try:
            response = Client().post(
                "/api/occasions/", data={"name": name}, content_type="application/json"
            )
            return response.status_code, response.json()
        finally:
            connections.close_all()

    monkeypatch.setattr(OccasionSerializer, "validate_name", validate_together)
    monkeypatch.setattr(OccasionSerializer, "create", insert_after_competing_commit)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(request, [first_name, second_name]))
    assert results[0][0] == 201
    assert results[1][0] == 400
    assert set(results[1][1]) == {"name"}
    assert "case-insensitive" in results[1][1]["name"][0]
    assert list(Occasion.objects.values("name")) == [{"name": first_name}]


@pytest.mark.parametrize("skip_prevalidation", [False, True])
@pytest.mark.parametrize(
    ("original", "duplicate"),
    [
        ("Été", "été"),
        ("Été", " E\u0301te\u0301 "),
        ("E\u0301te\u0301", "ÉTÉ"),
        ("Straße", "STRASSE"),
        ("Σ", "ς"),
        ("Birthday", " birthday "),
    ],
)
def test_unicode_duplicates_are_name_field_errors_and_preserve_display(
    client, monkeypatch, skip_prevalidation, original, duplicate
):
    response = client.post(
        "/api/occasions/", data={"name": f"  {original}  "}, content_type="application/json"
    )
    assert response.status_code == 201
    first = response.json()
    assert first["name"] == original
    assert set(first) == {"id", "name"}
    before = list(Occasion.objects.values())
    if skip_prevalidation:
        monkeypatch.setattr(
            "expenses.serializers.OccasionSerializer.validate_name", lambda self, value: value
        )
    response = client.post(
        "/api/occasions/", data={"name": duplicate}, content_type="application/json"
    )
    assert response.status_code == 400
    assert set(response.json()) == {"name"}
    assert "already exists" in response.json()["name"][0]
    assert list(Occasion.objects.values()) == before
    assert Occasion.objects.get().canonical_name == canonical_occasion_name(original)
    assert client.get("/api/occasions/").json() == [first]


def test_clients_cannot_supply_the_canonical_name(client):
    response = client.post(
        "/api/occasions/",
        data={"name": " ÉTÉ ", "canonical_name": "birthday"},
        content_type="application/json",
    )
    assert response.status_code == 201
    assert response.json()["name"] == "ÉTÉ"
    assert "canonical_name" not in response.json()
    assert Occasion.objects.get().canonical_name == "été"
