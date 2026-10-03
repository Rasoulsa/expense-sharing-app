import runpy
import traceback
from pathlib import Path

import pytest
from django.core.exceptions import ImproperlyConfigured

SETTINGS_PATH = Path(__file__).resolve().parents[1] / "config" / "settings.py"


@pytest.fixture
def read_settings(monkeypatch):
    # Exercise settings without reading a developer's .env or changing Django's
    # active database connection (these tests also run in the PostgreSQL CI job).
    monkeypatch.setattr("dotenv.load_dotenv", lambda path: None)
    monkeypatch.setenv("DEBUG", "false")
    monkeypatch.setenv("SECRET_KEY", "public-settings-test-key")
    monkeypatch.setenv("ALLOWED_HOSTS", "localhost")
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("SQLITE_PATH", raising=False)
    return lambda: runpy.run_path(str(SETTINGS_PATH))


def test_unset_database_url_keeps_default_sqlite(read_settings):
    settings = read_settings()
    assert settings["DATABASES"]["default"] == {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": settings["BASE_DIR"] / ".local" / "expenses.sqlite3",
    }


def test_unset_database_url_keeps_sqlite_path_override(read_settings, monkeypatch, tmp_path):
    path = tmp_path / "nested" / "expenses.sqlite3"
    monkeypatch.setenv("SQLITE_PATH", str(path))
    assert read_settings()["DATABASES"]["default"]["NAME"] == path
    assert path.parent.is_dir()


@pytest.mark.parametrize("scheme", ["postgres", "postgresql"])
def test_postgres_url_overrides_sqlite_without_creating_directory(
    read_settings, monkeypatch, tmp_path, scheme
):
    sqlite_path = tmp_path / "unused" / "expenses.sqlite3"
    monkeypatch.setenv("SQLITE_PATH", str(sqlite_path))
    monkeypatch.setenv("DATABASE_URL", f"{scheme}://ci_user:ci_password@db.internal:5432/postgres")
    database = read_settings()["DATABASES"]["default"]
    assert database["ENGINE"] == "django.db.backends.postgresql"
    assert database["NAME"] == "postgres"
    assert database["HOST"] == "db.internal"
    assert database["PORT"] == 5432
    assert database["USER"] == "ci_user"
    assert database["PASSWORD"] == "ci_password"
    assert not sqlite_path.parent.exists()


def test_postgres_url_decodes_credentials_and_preserves_options(read_settings, monkeypatch):
    monkeypatch.setenv(
        "DATABASE_URL",
        "postgresql://ci%40user:ci%3Ap%40ss%23word@db.internal:5432/postgres?sslmode=require",
    )
    database = read_settings()["DATABASES"]["default"]
    assert database["USER"] == "ci@user"
    assert database["PASSWORD"] == "ci:p@ss#word"
    assert database["OPTIONS"] == {"sslmode": "require"}


@pytest.mark.parametrize(
    "url",
    [
        "",
        "   ",
        "not-a-url",
        "sqlite:///ignored.sqlite3",
        "mysql://ci:pretend-secret@db.internal/app",
        "unknown://ci:pretend-secret@db.internal/app",
        "postgresql://ci:pretend-secret@db.internal:invalid/postgres",
        "postgresql://ci:pretend-secret@db.internal:99999/postgres",
        "postgresql://ci:pretend-secret@[invalid/postgres",
        "postgresql://ci:pretend-secret@/postgres",
        "postgresql://ci:pretend-secret@db.internal",
        "postgresql://ci:pretend-secret@db.internal/",
        "postgresql://ci:pretend-secret@db.internal/postgres#fragment",
        "postgresql://ci:pretend-secret@db.internal/post gres",
    ],
)
def test_invalid_database_url_fails_without_fallback_or_leaking_credentials(
    read_settings, monkeypatch, tmp_path, url
):
    sqlite_path = tmp_path / "unused" / "expenses.sqlite3"
    monkeypatch.setenv("DATABASE_URL", url)
    monkeypatch.setenv("SQLITE_PATH", str(sqlite_path))
    with pytest.raises(ImproperlyConfigured, match="DATABASE_URL.*valid PostgreSQL URL") as error:
        read_settings()
    rendered_error = "".join(traceback.format_exception(error.value))
    assert "pretend-secret" not in rendered_error
    assert not sqlite_path.parent.exists()
