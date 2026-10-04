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
    "plain": client.get("/api/participants/").status_code,
    "cors": client.get("/health/live/", HTTP_ORIGIN="https://app.example.test").get(
        "Access-Control-Allow-Origin"),
    "untrusted_cors": client.get("/health/live/", HTTP_ORIGIN="https://other.example.test").get(
        "Access-Control-Allow-Origin"),
    "hsts_forwarded": client.get("/health/live/", HTTP_X_VERIFIED_SCHEME="https").get(
        "Strict-Transport-Security"),
    "hsts_unconfigured": client.get("/health/live/", HTTP_X_FORWARDED_PROTO="https").get(
        "Strict-Transport-Security"),
}))
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

    def run(**overrides):
        probe_env = env | overrides
        probe_env = {key: value for key, value in probe_env.items() if value is not None}
        result = subprocess.run(
            [sys.executable, "-c", PROBE],
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
        "redirect": True,
        "hsts": 0,
        "forwarded_host": False,
        "live": 200,
        "plain": 301,
        "cors": "https://app.example.test",
        "untrusted_cors": None,
        "hsts_forwarded": None,
        "hsts_unconfigured": None,
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
    assert settings["plain"] == 301
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
