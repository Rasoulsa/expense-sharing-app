# Expense Sharing App

The authoritative interview requirements are in [docs/challenge-spec.md](docs/challenge-spec.md).
Design decisions and the implementation plan are in [docs/architecture.md](docs/architecture.md).
An expense is directional: the beneficiary owes the payer. Balances are netted
between each pair of people. Participants are seeded beforehand.

## Stack

- Backend: Python 3.13, Django 5.2.17 LTS, Django REST Framework 3.16.1, uv,
  Ruff 0.14.10, pytest 9.0.2, and pytest-django 4.12.0.
- Frontend: Node.js 24 LTS, React 19.3.0, TypeScript 5.9.3, Vite 8.3.2,
  ESLint 9.39.1, and Vitest 5.0.3.
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

Production uses the healthy managed PostgreSQL 17 resource `expense-db` in
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

At deployment time, run these from the **backend inside Hamravesh**, with its
environment already configured, before serving traffic:

```sh
uv run --locked python manage.py migrate --noinput
uv run --locked python manage.py seed_participants
```

The seed command is safe to rerun. These deployment operations have not been
performed; this change prepares configuration and CI only.

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
npm run build
```

With `DATABASE_URL` unset, backend tests use pytest-django's isolated in-memory
SQLite database, separate from local development data. With a PostgreSQL URL,
pytest-django creates and destroys a separate `test_<database-name>` database;
the disposable CI user can create it. Frontend tests use Vitest, React Testing
Library, and jsdom, with mocked HTTP responses at the fetch boundary.

### Continuous integration

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs on pull requests and
pushes to `main`. Its job IDs and display names are `backend` / **Backend checks**
and `frontend` / **Frontend checks**, plus `backend-postgres` /
**PostgreSQL 17 checks**. The existing jobs run the migration/seed checks,
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

## Data and API

`Participant.name` is unique and limited to 100 characters; empty and
whitespace-only names fail model validation. The database also rejects empty
and space-only names. `Expense` stores a payer and beneficiary, a positive
integer amount in cents, a description of at most 500 characters, and a
server-generated UTC creation timestamp. The model permits empty descriptions;
the expense API requires a nonempty description after trimming. Database constraints
reject nonpositive amounts, identical payer/beneficiary pairs, and oversized
descriptions. Participant deletion is protected when an expense references it.

`seed_participants` creates Alice, Bob, Charlie, and David. It is safe to rerun:
on a fresh database, running twice leaves exactly four participants. It keeps
existing participants and expenses intact and does not create expenses.

| Endpoint | Behavior |
| --- | --- |
| `GET /api/participants/` | Anonymous JSON array of `{id, name}`, ordered by name then id; empty tables return `[]`. Writes return 405. |
| `GET /api/expenses/` | Anonymous array of expenses, ordered by descending `created_at`, then descending `id`; returns `[]` when empty. |
| `POST /api/expenses/` | Anonymous creation using participant IDs, a decimal string amount, and description; returns the created expense with 201. Invalid fields return 400 with field errors. PUT, PATCH, and DELETE return 405. |
| `GET /api/balances/` | Anonymous array of pairwise debts, ordered by debtor ID then creditor ID; returns `[]` when empty or all pairs cancel. All other methods return 405. |
| `GET /health/live/` | Process liveness, returns `{"status":"alive"}` without database access. |
| `GET /health/ready/` | Checks database access and the participant table; returns `{"status":"ready"}`, or 503 with `{"status":"not_ready"}` when unavailable. An empty usable table is ready. |

### Request and response examples

`GET /api/participants/` returns, for example:

```json
[{"id": 1, "name": "Alice"}, {"id": 2, "name": "Bob"}]
```

Use IDs returned by that endpoint. `POST /api/expenses/` accepts:

```json
{
  "paid_by": 1,
  "expense_for": 2,
  "amount": "50.00",
  "description": "Lunch"
}
```

Both participants must exist and be distinct. Amounts must be strings of ASCII
digits, optionally followed by a decimal point and one or two digits, with a
value from `0.01` through `999999.99`. For example, `"1"`, `"1.2"`, and `"1.23"`
are accepted. Numeric JSON amounts, exponent notation, signs, zero, negative
values, whitespace, and more than two decimal places are rejected. Conversion
uses `Decimal` and stores integer cents without floating-point arithmetic.
Descriptions are required, trimmed, nonempty, and at most 500 characters after
trimming. The expense's `id` and `created_at` are server-owned.

The 201 response is an expense object; `GET /api/expenses/` returns an array of
these objects. Participant details are nested, amounts always have two decimal
places, and timestamps use UTC ISO 8601:

```json
{
  "id": 1,
  "paid_by": {"id": 1, "name": "Alice"},
  "expense_for": {"id": 2, "name": "Bob"},
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

### Pairwise calculation

Every balance query derives debts from persisted expenses using integer cents;
there are no separate balance records. Repeated payments add within an unordered
participant pair, and reverse payments subtract. If Alice pays `50.00` for Bob
and Bob pays `20.00` for Alice, Bob owes Alice `30.00`. If reverse payments exceed
the original payments, the debtor and creditor switch. Exact zero pairs are
omitted; all returned amounts are positive strings with two decimal places.
Totals may exceed the per-expense input cap.

Pairs remain independent. If Bob also pays `25.00` for Charlie, Charlie owes Bob
`25.00`; it does not change Bob's debt to Alice or create a Charlie-to-Alice debt.
Chains and cycles remain pairwise; no global or transitive simplification occurs.

Local URLs:

- Frontend: `http://localhost:5173/`
- Participants: `http://localhost:8000/api/participants/`
- Expenses: `http://localhost:8000/api/expenses/`
- Balances: `http://localhost:8000/api/balances/`
- Liveness: `http://localhost:8000/health/live/`
- Readiness: `http://localhost:8000/health/ready/`

With both local servers running, open the frontend to see the seeded names.
For a simple API smoke check, run `curl --fail http://localhost:8000/api/participants/`
and `curl --fail http://localhost:8000/health/ready/`.

## Implemented scope and remaining work

Prompt 2 adds the Participant and Expense models, initial migration, participant
seed command, read-only participants API, and health checks. The frontend
fetches participant names and shows loading, empty, error, and retry states.
Prompt 3 adds CI and completes setup and architecture documentation.
Day 2 adds the expense list/create API, validation, a service deriving pairwise
balances from persisted expenses, the balances API, and focused financial/API tests.

| Day | Planned work |
| --- | --- |
| 3 | Expenses and Balances views, Add Expense modal, submission/refresh behavior, frontend integration tests. |
| 4 | Verify Hamravesh/cloud access and backend access to managed PostgreSQL, add deployment configuration, deploy when authorized, smoke test and finalize submission. |

These later features are not implemented yet. Production storage is managed
PostgreSQL 17; deployment and backend connectivity checks remain pending. See the
[storage decision](docs/architecture.md#storage-and-hamravesh-decision).
