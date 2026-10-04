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
All three application endpoints are anonymous; participants and balances reject
writes, while expenses support listing and creation. CORS is a
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

The balance service, `backend/expenses/services.py::calculate_balances`, reads
persisted expenses on each query and accumulates signed integer cents keyed by
the lower and higher participant IDs. A payment by the lower ID adds cents;
a payment by the higher ID subtracts cents. The sign selects the creditor and
debtor, and the absolute value gives the positive debt. It creates no balance
records and does not change expenses or cache results between requests.

The calculation nets repeated and reverse expenses within each unordered pair of
participants. If Alice pays 5,000 cents for Bob and Bob pays 2,000 cents for
Alice, Bob owes Alice 3,000 cents. A zero net pair is omitted. Debts involving
a third participant remain separate; there is no global debt optimization or
automatic transfer of debts across people. For example, if Bob also pays 2,500
cents for Charlie, Charlie owes Bob 2,500 cents while Bob still owes Alice 3,000
cents. Chains and cycles are not simplified through a third participant.

## Application API

| Endpoint | Contract |
| --- | --- |
| `GET /api/participants/` | Array of `{id, name}`, ordered by name then ID; writes return 405. |
| `GET /api/expenses/` | Array ordered by `-created_at`, then `-id`; each expense includes nested payer/beneficiary, a two-decimal amount string, description, and server-owned UTC ISO 8601 timestamp. |
| `POST /api/expenses/` | Accepts existing, distinct participant IDs, decimal string amount, and description. Returns 201 with the created expense, or 400 with useful field errors. Other write methods return 405. |
| `GET /api/balances/` | Array of `{debtor, creditor, amount}`, with nested `{id, name}` participants and a positive two-decimal amount string, ordered by debtor ID then creditor ID. All other methods return 405. |

All GET arrays return `[]` when empty. Balance pairs with exact cancellation are
also omitted. Participants remain read-only; there is no edit, delete, settlement,
or authentication feature.

Expense amounts must be exact decimal strings of ASCII digits with an optional
decimal point and one or two fractional digits, from `0.01` through `999999.99`.
Whole-number strings such as `"1"` and one-place strings such as `"1.2"` are
accepted and returned as `"1.00"` and `"1.20"`. Numeric JSON values, exponent
notation, signs, zero, negative values, whitespace, and excessive precision are
rejected. The serializer uses `Decimal` for conversion to integer cents and for
response formatting; balance arithmetic uses integers. A balance can exceed the
per-expense input cap. API descriptions are trimmed, required, nonempty, and
bounded by the model's 500-character limit after trimming. The expense's `id` and
`created_at` are read-only; timestamps are generated on the server and returned in UTC even
if another timezone is active.

Example `GET /api/participants/` response (IDs depend on the database):

```json
[{"id": 1, "name": "Alice"}, {"id": 2, "name": "Bob"}]
```

Example `POST /api/expenses/` request:

```json
{
  "paid_by": 1,
  "expense_for": 2,
  "amount": "50.00",
  "description": "Lunch"
}
```

Example 201 response; `GET /api/expenses/` wraps expense objects in an array:

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

Example `GET /api/balances/` response after that expense and a reverse `20.00`
payment from Bob for Alice:

```json
[
  {
    "debtor": {"id": 2, "name": "Bob"},
    "creditor": {"id": 1, "name": "Alice"},
    "amount": "30.00"
  }
]
```

## Storage and Hamravesh decision

SQLite is the local development choice, as preferred by the challenge.
Its default file is the ignored `backend/.local/expenses.sqlite3`. The optional
`SQLITE_PATH` environment variable selects an absolute file path and the backend
creates its parent directory. SQLite CI uses a disposable file under the runner's
temporary directory; SQLite tests use a separate in-memory database. Database files
and local environment files must not be version controlled.

**Production storage decision: managed PostgreSQL 17 on Hamravesh.** The healthy
resource is `expense-db` in cluster `hamravesh-c11`, namespace
`saeidirasoul-expense-sharing`. Its connection panel lists the database name as
`postgres`; this differs from the resource name. The backend connects over the
internal cluster network. No public database access or connection from a
developer's Mac is required. The application must be accessible from Iran;
deployment and application connectivity have not yet been verified.

`DATABASE_URL`, when present, takes precedence over `SQLITE_PATH`. Django uses
`dj-database-url` to configure its PostgreSQL backend and Psycopg 3 (the binary
distribution includes its client libraries). A placeholder is
`postgresql://DB_USER:DB_PASSWORD@INTERNAL_DB_HOST:5432/postgres`. Use the actual
host, port, and credentials from the connection panel only in Hamravesh's private
backend environment. Percent-encode special characters in credentials; URL
query options, including TLS configuration, are preserved. Empty, malformed,
non-PostgreSQL URLs, or URLs lacking a host/database name fail startup with a
sanitized configuration error instead of selecting SQLite. When `DATABASE_URL`
is absent, the existing local `.env`, default SQLite file, and `SQLITE_PATH`
override continue to work.

At deployment time, run `uv run --locked python manage.py migrate --noinput`
and `uv run --locked python manage.py seed_participants` from the backend inside
Hamravesh, with the private production environment injected, before serving
traffic. Seeds remain idempotent and preserve existing data. No production
credentials belong in Git or GitHub CI. This preparation adds database
configuration and CI coverage; no deployment or production data operation has
been performed. Day 4 still needs deployment, internal backend connectivity,
and backup/restore verification for managed PostgreSQL.

## Checks and CI

`.github/workflows/ci.yml` runs on pull requests and pushes to `main` with
`Backend checks`, `Frontend checks`, and a separate `PostgreSQL 17 checks` job.
Python 3.13 and Node 24 are selected from the projects' version files.
uv installs from `backend/uv.lock` using
`uv sync --locked`; npm installs from `frontend/package-lock.json` using
`npm ci`. The jobs run the same Django, pytest, Ruff, frontend lint, TypeScript,
Vitest, and build checks documented in the README.

The existing Backend checks job keeps SQLite and the Frontend checks job stays
independent. Backend CI sets explicit public CI-only settings and
`PYTHON_DOTENV_DISABLED=1`. It uses neither a developer `.env` nor production
secrets. It applies migrations and seeds twice before checking migration drift,
Django configuration, tests,
and style. Health liveness avoids the database. Readiness queries the participant
table, returning 503 when the connection or schema is unavailable; an empty
usable table is ready.

The PostgreSQL job starts a disposable `postgres:17` service with a readiness
check and public CI-only credentials, then sets `DATABASE_URL`. It verifies
the PostgreSQL backend and server major version, applies migrations, seeds
twice, checks migration drift and Django configuration, and runs the backend
tests. pytest-django uses a separate `test_<database-name>` PostgreSQL database;
its CI user has permission to create it. SQLite tests continue to use an
in-memory database. Focused settings tests isolate their environment and never
change the active test connection. CI does not connect to Hamravesh and uses no
Hamravesh credentials.

## Four-day plan

| Day | Scope | Status |
| --- | --- | --- |
| 1 | Scaffold, Participant and Expense models, migration, idempotent seeds, read-only participants API, health checks, participant page states, focused tests, CI, setup and architecture docs. | Implemented locally; first GitHub-hosted CI execution awaits an authorized push/PR. |
| 2 | Expense creation/list APIs, input validation, pairwise balance calculation and API, focused financial and API tests. | Implemented locally in slices 1 and 2; CI execution awaits an authorized push/PR. |
| 3 | One-page Expenses and Balances views, Add Expense modal using seeded participants, amount/date display, submission and refresh behavior, frontend integration tests. | Planned; not implemented. |
| 4 | Verify Hamravesh/cloud access from Iran and internal backend connectivity to managed PostgreSQL, add deployment configuration, complete deployment and smoke checks, finalize repository URL and submission instructions. | Planned; no deployment authorized or performed. |
