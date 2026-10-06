import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
PROBE = """
import json
import django
from django.conf import settings
from django.core.checks import run_checks
from django.test import Client
django.setup()
client = Client(HTTP_HOST="api.example.test")
print(json.dumps({
    "debug": settings.DEBUG,
    "database": settings.DATABASES["default"]["ENGINE"],
    "origins": settings.CORS_ALLOWED_ORIGINS,
    "proxy": settings.SECURE_PROXY_SSL_HEADER,
    "redirect": settings.SECURE_SSL_REDIRECT,
    "hsts": settings.SECURE_HSTS_SECONDS,
    "forwarded_host": settings.USE_X_FORWARDED_HOST,
    "live": client.get("/health/live/").status_code,
    "cors": client.get("/health/live/", HTTP_ORIGIN="https://app.example.test").get(
        "Access-Control-Allow-Origin"),
    "untrusted_cors": client.get("/health/live/", HTTP_ORIGIN="https://other.example.test").get(
        "Access-Control-Allow-Origin"),
    "hsts_forwarded": client.get("/health/live/", HTTP_X_VERIFIED_SCHEME="https").get(
        "Strict-Transport-Security"),
    "hsts_unconfigured": client.get("/health/live/", HTTP_X_FORWARDED_PROTO="https").get(
        "Strict-Transport-Security"),
    "deploy_warnings": sorted(check.id for check in run_checks(include_deployment_checks=True)),
}))
"""

API_PROBE = """
import json
from unittest.mock import patch
import django
from django.http import Http404
from django.test import Client
django.setup()
from expenses.views import ExpenseDelete, ExpenseListCreate, OccasionListCreate, ParticipantList

def describe(response):
    return {
        "status": response.status_code,
        "location": response.get("Location"),
        "body": response.json() if response.get("Content-Type") == "application/json" else None,
        "cors": response.get("Access-Control-Allow-Origin"),
    }

client = Client(HTTP_HOST="api.example.test")
results = []
# Mock only database-facing methods; production middleware and API handlers run.
with (
    patch.object(ParticipantList, "get_queryset", return_value=[]),
    patch.object(OccasionListCreate, "get_queryset", return_value=[]),
    patch.object(ExpenseListCreate, "get_queryset", return_value=[]),
    patch("expenses.views.calculate_balances", return_value=[]),
    patch.object(ExpenseDelete, "get_object", side_effect=Http404),
):
    for scheme in (None, "http", "https"):
        headers = {"HTTP_ORIGIN": "https://app.example.test"}
        if scheme is not None:
            headers["HTTP_X_FORWARDED_PROTO"] = scheme
        results.append({
            "participants": describe(client.get("/api/participants/", **headers)),
            "occasions": describe(client.get("/api/occasions/", **headers)),
            "expenses": describe(client.get("/api/expenses/", **headers)),
            "balances": describe(client.get("/api/balances/", **headers)),
            "post_person": describe(client.post(
                "/api/participants/", data={"name": ""},
                content_type="application/json", **headers)),
            "post_occasion": describe(client.post(
                "/api/occasions/", data={}, content_type="application/json", **headers)),
            "post_expense": describe(client.post(
                "/api/expenses/", data={}, content_type="application/json", **headers)),
            "delete_missing": describe(client.delete("/api/expenses/999/", **headers)),
        })
    untrusted_cors = describe(client.get(
        "/api/participants/", HTTP_ORIGIN="https://other.example.test"))
    untrusted_host = client.get(
        "/api/participants/", HTTP_HOST="other.example.test").status_code
print(json.dumps({"requests": results, "untrusted_cors": untrusted_cors,
                  "untrusted_host": untrusted_host}))
"""

HEALTH_PROBE = """
import json
from unittest.mock import patch
import django
from django.db import OperationalError, connection
from django.test import Client
django.setup()
from expenses.models import Expense, Occasion, Participant

def describe(response):
    return {"status": response.status_code, "body": response.json(),
            "location": response.get("Location")}

client = Client(HTTP_HOST="api.example.test")
with patch.object(connection, "cursor", side_effect=AssertionError("Database accessed")):
    live = describe(client.get("/health/live/"))
with (
    patch.object(Participant.objects, "exists", return_value=False) as participant_query,
    patch.object(Occasion.objects, "values_list") as occasion_query,
    patch.object(Expense.objects, "values_list") as expense_query,
):
    occasion_query.return_value.first.return_value = None
    expense_query.return_value.first.return_value = None
    ready = describe(client.get("/health/ready/"))
    participant_query.assert_called_once_with()
    occasion_query.assert_called_once_with("canonical_name", flat=True)
    occasion_query.return_value.first.assert_called_once_with()
    expense_query.assert_called_once_with("occasion_id", flat=True)
    expense_query.return_value.first.assert_called_once_with()
with patch.object(Participant.objects, "exists", side_effect=OperationalError("unavailable")):
    unavailable = describe(client.get("/health/ready/"))
with patch.object(connection, "cursor", side_effect=AssertionError("Database accessed")):
    untrusted_hosts = [client.get(path, HTTP_HOST="other.example.test").status_code
                       for path in ("/health/live/", "/health/ready/")]
print(json.dumps({"live": live, "ready": ready, "unavailable": unavailable,
                  "untrusted_hosts": untrusted_hosts}))
"""


@pytest.fixture
def production_probe(tmp_path):
    # Separate processes keep both the active SQLite/PostgreSQL test connection
    # and settings imports untouched. These probes never connect to a database.
    env = dict(os.environ)
    for name in (
        "SECURE_PROXY_SSL_HEADER",
        "SECURE_PROXY_SSL_VALUE",
        "SECURE_SSL_REDIRECT",
        "SECURE_HSTS_SECONDS",
    ):
        env.pop(name, None)
    env.update(
        DJANGO_SETTINGS_MODULE="config.production",
        PYTHON_DOTENV_DISABLED="1",
        DEBUG="false",
        SECRET_KEY="public-production-settings-test-placeholder-never-use-in-production",
        DATABASE_URL="postgresql://disposable:disposable@db.invalid/expense_test",
        SQLITE_PATH=str(tmp_path / "unused" / "expenses.sqlite3"),
        ALLOWED_HOSTS="api.example.test",
        CORS_ALLOWED_ORIGIN="https://app.example.test",
    )

    def run(*, script=PROBE, **overrides):
        probe_env = env | overrides
        probe_env = {key: value for key, value in probe_env.items() if value is not None}
        result = subprocess.run(
            [sys.executable, "-c", script],
            cwd=BACKEND_DIR,
            env=probe_env,
            capture_output=True,
            text=True,
            timeout=10,
        )
        assert not (tmp_path / "unused").exists()
        return result

    return run


def test_production_defaults_and_exact_cors(production_probe):
    result = production_probe()
    assert result.returncode == 0, result.stderr
    settings = json.loads(result.stdout)
    assert settings == {
        "debug": False,
        "database": "django.db.backends.postgresql",
        "origins": ["https://app.example.test"],
        "proxy": None,
        "redirect": False,
        "hsts": 0,
        "forwarded_host": False,
        "live": 200,
        "cors": "https://app.example.test",
        "untrusted_cors": None,
        "hsts_forwarded": None,
        "hsts_unconfigured": None,
        "deploy_warnings": ["security.W003", "security.W004", "security.W008"],
    }


def test_production_api_requests_do_not_redirect(production_probe):
    result = production_probe(script=API_PROBE)
    assert result.returncode == 0, result.stderr
    data = json.loads(result.stdout)
    for responses in data["requests"]:
        for name, response in responses.items():
            assert response["location"] is None
            assert response["cors"] == "https://app.example.test"
            if name == "post_person":
                assert response["status"] == 405
                assert response["body"]["detail"]
            elif name.startswith("post_"):
                assert response["status"] == 400
                assert response["body"]
            elif name == "delete_missing":
                assert response["status"] == 404
            else:
                assert response["status"] == 200
                assert response["body"] == []
    assert data["untrusted_cors"] == {"status": 200, "location": None, "body": [], "cors": None}
    assert data["untrusted_host"] == 400


def test_production_health_endpoints_do_not_redirect_and_validate_hosts(production_probe):
    result = production_probe(script=HEALTH_PROBE)
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == {
        "live": {"status": 200, "body": {"status": "alive"}, "location": None},
        "ready": {"status": 200, "body": {"status": "ready"}, "location": None},
        "unavailable": {"status": 503, "body": {"status": "not_ready"}, "location": None},
        "untrusted_hosts": [400, 400],
    }


def test_only_explicit_proxy_header_marks_https(production_probe):
    result = production_probe(
        SECURE_PROXY_SSL_HEADER="HTTP_X_VERIFIED_SCHEME",
        SECURE_PROXY_SSL_VALUE="https",
        SECURE_HSTS_SECONDS="3600",
    )
    assert result.returncode == 0, result.stderr
    settings = json.loads(result.stdout)
    assert settings["proxy"] == ["HTTP_X_VERIFIED_SCHEME", "https"]
    assert settings["hsts_forwarded"] == "max-age=3600"
    assert settings["hsts_unconfigured"] is None
    assert settings["redirect"] is False
    assert settings["live"] == 200


@pytest.mark.parametrize(
    ("name", "value", "message"),
    [
        ("DATABASE_URL", None, "Production requires DATABASE_URL"),
        ("DATABASE_URL", "", "Production requires DATABASE_URL"),
        ("DATABASE_URL", "sqlite:///ignored.sqlite3", "valid PostgreSQL URL"),
        ("SECRET_KEY", None, "Production requires a private SECRET_KEY"),
        ("SECRET_KEY", "", "Production requires a private SECRET_KEY"),
        ("SECRET_KEY", "dev-only-insecure-key-change-before-production", "development SECRET_KEY"),
        ("SECRET_KEY", "short", "long, random value"),
        ("SECRET_KEY", "a" * 60, "long, random value"),
        ("DEBUG", "true", "Production requires DEBUG=false"),
        ("ALLOWED_HOSTS", "", "ALLOWED_HOSTS must be set"),
        ("ALLOWED_HOSTS", "*", "explicit hosts"),
        ("ALLOWED_HOSTS", ".example.test", "explicit hosts"),
        ("ALLOWED_HOSTS", "https://api.example.test", "explicit hosts"),
        ("ALLOWED_HOSTS", "api.example.test:8000", "explicit hosts"),
        ("CORS_ALLOWED_ORIGIN", None, "one exact HTTP"),
        ("CORS_ALLOWED_ORIGIN", "*", "one exact HTTP"),
        ("CORS_ALLOWED_ORIGIN", "https://*.example.test", "one exact HTTP"),
        ("CORS_ALLOWED_ORIGIN", "https://app.example.test/path", "one exact HTTP"),
        ("CORS_ALLOWED_ORIGIN", "https://user:pretend-secret@app.example.test", "one exact HTTP"),
        ("CORS_ALLOWED_ORIGIN", "https://app.example.test:bad", "one exact HTTP"),
        ("CORS_ALLOWED_ORIGIN", "https://app.example.test?token=pretend-secret", "one exact HTTP"),
        ("SECURE_PROXY_SSL_HEADER", "HTTP_X_VERIFIED_SCHEME", "together"),
        ("SECURE_PROXY_SSL_VALUE", "https", "together"),
        ("SECURE_SSL_REDIRECT", "maybe", "must be a boolean"),
        ("SECURE_HSTS_SECONDS", "-1", "nonnegative integer"),
        ("SECURE_HSTS_SECONDS", "invalid", "nonnegative integer"),
    ],
)
def test_production_rejects_invalid_configuration(production_probe, name, value, message):
    result = production_probe(**{name: value})
    assert result.returncode != 0
    assert message in result.stderr
    assert "pretend-secret" not in result.stderr
