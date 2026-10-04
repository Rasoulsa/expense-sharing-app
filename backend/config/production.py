"""Container settings. Local commands and CI continue to use config.settings."""

# ruff: noqa: F403, F405
import os
import re
from urllib.parse import urlsplit

from django.core.exceptions import ImproperlyConfigured

# Production reads only injected environment, even outside the image.
os.environ["PYTHON_DOTENV_DISABLED"] = "1"
if not os.getenv("DATABASE_URL", "").strip():
    raise ImproperlyConfigured("Production requires DATABASE_URL pointing to PostgreSQL.")
if not os.getenv("SECRET_KEY", "").strip():
    raise ImproperlyConfigured("Production requires a private SECRET_KEY.")

from .settings import *  # noqa: E402

if DEBUG:
    raise ImproperlyConfigured("Production requires DEBUG=false.")
if len(SECRET_KEY) < 50 or len(set(SECRET_KEY)) < 5 or SECRET_KEY.startswith("django-insecure-"):
    raise ImproperlyConfigured(
        "Production SECRET_KEY must be a long, random value (50+ characters)."
    )
if any(
    not re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?|\[[0-9A-Fa-f:]+\]", host)
    for host in ALLOWED_HOSTS
):
    raise ImproperlyConfigured(
        "Production ALLOWED_HOSTS must contain explicit hosts without schemes, ports, or wildcards."
    )

origin = os.getenv("CORS_ALLOWED_ORIGIN", "")
try:
    parsed_origin = urlsplit(origin)
    valid_origin = (
        parsed_origin.scheme in {"http", "https"}
        and parsed_origin.hostname
        and "*" not in parsed_origin.hostname
        and not any(character.isspace() for character in origin)
        and parsed_origin.username is None
        and parsed_origin.password is None
        and not parsed_origin.path
        and not parsed_origin.query
        and not parsed_origin.fragment
    )
    parsed_origin.port  # Validate an optional port without echoing the URL.
except ValueError:
    valid_origin = False
if not valid_origin:
    raise ImproperlyConfigured(
        "Production CORS_ALLOWED_ORIGIN must be one exact HTTP(S) origin "
        "without credentials, path, query, or fragment."
    )
CORS_ALLOWED_ORIGINS = [origin]
CORS_ALLOW_ALL_ORIGINS = False
CORS_ALLOW_CREDENTIALS = False

# No Hamravesh header is assumed. Enable this pair only after verifying that the
# ingress strips client-supplied values and sets its own value for HTTPS.
proxy_header = os.getenv("SECURE_PROXY_SSL_HEADER", "")
proxy_value = os.getenv("SECURE_PROXY_SSL_VALUE", "")
if proxy_header or proxy_value:
    if (
        not re.fullmatch(r"HTTP_[A-Z0-9_]+", proxy_header)
        or not proxy_value
        or "," in proxy_value
        or any(character.isspace() for character in proxy_value)
    ):
        raise ImproperlyConfigured(
            "Set SECURE_PROXY_SSL_HEADER (HTTP_HEADER_NAME) and SECURE_PROXY_SSL_VALUE together."
        )
    SECURE_PROXY_SSL_HEADER = (proxy_header, proxy_value)
else:
    SECURE_PROXY_SSL_HEADER = None
USE_X_FORWARDED_HOST = False
USE_X_FORWARDED_PORT = False

redirect = os.getenv("SECURE_SSL_REDIRECT", "true").strip().lower()
if redirect not in {"true", "false", "1", "0", "yes", "no", "on", "off"}:
    raise ImproperlyConfigured("SECURE_SSL_REDIRECT must be a boolean.")
SECURE_SSL_REDIRECT = redirect in {"true", "1", "yes", "on"}
# Internal HTTP probes must reach the process/database without HTTPS redirects.
SECURE_REDIRECT_EXEMPT = [r"^health/(live|ready)/$"]
try:
    SECURE_HSTS_SECONDS = int(os.getenv("SECURE_HSTS_SECONDS", "0"))
    if SECURE_HSTS_SECONDS < 0:
        raise ValueError
except ValueError:
    raise ImproperlyConfigured("SECURE_HSTS_SECONDS must be a nonnegative integer.") from None
# Enable HSTS only after validating HTTPS. Do not bind other subdomains or opt
# into browser preload as part of packaging.
SECURE_HSTS_INCLUDE_SUBDOMAINS = False
SECURE_HSTS_PRELOAD = False
SECURE_CONTENT_TYPE_NOSNIFF = True
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
X_FRAME_OPTIONS = "DENY"
MIDDLEWARE = [*MIDDLEWARE, "django.middleware.clickjacking.XFrameOptionsMiddleware"]
