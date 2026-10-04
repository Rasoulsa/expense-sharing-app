# Architecture and implementation plan

[challenge-spec.md](challenge-spec.md) is the authoritative interview specification.
The choices below keep this four-day implementation small and follow that specification.

## Application boundary

The repository contains a Django 5.2 LTS / Django REST Framework backend managed
by uv and a React / TypeScript / Vite frontend managed by npm. The browser uses
the API URL supplied through `VITE_API_BASE_URL`. The local Vite origin is
`http://localhost:5173`; Django permits exactly that CORS origin during development.

Day 3 slice 1 replaces the participant scaffold with one responsive page using
Expenses and Balances tabs, with Expenses selected initially. TanStack Query
loads each view through the typed fetch client, treats results as fresh for 30 seconds,
and cancels pending requests when leaving a view. Each view has loading, empty,
error, and explicit retry states. Tabs support arrow keys, Home, and End;
expense fields use labeled definitions and dates use semantic `time` elements.
Nested participant details come directly from the API; IDs stay numeric and
amounts stay decimal strings, displayed with a dollar prefix. No frontend
balance arithmetic is performed. The participants GET client supplies the
Add Expense modal. Vitest/React Testing Library tests exercise
the real client through mocked fetch, without a running backend.

Day 3 slice 2 adds the Add Expense button and a native modal dialog. The browser
makes the background inert; the modal explicitly wraps Tab/Shift+Tab among
enabled controls. Opening focuses the
dialog heading; Escape or Close dismisses it and restores focus to the button.
Participant options come from the API with loading, error/retry, and insufficient
participant states. The form validates participant choices, distinctness,
decimal syntax/range, and a trimmed description of at most 500 Unicode characters.
It uses a text amount field with decimal input mode, checks the range with exact
integer cents, and submits numeric participant IDs and the original decimal
string. Backend field errors remain associated with their inputs; failed POSTs
preserve all values and allow retry. Pending saves disable editing, dismissal,
and duplicate submission. Successful saves close the dialog, cancel any reads
started before the save, invalidate both list queries, and fetch fresh expenses
and balances, including an unopened view.
Refresh failures use the existing view error/retry state. Query options live in
`frontend/src/queries.ts`; the slice 1 query keys remain unchanged.

Day 3 browser validation uses Playwright Chromium against real Vite and Django
servers. `frontend/playwright.config.ts` starts both without server reuse, using
`http://localhost:5173` as the exact allowed CORS origin and
`http://127.0.0.1:8001` as the API URL. The test-only backend launcher creates a
fresh temporary SQLite database, disables `.env` loading and inherited
PostgreSQL settings, migrates and seeds, then serves until Playwright shuts it
down. Shutdown closes database connections and removes the temporary database.
The single journey verifies fetched participant names, both directions of modal
focus wrapping and Escape, opposite expenses of `50.00` and `20.00`, the
resulting `Bob owes Alice $30.00`, and persistence after reload. It additionally
creates Mina Farah through Add Person, checks that both expense selects refresh,
and records an Alice-for-Mina `15.00` expense, preserving the independent Bob debt.
Desktop and 320px phone checks save layout screenshots, including the dialogs.
The journey also cancels deletion without a DELETE or persisted changes, removes
the `20.00` reverse expense, and verifies `Bob owes Alice $50.00` after reload.
Another client's real API deletion produces a deterministic stale-card 404,
which the browser displays without dismissing the confirmation.
Requests are
real and waits observe responses/UI state. Browser specs stay separate from
Vitest and are included in TypeScript and ESLint checks.

The focused Day 3 improvement adds an optional Add Person native dialog. Opening
focuses its name input; both dialogs share the same Tab/Shift+Tab wrapping helper.
Escape and Close restore their trigger focus when idle. Local validation rejects
blank names and names longer than 100 Unicode characters after trimming. Backend
field errors are associated with the name input, and failed saves retain its value.
Pending saves disable editing, dismissal, and repeated submission. Successful
creation announces the new person, closes the dialog, cancels older participant
reads, and invalidates/refetches the existing participants query. Expenses still
submit numeric IDs with decimal string amounts. Refresh failures use the existing
participant query retry state. The page uses compact green rows with decorative
initials, description, payer → beneficiary, a prominent amount, and semantic dates;
each balance remains readable as “X owes Y $Z”.

Single-expense deletion adds a Delete action to each card and a native
confirmation naming its description and amount. Opening focuses Cancel; Escape
or Cancel returns focus to that card without changing data. Pending deletion
disables controls and dismissal and prevents duplicate requests. After a 204,
older GETs are canceled before the deleted ID is removed from the expenses cache,
so canceling a later refresh cannot restore the card or allow another DELETE.
Errors remain in the confirmation with an alert and focus; a 404 explains that the list needs
reloading. On success, focus moves to the stable Expenses tab, a status message
announces removal, and both expense/balance queries refresh. Creation and deletion
share `refreshExpenseViews`, including cancellation of older reads and fetching
an unopened view. Refreshes run independently of the completed mutation, so slow
or offline-paused reads cannot keep a successful write pending. All three write
mutations use `networkMode: 'always'` with `retry: false`: an offline fetch fails
with an error, releases the controls and Escape, and is not queued for reconnection.
Read queries retain their online-only behavior. A refresh failure uses the existing
view retry state after the successful mutation. No optimistic balance arithmetic
is performed.

Participants are seeded beforehand. `seed_participants` ensures Alice, Bob,
Charlie, and David exist using `get_or_create`, preserving participant IDs and
existing expenses. A fresh database still has exactly four participants after
two runs. People added through the API and expenses involving them survive reruns.
Optional participant creation is a user-requested Day 3 extension to the original
challenge; no login, authentication, or registration is introduced.
All three application endpoints are anonymous; participants and expenses support
listing and creation, while balances reject writes. CORS is a
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
| `GET /api/participants/` | Array of `{id, name}`, ordered by name then ID. |
| `POST /api/participants/` | Accepts `{name}`, trims whitespace, rejects blank, overlong (100 characters), and duplicate names with field-level 400 errors; returns 201 `{id, name}`. IDs are server-owned. PUT, PATCH, and DELETE return 405. |
| `GET /api/expenses/` | Array ordered by `-created_at`, then `-id`; each expense includes nested payer/beneficiary, a two-decimal amount string, description, and server-owned UTC ISO 8601 timestamp. |
| `POST /api/expenses/` | Accepts existing, distinct participant IDs, decimal string amount, and description. Returns 201 with the created expense, or 400 with useful field errors. Other write methods on the collection return 405. |
| `DELETE /api/expenses/{id}/` | Removes exactly one expense, returning 204 with an empty body; unknown/already-deleted IDs return 404. Other operation methods on the detail URL return 405. |
| `GET /api/balances/` | Array of `{debtor, creditor, amount}`, with nested `{id, name}` participants and a positive two-decimal amount string, ordered by debtor ID then creditor ID. All other methods return 405. |

All GET arrays return `[]` when empty. Balance pairs with exact cancellation are
also omitted. Participant creation is optional; expense deletion is limited to
one ID at a time. There is no editing, bulk deletion, participant deletion,
balance deletion, settlement, or authentication feature.

Names retain their original spelling and case after trimming. Uniqueness uses the
existing model's exact name constraint. The serializer also turns a uniqueness
collision during insertion into a field-level error, without changing the schema.

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

At deployment time, run `python manage.py check --deploy`,
`python manage.py migrate --noinput`, and `python manage.py seed_participants`
from the production backend image inside
Hamravesh, with the private production environment injected, before serving
traffic. Seeds remain idempotent and preserve existing data. No production
credentials belong in Git or GitHub CI. No deployment or production data
operation has been performed. Day 4 still needs authorized deployment, internal
backend connectivity, and backup/restore verification for managed PostgreSQL.

## Day 4 packaging boundary

Both Dockerfiles build from the repository root with its `.dockerignore`.
The backend installs only locked production dependencies and runs Gunicorn
through `config.wsgi:application`, using `config.production` on port 8000 as a
non-root user. That settings module requires PostgreSQL, a production key,
explicit allowed hosts, and one exact frontend CORS origin; local SQLite and
both existing database CI jobs retain `config.settings`. The JSON-only API
requires no static asset server. Migrations and seeds are one-off release
commands, never part of builds or worker startup.

The frontend builds with npm ci/Vite and a required public `VITE_API_BASE_URL`
build argument, then serves `dist` with Nginx on port 80, including `/health/`
and SPA fallback. The URL is compiled into JavaScript and changes require a
rebuild. The typed client and Day 3 application behaviors remain unchanged.
Production defaults to HTTPS redirects and trusts no forwarded scheme header
until the actual ingress sanitization/header contract is verified. Health
probes are exempt from redirects. HSTS awaits HTTPS verification.

[Production packaging](production-packaging.md) records the complete environment
contract, deployment-check warnings, ingress requirements, and disposable local
`compose.smoke.yml` workflow. That PostgreSQL 17 tmpfs database is independent
of Hamravesh. Packaging ends before cloud resources or deployment.

## Checks and CI

`.github/workflows/ci.yml` runs on pull requests and pushes to `main` with
`Backend checks`, `Frontend checks`, `PostgreSQL 17 checks`, and `Browser tests`.
It also includes `Production images`; the existing four job definitions remain
unchanged. The image job builds both root-context Dockerfiles, uses public
disposable settings, migrates/seeds a temporary PostgreSQL 17 database, and runs
the existing container HTTP/API smoke before cleanup. It publishes no image and
performs no deployment. [Operations](operations.md) defines the future
main-to-release promotion, verified provider configuration, backups, restore,
and rollback procedure. The independent browser
job installs both lockfiles and Chromium with Ubuntu system dependencies, then
runs the real-server journey with public disposable settings and no secrets.
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
| 3 | One-page Expenses and Balances views, accessible Add Expense and optional Add Person dialogs, compact amount/date presentation, submission and refresh behavior, frontend integration tests. | Complete locally: unit tests and the real Django/Vite Chromium journey cover participant creation and desktop/phone layouts. Browser CI configured; GitHub-hosted execution awaits an authorized push/PR. |
| 4 | Package production images; later verify Hamravesh/cloud access, managed PostgreSQL connectivity, authorized deployment, and submission. | Production packaging implemented; cloud/deployment work remains pending and unauthorized. |
