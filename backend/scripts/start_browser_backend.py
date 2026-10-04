"""Serve a freshly migrated and seeded disposable SQLite database for Playwright."""

import os
import signal
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

import django
from django.conf import settings
from django.core.management import call_command
from django.db import connections


def stop_server(_signum, _frame):
    # Playwright's graceful SIGTERM shutdown must also clean up the database.
    raise SystemExit(0)


def main():
    backend_dir = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(backend_dir))
    # Ignore developer/production database settings and never load a local .env.
    os.environ.pop("DATABASE_URL", None)
    os.environ.update(
        {
            "DJANGO_SETTINGS_MODULE": "config.settings",
            "PYTHON_DOTENV_DISABLED": "1",
            "DEBUG": "false",
            "SECRET_KEY": "browser-test-only-public-placeholder-never-use-in-production",
            "ALLOWED_HOSTS": "localhost,127.0.0.1,testserver",
        }
    )
    signal.signal(signal.SIGTERM, stop_server)

    with TemporaryDirectory(prefix="expense-sharing-browser-") as directory:
        os.environ["SQLITE_PATH"] = str(Path(directory) / "expenses.sqlite3")
        django.setup()
        assert settings.DATABASES["default"]["ENGINE"] == "django.db.backends.sqlite3"
        assert settings.CORS_ALLOWED_ORIGINS == ["http://localhost:5173"]
        try:
            call_command("migrate", interactive=False)
            call_command("seed_participants")
            # runserver uses os._exit on bind failure, so keep it in a child
            # process to ensure this parent's temporary directory is cleaned.
            server = subprocess.Popen(
                [sys.executable, "manage.py", "runserver", "127.0.0.1:8001", "--noreload"],
                cwd=backend_dir,
            )
            try:
                status = server.wait()
                if status:
                    raise SystemExit(status)
            finally:
                if server.poll() is None:
                    server.terminate()
                    try:
                        server.wait(timeout=3)
                    except subprocess.TimeoutExpired:
                        server.kill()
                        server.wait()
        finally:
            connections.close_all()


if __name__ == "__main__":
    main()
