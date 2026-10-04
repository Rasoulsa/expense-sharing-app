FROM python:3.13-slim AS dependencies
COPY --from=ghcr.io/astral-sh/uv:0.12.1 /uv /usr/local/bin/uv
ENV UV_PYTHON_DOWNLOADS=never UV_LINK_MODE=copy
WORKDIR /app
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --locked --no-dev --no-install-project --no-cache

FROM python:3.13-slim AS runtime
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHON_DOTENV_DISABLED=1 \
    DJANGO_SETTINGS_MODULE=config.production \
    DEBUG=false
WORKDIR /app
RUN groupadd --gid 10001 app && useradd --uid 10001 --gid app --no-create-home app
COPY --from=dependencies /app/.venv /app/.venv
COPY backend/manage.py ./
COPY backend/config ./config
COPY backend/expenses ./expenses
USER 10001:10001
EXPOSE 8000
# Use Django's parsed hosts so whitespace/empty entries cannot break the probe.
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; from django.conf import settings; request = urllib.request.Request('http://127.0.0.1:8000/health/live/', headers={'Host': settings.ALLOWED_HOSTS[0]}); urllib.request.urlopen(request, timeout=3).close()"
# Django alone interprets an explicitly configured proxy header. No implicit
# Gunicorn forwarded-header trust, migrations, seeds, or dependency sync here.
CMD ["gunicorn", "config.wsgi:application", "--bind=0.0.0.0:8000", "--workers=2", "--access-logfile=-", "--error-logfile=-", "--forwarded-allow-ips=", "--worker-tmp-dir=/tmp", "--preload"]
