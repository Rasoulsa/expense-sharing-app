# Expense Sharing App

The authoritative interview requirements are in [docs/challenge-spec.md](docs/challenge-spec.md).
Design decisions and the Day 2–4 plan are in [docs/architecture.md](docs/architecture.md).
An expense is directional: the beneficiary owes the payer. Balances will be netted
between each pair of people. Users will be seeded beforehand.

## Stack

- Backend: Python 3.13, Django 5.2.17 LTS, Django REST Framework 3.16.1, uv,
  Ruff 0.14.10, pytest 9.0.2, and pytest-django 4.12.0.
- Frontend: Node.js 24 LTS, React 19.3.0, TypeScript 5.9.3, Vite 8.3.2,
  ESLint 9.39.1, and Vitest 5.0.3.
- Local database: SQLite at `backend/.local/expenses.sqlite3`.

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
Production disk/SQLite compatibility remains pending verification.

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

Backend tests use pytest-django's isolated in-memory SQLite database, separate
from the local development database. Frontend tests use Vitest, React Testing
Library, and jsdom, with mocked HTTP responses at the fetch boundary.

### Continuous integration

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs on pull requests and
pushes to `main`. Its job IDs and display names are `backend` / **Backend checks**
and `frontend` / **Frontend checks**. The jobs run the migration/seed checks,
system checks, tests, lint, formatting, typecheck, and build commands above.
Backend CI installs with `uv sync --locked`; frontend CI installs with `npm ci`.

CI uses `DEBUG=false`, an explicitly public CI-only `SECRET_KEY`, local allowed
hosts, and `SQLITE_PATH` under the runner's temporary directory.
`PYTHON_DOTENV_DISABLED=1` prevents Django from reading any local `.env`, and no
`--env-file` is supplied in CI. No production secrets are required. The frontend
sets the public `VITE_API_BASE_URL=http://localhost:8000`; its tests mock fetch,
so the jobs are independent. GitHub-hosted execution has not been triggered yet.

## Data and API

`Participant.name` is unique and limited to 100 characters; empty and
whitespace-only names fail model validation. The database also rejects empty
and space-only names. `Expense` stores a payer and beneficiary, a positive
integer amount in cents, a description of at most 500 characters (empty is
allowed), and a server-generated UTC creation timestamp. Database constraints
reject nonpositive amounts, identical payer/beneficiary pairs, and oversized
descriptions. Participant deletion is protected when an expense references it.

`seed_participants` creates Alice, Bob, Charlie, and David. It is safe to rerun:
on a fresh database, running twice leaves exactly four participants. It keeps
existing participants and expenses intact and does not create expenses.

| Endpoint | Behavior |
| --- | --- |
| `GET /api/participants/` | Anonymous JSON array of `{id, name}`, ordered by name then id; empty tables return `[]`. Writes return 405. |
| `GET /health/live/` | Process liveness, returns `{"status":"alive"}` without database access. |
| `GET /health/ready/` | Checks database access and the participant table; returns `{"status":"ready"}`, or 503 with `{"status":"not_ready"}` when unavailable. An empty usable table is ready. |

Local URLs:

- Frontend: `http://localhost:5173/`
- Participants: `http://localhost:8000/api/participants/`
- Liveness: `http://localhost:8000/health/live/`
- Readiness: `http://localhost:8000/health/ready/`

With both local servers running, open the frontend to see the seeded names.
For a simple API smoke check, run `curl --fail http://localhost:8000/api/participants/`
and `curl --fail http://localhost:8000/health/ready/`.

## Day 1 scope

Prompt 2 adds the Participant and Expense models, initial migration, participant
seed command, read-only participants API, and health checks. The frontend
fetches participant names and shows loading, empty, error, and retry states.
Prompt 3 adds CI and completes setup and architecture documentation.

| Day | Planned work |
| --- | --- |
| 2 | Expenses list/create API, validation, pairwise balances API and financial tests. |
| 3 | Expenses and Balances views, Add Expense modal, submission/refresh behavior, frontend integration tests. |
| 4 | Verify Hamravesh/cloud access and durable storage, add deployment configuration, deploy when authorized, smoke test and finalize submission. |

These later features are not implemented yet. Hamravesh persistent disk and
SQLite locking/persistence compatibility are **pending verification**; see the
[storage decision](docs/architecture.md#storage-and-hamravesh-decision).
