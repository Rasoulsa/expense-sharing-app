# Day 4 production packaging

The images package seeded read-only participants, Add Occasion, optional UI
occasion selection, historical ungrouped expenses, expense filtering, individual
expense deletion, and global/occasion-scoped pairwise balances. Local SQLite and PostgreSQL 17 CI
remain supported. Production migration/promotion and connectivity checks are
separate authorized work for the existing Hamravesh apps.

[Operations](operations.md) defines the future green-PR promotion from `main` to
`release`, separate app configuration, release preparation, backup/restore,
acceptance checks, and rollback. Image CI runs only the disposable local smoke;
it does not publish images or deploy.

## Build from the repository root

```sh
docker build -f backend/Dockerfile -t expense-sharing-backend:day4 .
docker build -f frontend/Dockerfile \
  --build-arg VITE_API_BASE_URL=https://api.example.com \
  -t expense-sharing-frontend:day4 .
```

Replace the example API origin with the public HTTPS backend origin. The root
`.dockerignore` excludes all environment files (including examples), SQLite
data, Git/agent files, virtual environments, dependencies, build outputs, and
test artifacts from both contexts. Neither image contains a production secret.

The backend installs production dependencies with
`uv sync --locked --no-dev --no-install-project` from `backend/uv.lock`, using
uv 0.12.1 and Python 3.13. Its runtime contains no uv, pytest, or Ruff. It runs
Gunicorn 23 through `config.wsgi:application` with two workers, listening on
**8000**, as UID/GID 10001. Gunicorn preloads configuration so missing required
settings fail before workers start. Logs go to stdout/stderr. No migration or
seed runs during build or web startup. Django uses only `JSONRenderer`, with
no admin or browsable API; no Django static assets need collecting or serving.
Revisit static serving if those renderers change.

The frontend uses Node 24, `npm ci`, and the Vite production build in a builder
stage, then serves only `dist` with Nginx on **80**. `GET /health/` returns
HTTP 200 `ok`; other application paths fall back to `index.html`. Missing
`/assets/` files return 404. Hashed assets are cached; the HTML is revalidated.
The application continues to call the backend directly through its typed client.

`VITE_API_BASE_URL` is a **required build ARG**, accepting an absolute public
HTTP(S) origin, optionally ending in `/`, with no credentials, path, query, or
fragment. Builds reject an empty or unusable URL. The client uses absolute
`/api/...` paths, so a path prefix in the base URL would be ignored and is
rejected. Use HTTPS in production; HTTP is for the disposable local smoke.
All `VITE_` values are public JavaScript configuration: never put credentials
in them. Changing the API URL requires **rebuilding the frontend image**;
runtime container environment cannot update an already compiled bundle.
This follows [Vite's environment model](https://vite.dev/guide/env-and-mode.html).

Base images use version/series tags. Release preparation should record tested
image digests and rebuild with base-image updates; tags themselves are mutable.

## Backend runtime environment

The image selects `DJANGO_SETTINGS_MODULE=config.production`, disables dotenv
loading, and defaults to `DEBUG=false`. Keep these values in production.
Regular local and CI commands still use `config.settings` and their existing
`DEBUG`, `SECRET_KEY`, `ALLOWED_HOSTS`, `DATABASE_URL`, and `SQLITE_PATH` names.
Production settings also work with `manage.py --settings=config.production`.

| Variable | Production behavior |
| --- | --- |
| `DATABASE_URL` | Required PostgreSQL URL with a host and database name; no SQLite fallback. The existing sanitized parser preserves TLS query options. Use Hamravesh's private internal connection details. |
| `SECRET_KEY` | Required private random key, at least 50 characters with at least five distinct characters. Development and `django-insecure-` keys are rejected. Generate it outside the repository and inject it privately at runtime. |
| `DEBUG` | Must be false; true fails startup. |
| `ALLOWED_HOSTS` | Required comma-separated exact backend hostnames/IPs, without schemes or ports. `*` and leading-dot subdomain wildcards are rejected. Include only actual public/internal hosts needed for traffic and probes. |
| `CORS_ALLOWED_ORIGIN` | Required single exact frontend origin, e.g. `https://app.example.com`, without a trailing slash, path, query, or credentials. No wildcard origins or credentialed CORS. |
| `SECURE_PROXY_SSL_HEADER` | Optional verified proxy header in Django META format, e.g. `HTTP_X_VERIFIED_SCHEME`. No default header is trusted. Must be supplied together with the next value. |
| `SECURE_PROXY_SSL_VALUE` | Exact verified header value identifying HTTPS, e.g. `https`. |
| `SECURE_SSL_REDIRECT` | Defaults to false. Leave unset or false for Hamravesh; enable HTTPS Redirect at the domain ingress for every public backend/frontend domain. Remove stale true overrides to avoid HTTPS self-redirects behind TLS termination. |
| `SECURE_HSTS_SECONDS` | Defaults to 0 until public HTTPS is verified. After verification, start with a short duration such as 3600. Subdomain inclusion and preload remain disabled. |

Use the database name `postgres` from the connection panel, not the resource name
`expense-db`. Percent-encode credentials in the URL and follow the panel's TLS
requirements. Never supply backend credentials as Docker build arguments.

## Verify the HTTPS ingress before enabling proxy trust

Hamravesh terminates TLS. Enable its **HTTPS Redirect** setting at each public
backend and frontend domain ingress before serving users. Django leaves
HTTP-to-HTTPS redirection to this ingress. With no trusted scheme header,
Django sees ingress traffic as HTTP; enabling `SECURE_SSL_REDIRECT` would make
public HTTPS API requests redirect back to the same HTTPS URL.

Packaging does not assume Hamravesh emits `X-Forwarded-Proto` or any other header.
Verify the actual header name and exact value, that the ingress strips client
copies (including comma-separated values) and writes its own trustworthy value,
and that clients cannot bypass the ingress to reach Gunicorn. Then set the
`SECURE_PROXY_SSL_HEADER`/`SECURE_PROXY_SSL_VALUE` pair to those verified values.
Django trusts that configured header without an IP allowlist, so the network
boundary and ingress sanitization must provide the trust guarantee. This follows
[Django's proxy guidance](https://docs.djangoproject.com/en/5.2/ref/settings/#secure-proxy-ssl-header).

Gunicorn's implicit forwarded scheme detection is disabled with
`--forwarded-allow-ips=` so Django is the single configured interpreter. The
[`forwarded_allow_ips` setting](https://gunicorn.org/reference/settings/#forwarded-allow-ips)
otherwise controls Gunicorn's own scheme inference. Django also leaves
`USE_X_FORWARDED_HOST` and `USE_X_FORWARDED_PORT` false. Verify that ingress
preserves the expected `Host`; configure exact allowed hosts accordingly.

Before serving users, verify HTTP redirects to HTTPS, public HTTPS does not
redirect in a loop, requests with spoofed forwarded headers do not bypass that
behavior, the exact frontend origin can GET/POST/DELETE, and another origin
receives no CORS permission. Verify real frontend connectivity from Iran and
internal connectivity to managed PostgreSQL separately after deployment is
authorized.

Backend `/health/live/` and `/health/ready/` are exempt from HTTPS redirects for
internal HTTP probes. Liveness needs no database; readiness requires the
participant/occasion tables, the expense occasion column (0002), and the
occasion canonical-name column (0004). Probes must send an allowed `Host`; the Docker liveness probe
uses the first parsed `ALLOWED_HOSTS` entry, after trimming whitespace and
removing empty entries. Configure readiness on port 8000 separately in the
hosting platform so traffic waits for migrations and database access.

## Release commands, separate from web startup

For the existing apps, apply pending 0002/0003 and
`expenses.0004_occasion_canonical_names` from the
**new backend code/image** before promoting it, while the current app remains available.
The exact Hamravesh mechanism for private candidate command execution must be
verified; no one-off job facility is assumed. Follow [operations](operations.md)
for backup/restore rehearsal, migration SQL/plan and lock limits, verification,
backend-first/frontend-second promotion, and rollback without reversing 0002–0004.
Readiness verifies the required 0002/0004 columns; separately verify all migrations
and the non-null, nonblank, unique `canonical_name` constraint. 0004 stops before
backfill with conflicting IDs/spellings under trim/NFC/casefold/NFC comparison.
0003 remains unchanged and may stop earlier on its limited SQL-lowercase check. Resolve
only through explicitly reviewed renames preserving IDs and expense assignments.
The core candidate commands, after those gates and with private settings injected,
are:

```sh
python manage.py check --deploy
python manage.py migrate --plan
python manage.py migrate expenses 0004 --noinput
python manage.py migrate --check
```

Use Python from the image's PATH; uv is absent. The additive migration preserves
all existing participants/expenses and leaves old expenses ungrouped. Seeding is
for fresh databases, not routine cleanup of existing production data; it remains
idempotent and preserves every existing participant and expense. Missing 0002/0004 schema
makes new-backend readiness 503 while liveness remains 200. No production migration
has been executed for this change.

Review `check --deploy` output rather than suppressing warnings:

- `security.W003` is expected for this intentionally anonymous JSON API without
  sessions, authentication, or CSRF middleware. It does not use cookie-based
  authority; CORS is not access control. No authentication is added by packaging.
- `security.W004` is expected while HSTS is 0, pending HTTPS verification.
- With HSTS enabled, `security.W005` and `security.W021` report deliberately
  disabled subdomain inclusion/preload. Confirm domain ownership and HTTPS on
  every affected host before considering those separately.
- `security.W008` is expected in production and the local HTTP smoke because
  Django redirects are disabled while Hamravesh's domain ingress handles public
  HTTP-to-HTTPS redirects. Keep it visible and require the provider's HTTPS
  Redirect setting. The existing image CI check overrides redirects to true for
  that command alone, so its W003/W004 output omits this production warning.

Other deployment warnings/errors require investigation. No production command
has been run against Hamravesh as part of packaging.

## Disposable local container smoke

This compose file contains only public disposable credentials, binds application
ports to loopback, exposes no database port, uses PostgreSQL 17 on tmpfs, and
never reads a production `.env` or Hamravesh URL. Keep local ports 8000 and 8080
free. Stopping/recreating the database container discards its data; restart with
a fresh stack before rerunning the smoke script.

From the repository root:

```sh
docker compose -f compose.smoke.yml build
docker compose -f compose.smoke.yml up -d --wait db frontend
docker compose -f compose.smoke.yml run --rm backend python manage.py migrate --noinput
docker compose -f compose.smoke.yml run --rm backend python manage.py seed_participants
docker compose -f compose.smoke.yml run --rm backend python manage.py seed_participants
docker compose -f compose.smoke.yml up -d --wait backend
docker compose -f compose.smoke.yml exec backend python manage.py check --deploy
python3 backend/scripts/smoke_containers.py
docker compose -f compose.smoke.yml down --volumes --remove-orphans
```

The smoke checks both HTTP health paths, database readiness, Nginx SPA fallback,
exact CORS permission, four read-only seeded participants, occasion creation and
filtering, assigned and ungrouped expense creation/listing, global/filtered
reverse pair netting, individual deletion/repeated-delete 404, and seed
preservation after writes. It intentionally modifies only the disposable local
database. The existing SQLite/Vitest/Playwright suites and PostgreSQL CI remain
the wider regression checks.
