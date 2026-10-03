import os
from pathlib import Path

import dj_database_url
from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


DEBUG = env_bool("DEBUG", default=False)
DEV_SECRET_KEY = "dev-only-insecure-key-change-before-production"
SECRET_KEY = os.getenv("SECRET_KEY", "").strip()
if not SECRET_KEY:
    if DEBUG:
        SECRET_KEY = DEV_SECRET_KEY
    else:
        raise RuntimeError("SECRET_KEY must be set when DEBUG is false.")
if not DEBUG and SECRET_KEY == DEV_SECRET_KEY:
    raise RuntimeError("The development SECRET_KEY cannot be used when DEBUG is false.")

allowed_hosts_value = os.getenv("ALLOWED_HOSTS", "localhost,127.0.0.1" if DEBUG else "")
ALLOWED_HOSTS = [host.strip() for host in allowed_hosts_value.split(",") if host.strip()]
if not DEBUG and not ALLOWED_HOSTS:
    raise RuntimeError("ALLOWED_HOSTS must be set when DEBUG is false.")

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "expenses",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
]

ROOT_URLCONF = "config.urls"
TEMPLATES = []
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

database_url = os.getenv("DATABASE_URL")
if database_url is not None:
    try:
        if (
            not database_url
            or "#" in database_url
            or any(character.isspace() for character in database_url)
        ):
            raise ValueError
        database = dj_database_url.parse(database_url)
        if (
            database.get("ENGINE") != "django.db.backends.postgresql"
            or not database.get("HOST")
            or not database.get("NAME")
        ):
            raise ValueError
    except ValueError:
        # Parser errors may include credentials. Never echo the supplied URL.
        raise ImproperlyConfigured(
            "DATABASE_URL must be a valid PostgreSQL URL with a host and database name. "
            "Percent-encode special characters in credentials."
        ) from None
    DATABASES = {"default": database}
else:
    SQLITE_PATH = Path(os.getenv("SQLITE_PATH", str(BASE_DIR / ".local" / "expenses.sqlite3")))
    SQLITE_PATH.parent.mkdir(parents=True, exist_ok=True)
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": SQLITE_PATH,
        }
    }

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

CORS_ALLOWED_ORIGINS = ["http://localhost:5173"]

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.AllowAny"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "UNAUTHENTICATED_USER": None,
}
