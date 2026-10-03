# Architecture and implementation plan

[challenge-spec.md](challenge-spec.md) is the authoritative interview specification.
The choices below keep this four-day implementation small and follow that specification.

## Application boundary

The repository contains a Django 5.2 LTS / Django REST Framework backend managed
by uv and a React / TypeScript / Vite frontend managed by npm. The browser uses
the API URL supplied through `VITE_API_BASE_URL`. The local Vite origin is
`http://localhost:5173`; Django permits exactly that CORS origin during development.

Participants are seeded beforehand. `seed_participants` ensures Alice, Bob,
Charlie, and David exist using `get_or_create`, preserving participant IDs and
existing expenses. A fresh database still has exactly four participants after
two runs. There is no login, authentication, registration, or user creation UI.
The current participants endpoint is anonymous and rejects writes. CORS is a
browser origin policy and does not turn the public API into an authenticated API.

## Data and financial semantics

`Participant` has a unique, nonempty display name. `Expense` records exactly
one payer (`paid_by`) and one beneficiary (`expense_for`), who must be different.
The beneficiary owes the payer. For example, Alice paying 5,000 cents for Bob
means Bob owes Alice 5,000 cents.

Amounts are positive integer cents, avoiding floating-point arithmetic for
money. Descriptions are bounded to 500 characters. Foreign keys protect
participants referenced by expenses from deletion. Creation timestamps are
generated on the backend and stored/read with timezone support in UTC.

The planned balance calculation nets expenses within each unordered pair of
participants. If Alice pays 5,000 cents for Bob and Bob pays 2,000 cents for
Alice, Bob owes Alice 3,000 cents. A zero net pair is omitted. Debts involving
a third participant remain separate; there is no global debt optimization or
automatic transfer of debts across people. This calculation is planned for
Day 2 and is not implemented in Day 1.

## Storage and Hamravesh decision

SQLite is the current development choice, as preferred by the challenge.
Its default file is the ignored `backend/.local/expenses.sqlite3`. The optional
`SQLITE_PATH` environment variable selects an absolute file path and the backend
creates its parent directory. CI uses a disposable file under the runner's
temporary directory; pytest uses a separate in-memory database. Database files
and local environment files must not be version controlled.

The deployment must be accessible from Iran. Hamravesh is a candidate from the
original task, which mentions signup credits/discounts. No deployment has been
made, and no Hamravesh disk or SQLite compatibility has been verified.

**Production storage decision: pending verification.** Keeping SQLite in
production is conditional on verifying a durable, writable mounted disk with
SQLite-compatible locking and persistence through application restarts and
redeploys. A single backend instance is the provisional SQLite deployment plan.
Day 4 must verify disk mount paths and permissions, locking behavior, storage
lifecycle, and backup/restore. An ephemeral application filesystem is not a
durability plan. If suitable disk semantics cannot be confirmed, use a managed
relational database and document the revised choice before deploying. No
PostgreSQL service or production storage integration is part of Day 1.

## Checks and CI

`.github/workflows/ci.yml` runs on pull requests and pushes to `main` with
`Backend checks` and `Frontend checks`. Python 3.13 and Node 24 are selected
from the projects' version files. uv installs from `backend/uv.lock` using
`uv sync --locked`; npm installs from `frontend/package-lock.json` using
`npm ci`. The jobs run the same Django, pytest, Ruff, frontend lint, TypeScript,
Vitest, and build checks documented in the README.

Backend CI sets explicit public CI-only settings and `PYTHON_DOTENV_DISABLED=1`.
It uses neither a developer `.env` nor production secrets. It applies migrations
and seeds twice before checking migration drift, Django configuration, tests,
and style. Health liveness avoids the database. Readiness queries the participant
table, returning 503 when the connection or schema is unavailable; an empty
usable table is ready.

## Four-day plan

| Day | Scope | Status |
| --- | --- | --- |
| 1 | Scaffold, Participant and Expense models, migration, idempotent seeds, read-only participants API, health checks, participant page states, focused tests, CI, setup and architecture docs. | Implemented locally; first GitHub-hosted CI execution awaits an authorized push/PR. |
| 2 | Expense creation/list APIs, input validation, pairwise balance calculation and API, focused financial and API tests. | Planned; not implemented. |
| 3 | One-page Expenses and Balances views, Add Expense modal using seeded participants, amount/date display, submission and refresh behavior, frontend integration tests. | Planned; not implemented. |
| 4 | Verify Hamravesh/cloud access from Iran and production storage, add deployment configuration, complete deployment and smoke checks, finalize repository URL and submission instructions. | Planned; no deployment authorized or performed. |
