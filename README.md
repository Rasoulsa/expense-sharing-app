# Expense Sharing App

The authoritative interview requirements are in [docs/challenge-spec.md](docs/challenge-spec.md).
Design decisions and the implementation plan are in [docs/architecture.md](docs/architecture.md).
An expense is directional: the beneficiary owes the payer. Balances are netted
between each pair of people, globally by default or within a selected occasion.
Participants are seeded and read-only. Add Occasion organizes expenses; occasion
selection is optional. Historical expenses without an occasion remain visible.

## Stack

- Backend: Python 3.13, Django 5.2.17 LTS, Django REST Framework 3.16.1, uv,
  Ruff 0.14.10, pytest 9.0.2, and pytest-django 4.12.0.
- Frontend: Node.js 24 LTS, React 19.3.0, TypeScript 5.9.3, Vite 8.3.2,
  ESLint 9.39.1, Vitest 5.0.3, and Playwright 1.63.0 with Chromium.
- Local database: SQLite at `backend/.local/expenses.sqlite3`.
- Production database: managed PostgreSQL 17 inside Hamravesh, with Psycopg 3
  and `dj-database-url` for Django configuration.

Exact Python and JavaScript package versions are recorded in `backend/uv.lock` and `frontend/package-lock.json`.
The scaffold was checked with Python 3.13.14, Node 24.19.0, npm 11.17.0, and uv 0.12.1.
Required tools: Python **3.13.x**, Node.js **24.x**, npm **11.x** (bundled with
Node 24), and uv **0.12.1**. The workflow pins uv 0.12.1 and selects Python/Node
from the project version files. Python is restricted to the 3.13 series in `backend/pyproject.toml` and
`backend/.python-version`; Node is restricted to 24 in `frontend/package.json`
and `frontend/.nvmrc`. Install these tools with your preferred version manager
before following the quickstart. Confirm with `python3 --version`, `node --version`,
`npm --version`, and `uv --version`.

## Quickstart

### Fresh clone

Replace `<repository-url>` with this repository's GitHub URL:

```sh
git clone <repository-url> expense-sharing-app
cd expense-sharing-app
```

The commands below use separate backend and frontend terminals from this root.
No database service is needed. Copy each environment example once; retain any
existing `.env`. The examples contain only development configuration.

### Backend

```sh
cd backend
# Create .env on first setup; keep an existing local .env.
cp -n .env.example .env
uv sync --locked
uv run --env-file .env -- python manage.py migrate
uv run --env-file .env -- python manage.py seed_participants
uv run --env-file .env -- python manage.py seed_participants
uv run --env-file .env -- python manage.py check
uv run --env-file .env -- python manage.py runserver
```

Django runs at `http://localhost:8000`. A fresh database's first seed run creates
four participants; the second creates zero. The command does not delete other
participants or change expenses.

The example secret is public and only for local development with `DEBUG=true`.
Outside development, set a real, private `SECRET_KEY`, `DEBUG=false`, and
`ALLOWED_HOSTS` to the real hostnames, comma separated. Startup rejects a missing
key, the development key, or missing hosts when debug is disabled. Exported
environment variables override `.env`. uv loads the explicitly supplied env file;
Django also loads `backend/.env` when invoked directly. Debug is enabled only by `1`, `true`,
`yes`, or `on` (case insensitive); `false` and `0` disable it. The timezone is UTC.
The backend creates the ignored `.local` directory automatically; the SQLite
database is local development data.
`SQLITE_PATH` optionally selects another absolute SQLite file path; leave it
unset for local development. It does not configure a different database engine.
When `DATABASE_URL` is absent, SQLite behavior stays the same. When it is set,
it takes precedence over `SQLITE_PATH` and configures Django's PostgreSQL backend.
An empty, malformed, or non-PostgreSQL URL fails startup with a configuration
error; it never silently falls back to SQLite. PostgreSQL URLs must include a
host and database name. Keep `DATABASE_URL` unset in your existing local `.env`.

### Hamravesh production database

The recorded production database is the managed PostgreSQL 17 resource `expense-db` in
cluster `hamravesh-c11`, namespace `saeidirasoul-expense-sharing`. The resource
name is **expense-db**, but the connection panel's database name is **postgres**.
The connection is internal to the cluster. Configure `DATABASE_URL` privately
in the backend's Hamravesh environment using the panel's internal hostname,
port, username, and password. This is the placeholder format only:

```dotenv
DATABASE_URL=postgresql://DB_USER:DB_PASSWORD@INTERNAL_DB_HOST:5432/postgres
```

Percent-encode special characters in usernames/passwords (for example, `@`
becomes `%40` and `#` becomes `%23`). URL query options such as `sslmode` are
preserved; follow the connection panel's TLS settings. Keep the real URL and
credentials out of tracked files, command output, and CI. Set production
`SECRET_KEY`, `DEBUG=false`, and `ALLOWED_HOSTS` privately as described above.
No Mac-to-Hamravesh connection or public database access is needed.

For the existing backend/frontend apps, follow the [release runbook](docs/operations.md).
Migrations `expenses.0002_occasions`, `expenses.0003_occasion_case_insensitive_names`
(if pending), and `expenses.0004_occasion_canonical_names` must run from the **new backend image/code**
with private runtime settings while the current app remains available, before
promoting the new backend: readiness requires the occasion table, its 0004
canonical-name column, and the expense foreign-key column. Promote the frontend after backend health/API checks.
The exact Hamravesh mechanism for executing the candidate migration must be
verified; no provider one-off job feature is assumed. This branch has not run a
production migration or deployment. [Production packaging](docs/production-packaging.md)
describes runtime settings, ingress checks, image builds, and disposable smoke tests.

### Frontend

In another terminal:

```sh
cd frontend
# If you use nvm, run: nvm install && nvm use
# Create .env on first setup; keep an existing local .env.
cp -n .env.example .env
npm ci
npm run dev
```

The Vite development server is fixed to `http://localhost:5173`; Django allows
exactly that CORS origin. `VITE_API_BASE_URL` defaults to `http://localhost:8000`.
Frontend `VITE_` variables are public build-time configuration; never put secrets there.

## Checks

From the repository root, with the backend `.env` from the quickstart:

```sh
cd backend
uv lock --check
uv sync --locked
uv run --env-file .env -- python manage.py migrate --noinput
uv run --env-file .env -- python manage.py seed_participants
uv run --env-file .env -- python manage.py seed_participants
uv run --env-file .env -- python manage.py makemigrations --check --dry-run
uv run --env-file .env -- python manage.py check
uv run --env-file .env -- pytest -q
uv run --env-file .env -- ruff check .
uv run --env-file .env -- ruff format --check .
```

From the repository root, frontend checks:

```sh
cd frontend
npm ci
npm run lint
npm run typecheck
npm run test
VITE_API_BASE_URL=http://localhost:8000 npm run build
```

With `DATABASE_URL` unset, backend tests use pytest-django's isolated in-memory
SQLite database, separate from local development data. With a PostgreSQL URL,
pytest-django creates and destroys a separate `test_<database-name>` database;
the disposable CI user can create it. Frontend tests use Vitest, React Testing
Library, and jsdom, with mocked HTTP responses at the fetch boundary.

### Browser test against the real API

From the repository root, after installing the required Python, uv, and Node
versions above:

```sh
cd backend
uv sync --locked
cd ../frontend
npm ci
npx playwright install chromium
npm run e2e
```

On Linux, install Chromium's system dependencies too:
`npx playwright install --with-deps chromium`.

Keep ports **5173** and **8001** free; stop any Vite development server first.
Playwright starts Django at `http://127.0.0.1:8001` and Vite at
`http://localhost:5173`, waits for readiness, and shuts both down afterward.
It refuses to reuse existing servers. `VITE_API_BASE_URL` is set to the test
API URL; Django allows exactly the frontend origin `http://localhost:5173`.
The backend launcher creates a fresh SQLite database in the system temporary
directory, migrates it, seeds participants, and deletes it on shutdown.
It disables `.env` loading, removes inherited `DATABASE_URL`, overrides
`SQLITE_PATH`, and uses an explicit public test key with `DEBUG=false`.
The test uses neither mocked HTTP responses nor production data or credentials.

The real Chromium journey verifies read-only seeded participants and the absence
of participant creation controls, Add Occasion (trimmed names, duplicate field
errors for case variants, and Cancel/Escape after network failures), and optional
occasion selection in Add Expense, including failed occasion lookups. It creates
assigned and ungrouped expenses and checks independent filtering/clearing across tabs,
persistence, and global versus occasion-scoped pairwise balances.
Keyboard/focus checks and desktop/320px screenshots cover both forms, views, and
filters, including scrolling to Save Expense on a phone. It also checks canceled
and confirmed individual deletion, refreshed filtered/unfiltered lists and
global/filtered balances, and another client's deletion producing a recoverable real 404.
Participants are selected by fetched names; waits observe API responses and UI
states. `npm run test` remains the separate Vitest unit suite.

Browser reports, layout screenshots, and failure traces are ignored under
`frontend/playwright-report/` and `frontend/test-results/`. To view the last
report, run `npx playwright show-report` from `frontend`.

### Continuous integration

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs on pull requests and
pushes to `main`. Its job IDs and display names are `backend` / **Backend checks**
and `frontend` / **Frontend checks**, plus `backend-postgres` /
**PostgreSQL 17 checks**, `browser` / **Browser tests**, and `production-images` /
**Production images**. The existing four jobs retain their names and behavior.
They run the migration/seed checks,
system checks, tests, lint, formatting, typecheck, and build commands above.
Backend CI installs with `uv sync --locked`; frontend CI installs with `npm ci`.

CI uses `DEBUG=false`, an explicitly public CI-only `SECRET_KEY`, local allowed
hosts, and `SQLITE_PATH` under the runner's temporary directory.
`PYTHON_DOTENV_DISABLED=1` prevents Django from reading any local `.env`, and no
`--env-file` is supplied in CI. No production secrets are required. The frontend
sets the public `VITE_API_BASE_URL=http://localhost:8000`; its tests mock fetch,
so the jobs are independent.

The separate PostgreSQL job starts a disposable `postgres:17` service with
public CI-only credentials and a readiness check. It sets `DATABASE_URL`,
disables `.env` loading, verifies the PostgreSQL backend/server version, applies
migrations, runs `seed_participants` twice, checks migration drift and Django
configuration, and runs all backend tests against PostgreSQL. It uses no
production secrets and makes no connection to Hamravesh. GitHub-hosted execution
requires an authorized push/PR; this configuration change does not trigger it.

The independent Browser tests job installs from both lockfiles, installs
Chromium with its Ubuntu dependencies, then runs `npm run e2e`. The same
launcher creates and cleans a fresh temporary SQLite database for this job.
The job uses public disposable settings and no Hamravesh credentials or secrets.

The Production images job builds both Dockerfiles from repository-root context,
using locked dependencies and a harmless public frontend API URL. It runs the
existing disposable PostgreSQL 17 container smoke, reviews deployment checks,
shows logs on failure, and always removes the temporary stack. It publishes no
images and performs no deployment. See [operations](docs/operations.md) for
green-PR promotion from `main` to `release`, separate Hamravesh app configuration,
release commands, backups/restoration, acceptance checks, and rollback. Provider
settings and real public URLs remain pending verification.

## Data and API

`Participant.name` is unique and limited to 100 characters; empty and
whitespace-only names fail model validation. The database also rejects empty
and space-only names. `Expense` stores a payer and beneficiary, a positive
integer amount in cents, a description of at most 500 characters, a nullable
protected occasion reference, and a server-generated UTC creation timestamp.
The model permits empty descriptions;
the expense API requires a nonempty description after trimming. Database constraints
reject nonpositive amounts, identical payer/beneficiary pairs, and oversized
descriptions. Participant deletion is protected when an expense references it.

`Occasion.name` is limited to 100 characters; its trimmed spelling is retained
for display. One shared function trims names, normalizes Unicode to NFC, applies
casefolding, and normalizes to NFC again. Birthday / " birthday ", Été / été /
Été (decomposed accents), and Straße / STRASSE conflict; accents remain meaningful.
The resulting stored `canonical_name` is nonblank, non-null, and protected by a
database unique constraint in PostgreSQL and SQLite. API duplicate validation and
model writes use the same function, and insertion races return HTTP 400 `name`
errors. The key is internal and never appears in API responses. Occasions are
ordered by display name then ID.

Migration `0002_occasions` adds the model and nullable protected expense reference,
leaving old participants/expenses intact and old expenses ungrouped. Applied
migrations 0002 and 0003 are unchanged. New migration `0004_occasion_canonical_names`
checks every existing name before altering/backfilling, reports conflicting IDs
and spellings, then backfills keys without changing display names or expense
associations. It replaces the inadequate database `LOWER(TRIM(name))` index with
the canonical-key constraint. Conflicts require explicitly reviewed renames and
a retry; no rows are deleted or silently merged. There is no occasion editing
or deletion API.

`seed_participants` creates Alice, Bob, Charlie, and David. It is safe to rerun:
on a fresh database, running twice leaves exactly four participants. It keeps
existing participants and expenses intact and does not create expenses.

| Endpoint | Behavior |
| --- | --- |
| `GET /api/participants/` | Anonymous JSON array of `{id, name}`, ordered by name then id; empty tables return `[]`. |
| `POST`, `PUT`, `PATCH`, `DELETE /api/participants/` | Read-only participants: all return 405 and preserve existing people/expenses. |
| `GET /api/occasions/` | Anonymous array of `{id, name}`, ordered by name then ID. |
| `POST /api/occasions/` | Accepts `{name}`, trims it, returns 201 `{id, name}`; missing, blank, overlong, or case-insensitive duplicate names return 400 with `name` errors. PUT, PATCH, DELETE return 405. |
| `GET /api/expenses/` | Anonymous array of expenses, ordered by descending `created_at`, then descending `id`; returns `[]` when empty. |
| `GET /api/expenses/?occasion=<id>` | Filters by positive integer occasion ID with the same ordering; unknown IDs return `[]`, malformed IDs return field-level 400 errors. |
| `POST /api/expenses/` | Anonymous creation using participant IDs, an optional existing occasion ID (or null), a decimal string amount, and description; returns the created expense with 201. Invalid fields return 400 with field errors. PUT, PATCH, and DELETE on this collection return 405. |
| `DELETE /api/expenses/{id}/` | Anonymous deletion of exactly one expense; returns 204 with no body, or 404 for an unknown/already-deleted ID. Other operation methods on this detail URL return 405. |
| `GET /api/balances/` | Anonymous array of global pairwise debts across all occasions and ungrouped expenses, ordered by debtor ID then creditor ID; returns `[]` when empty or all pairs cancel. All other methods return 405. |
| `GET /api/balances/?occasion=<id>` | Recomputes pairwise debts using only that occasion’s expenses, before netting. Positive integer validation matches Expenses; unknown/empty occasions return `[]`. |
| `GET /health/live/` | Process liveness, returns `{"status":"alive"}` without database access. |
| `GET /health/ready/` | Checks database access, participant/occasion tables, the expense occasion column (0002), and the occasion canonical-name column (0004); returns `{"status":"ready"}`, or 503 with `{"status":"not_ready"}` when unavailable. An empty usable table is ready. |

### Request and response examples

`GET /api/participants/` returns, for example:

```json
[{"id": 1, "name": "Alice"}, {"id": 2, "name": "Bob"}]
```

Use returned IDs. Create an occasion with `POST /api/occasions/`:

```json
{"name": "Dinner"}
```

A 201 response is, for example, `{"id": 9, "name": "Dinner"}`.
`POST /api/expenses/` accepts:

```json
{
  "paid_by": 1,
  "expense_for": 2,
  "occasion": 9,
  "amount": "50.00",
  "description": "Lunch"
}
```

Both participants must exist and be distinct. The frontend optionally accepts an
existing occasion; selecting No occasion omits the field and creates an ungrouped expense.
The backend also accepts omission or explicit null from older clients. A supplied
occasion must be an existing positive JSON integer ID. Amounts must be strings of ASCII
digits, optionally followed by a decimal point and one or two digits, with a
value from `0.01` through `999999.99`. For example, `"1"`, `"1.2"`, and `"1.23"`
are accepted. Numeric JSON amounts, exponent notation, signs, zero, negative
values, whitespace, and more than two decimal places are rejected. Conversion
uses `Decimal` and stores integer cents without floating-point arithmetic.
Descriptions are required, trimmed, nonempty, and at most 500 characters after
trimming. The expense's `id` and `created_at` are server-owned.

The 201 response is an expense object; `GET /api/expenses/` returns an array of
these objects. Historical/ungrouped objects include `"occasion": null`.
Participant and assigned occasion details are nested, amounts always have two decimal
places, and timestamps use UTC ISO 8601:

```json
{
  "id": 1,
  "paid_by": {"id": 1, "name": "Alice"},
  "expense_for": {"id": 2, "name": "Bob"},
  "occasion": {"id": 9, "name": "Dinner"},
  "amount": "50.00",
  "description": "Lunch",
  "created_at": "2026-10-04T10:00:00Z"
}
```

With only that expense, `GET /api/balances/` returns:

```json
[
  {
    "debtor": {"id": 2, "name": "Bob"},
    "creditor": {"id": 1, "name": "Alice"},
    "amount": "50.00"
  }
]
```

To remove one expense, send `DELETE /api/expenses/1/` using the expense's numeric
ID from the list response. Success returns 204 with an empty body; repeat deletion
returns 404. The next GET of expenses and balances reflects the removal. There is
no bulk deletion, participant deletion, or balance deletion.

### Pairwise calculation

Without a filter, `GET /api/balances/` remains the global pairwise net across all
persisted expenses, including ungrouped history. The Balances view shows exactly
one list. All occasions uses this global response; opposing expenses across
occasions can cancel to an empty list, displayed as settled. Selecting a named
occasion uses `GET /api/balances/?occasion=<id>`: the backend selects that occasion’s
expenses **before** netting by pair, using integer cents; it never filters already
netted global debts. There are no separate balance records. Repeated payments add within an unordered
participant pair, and reverse payments subtract. If Alice pays `50.00` for Bob
and Bob pays `20.00` for Alice, Bob owes Alice `30.00`. If reverse payments exceed
the original payments, the debtor and creditor switch. Exact zero pairs are
omitted; all returned amounts are positive strings with two decimal places.
Totals may exceed the per-expense input cap. If the 50.00 payment is for Birthday
and the 20.00 reverse payment is for Trip, Birthday shows Bob owing Alice 50.00,
Trip shows Alice owing Bob 20.00, and the global overall balance is Bob owing
Alice 30.00. Each view shows only the selected scope.

Pairs remain independent. If Bob also pays `25.00` for Charlie, Charlie owes Bob
`25.00`; it does not change Bob's debt to Alice or create a Charlie-to-Alice debt.
Chains and cycles remain pairwise; no global or transitive simplification occurs.

Local URLs:

- Frontend: `http://localhost:5173/`
- Participants: `http://localhost:8000/api/participants/`
- Occasions: `http://localhost:8000/api/occasions/`
- Expenses: `http://localhost:8000/api/expenses/`
- Balances: `http://localhost:8000/api/balances/`
- Liveness: `http://localhost:8000/health/live/`
- Readiness: `http://localhost:8000/health/ready/`

With both local servers running, open Expenses or switch to Balances. A fresh
seeded database has no occasions or expenses. Add Expense works immediately:
choose payer and beneficiary, enter amount and description, and optionally choose
an occasion. No occasion omits that field from the POST payload, even when the
occasion lookup is empty or fails. Paid by, Expense for, Amount, and Description
have visible red asterisks and accessible required state; Occasion is optional.
Existing participants, including extra people already in a database, remain
selectable. Add Occasion uses a required trimmed, case-insensitively unique name;
success refreshes the list and makes the new occasion selectable. Failed writes
retain values and permit retry or Close/Escape after settling; Add Occasion also
provides Cancel.
Select an expense’s occasion-name button to filter Expenses. Expenses and Balances
have independent selections, both starting at All occasions. Balances has a labeled
selector for available occasions and shows one balance list: All occasions nets
all assigned and ungrouped expenses by participant pair, while a named occasion
shows only that occasion’s net. An empty global result means all pairs are settled,
including when opposite expenses cancel across occasions. Switching tabs retains
each tab’s own selection without copying it. Clear filter changes only that tab:
in Expenses it restores historical ungrouped entries; in Balances it restores the
global net. Saving or deleting an expense refreshes global and cached filtered
balances and expense lists.
Each expense card has a Delete action. Its confirmation names the description
and amount and initially focuses Cancel. Cancel/Escape leave the data unchanged
and restore the card button's focus. While deleting, controls are disabled to
prevent repeated requests. Failures keep the confirmation open with a useful
error and allow retry. Success refreshes both views and focuses the Expenses tab,
because the deleted card is removed.
For a simple API smoke check, run `curl --fail http://localhost:8000/api/participants/`
and `curl --fail http://localhost:8000/health/ready/`.

## Implemented scope and remaining work

The backend provides seeded read-only participants, occasion creation/listing,
expense creation/listing/filtering, confirmed individual deletion, global and
occasion-scoped pairwise balances, and
separate liveness/readiness checks. The additive migration preserves
old data and the API's optional occasion supports old expense clients during rollout.
The frontend provides responsive Expenses/Balances tabs, accessible Add Occasion
and Add Expense dialogs, optional occasion selection, filtering/clearing, and
query refreshes that preserve offline mutation behavior. Tests cover API/model
validation, migration preservation, financial semantics, keyboard/focus behavior,
and the real browser journey at desktop and 320px widths.

Gunicorn/Nginx images, strict production settings, PostgreSQL 17 CI, and a
disposable local container smoke are available. Before any authorized release,
verify the existing Hamravesh apps, candidate migration command mechanism,
backup restoration, health/routing, and actual frontend/API origins. Follow
[operations](docs/operations.md) for release-branch promotion, applying migration
pending 0002–0004 before backend promotion, frontend acceptance, and rollback without reversing
the additive schema. No production operation has been run for this change.
