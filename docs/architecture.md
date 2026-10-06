# Architecture and implementation plan

[challenge-spec.md](challenge-spec.md) is the authoritative interview specification.
Participants are seeded and read-only. Occasions and individual expense deletion
are the requested extensions; authentication, registration, groups, and settlement
are outside this implementation.

## Application boundary

Django 5.2 LTS / Django REST Framework supplies an anonymous JSON API, managed by
uv. React / TypeScript / Vite supplies one responsive page, managed by npm. The
browser calls the public API origin compiled through `VITE_API_BASE_URL`. Local
Vite uses `http://localhost:5173`; Django allows exactly that development CORS
origin. CORS is a browser origin policy, not authentication.

Expenses is the initial tab; Balances shows global pairwise debts by default, or the selected occasion’s debts.
Both have loading, empty, error, and explicit retry states. Tabs support arrow
keys, Home, and End. Semantic lists, labeled definitions, and `time` elements
expose expense fields; amounts remain decimal strings with a dollar prefix.
The frontend does no balance arithmetic.

`seed_participants` uses `get_or_create` for Alice, Bob, Charlie, and David.
Two runs on a fresh database leave exactly four participants. Existing IDs,
extra participants, and all expenses survive reruns. Participants from the API
remain available in expense selects; the application has no participant creation,
editing, or deletion flow.

## Occasions and accessible forms

Add Occasion opens a native modal with focus on its required name input. Local
validation trims the name and rejects blank or more than 100 Unicode characters.
Field-level API errors are associated with the input. Failure preserves values;
Cancel, Close, and Escape work after the failed request settles. Pending saves
disable editing/dismissal and a synchronous guard prevents duplicate requests.
Success announces the name, closes the modal, cancels earlier occasion reads,
and invalidates/refetches the occasion list, even before Add Expense is opened.
Refresh errors appear through the occasion loading/retry state in Add Expense.

Add Expense focuses its heading and obtains participants and occasions from the
API. The four required labels—Paid by, Expense for, Amount, Description—have a
visible red asterisk hidden from the accessible name; native `required`,
`aria-invalid`, associated hints/errors, and error focus expose validation.
Occasion has no required marker or required validation. Its empty choice is
No occasion and omits `occasion` from the POST payload. Saving remains possible
with no occasions or a pending/failed occasion lookup; that lookup has a retry
control. A selected occasion must exist. Payer/beneficiary must exist and differ.
Amount uses a text field with decimal input mode and exact-cent validation.
Description is trimmed and bounded to 500 Unicode characters. Submitted IDs
are numeric; amount is a decimal string. API failure preserves all fields.
Pending writes prevent duplicates.

Native dialogs make the background inert and share explicit Tab/Shift+Tab focus
wrapping. Idle dismissal restores trigger focus. Each expense card has an
individual Delete action with confirmation, description/amount, and initial focus
on Cancel. Failure retains the confirmation with an alert; stale-ID 404 explains
that reload is needed. Successful deletion focuses the stable Expenses tab.

Assigned expenses show their occasion name as a keyboard-accessible button with
an accessible filtering label and pressed state. It filters Expenses by occasion
ID and focuses Clear filter. The filter remains clearable while loading, empty,
or failed. Clearing restores all expenses and focuses the Expenses tab.
Historical `occasion: null` expenses appear in the unfiltered list. Expenses and
Balances retain independent occasion selections, both defaulting to All occasions.
Expense badges affect only Expenses; the Balances selector affects only Balances.
Switching tabs never copies a selection. Clear filter changes only the current tab.
Balances shows exactly one list: All occasions calls `GET /api/balances/` and shows
the global pairwise net; a named occasion calls `GET /api/balances/?occasion=<id>`.
An empty global list clearly indicates all pairs are settled, including opposing
expenses that cancel across occasions. There are no grouped balance sections.
Filtered empty states and subtitles name the occasion; changing the Balances
select retains keyboard focus. Compact green rows, wrapping names/actions,
and scrollable dialogs preserve desktop and 320px layouts.

## Query and mutation behavior

TanStack Query's shared options live in `frontend/src/queries.ts`. Reads pass an
AbortSignal to the typed fetch client, have no automatic retry, and are fresh for
30 seconds. Leaving a view/filter cancels its read. Query keys are:

| Data | Key |
| --- | --- |
| Participants | `['participants']` |
| Occasions | `['occasions']` |
| All expenses | `['expenses']` |
| One occasion's expenses | `['expenses', { occasion: id }]` |
| Global balances | `['balances']` |
| One occasion’s balances | `['balances', { occasion: id }]` |

Expense creation/deletion share `refreshExpenseViews`: cancel all expense-prefix
reads and all balance-prefix reads, invalidate those caches, then refresh all cached
expense lists and balance queries, including inactive filters, plus the unfiltered
expense list and global balances even if unopened.
Deletion removes its ID from every cached expense list **after cancellation**;
otherwise restoring a canceled read's snapshot could bring back a deleted card.
Occasion creation only refreshes occasion options; it does not change expenses
or balances.

Refreshes run independently of completed mutations: slow or offline-paused reads
cannot keep successful writes pending. Occasion/expense creation and deletion use
`networkMode: 'always'` and `retry: false`. An offline write fails and releases its
controls; it is never queued for reconnection. Read queries retain online-only
behavior. Refresh failure uses the corresponding query's retry state. There is
no optimistic balance arithmetic.

## Data and financial semantics

`Participant` has a unique, nonblank name of at most 100 characters. `Occasion`
has a unique, nonblank name of at most 100 characters and ordering by name then ID.
The occasion API keeps trimmed spelling for display and reports equivalent names
as HTTP 400 `name` errors, including insertion races. `expenses/names.py` defines
one stable canonicalization function: trim, NFC, casefold, NFC. It is shared by
API validation, model writes, and migration backfill/collision detection. For
example, Été, été, and decomposed Été share a key; Straße and STRASSE share another.
Accents remain significant. A stored, internal `canonical_name` text column has
non-null, nonblank and unique database constraints on both SQLite and PostgreSQL.
It does not depend on database lowercase/collation rules or change API types.

Model saves (including `update_fields`) and bulk inserts derive keys, and literal
queryset name updates update both columns. Direct key updates and expression/bulk
name updates are rejected to prevent stale keys; use model saves or literal
updates. Raw SQL writes must explicitly preserve the shared canonicalization
invariant. The algorithm is versioned: changing it or its Unicode rules requires
a new backfill/collision migration rather than rewriting stored keys implicitly.

`Expense` records a distinct payer (`paid_by`) and beneficiary (`expense_for`),
a positive integer `amount_cents`, a description bounded to 500 characters, a
server-generated UTC timestamp, and a nullable `occasion` foreign key.
Participant and occasion references use `PROTECT`. Migration `0002_occasions`
creates the occasion table and adds that nullable foreign key without a default,
backfill, or data deletion. Old expenses retain their fields and IDs and have
`occasion_id = NULL`; old backend code can continue inserting ungrouped expenses
against the expanded schema. Applied migration `0003_occasion_case_insensitive_names`
is unchanged. New `0004_occasion_canonical_names` replaces its inadequate SQL
lowercase index with the unique canonical key. A read-only preflight reports
conflicting IDs and spellings before adding the column; a second check precedes
backfill. It stages a nullable column, backfills only keys, then makes them
non-null/nonblank/unique. Existing names, IDs, participants, and expense references
are preserved. Explicitly rename distinct conflicting occasions after owner
review; there is no automatic merge/delete. Migration 0001 and seeding are unchanged.

The beneficiary owes the payer: Alice paying 5,000 cents for Bob means Bob owes
Alice 5,000 cents. `calculate_balances` reads all persisted expenses by default,
or filters expenses by the supplied occasion ID before accumulating signed
integer cents keyed by the lower/higher participant IDs. The sign chooses debtor/creditor and the absolute value gives the debt.
Repeated/reverse expenses net within each unordered pair in the selected scope.
The global default includes every occasion and ungrouped history. Exact-zero pairs
disappear. No balance records are stored.

Alice paying 50.00 for Bob and Bob paying 20.00 for Alice, even in different
occasions, yields Bob owing Alice 30.00. Bob paying 25.00 for Charlie adds a separate
Charlie-to-Bob debt. Chains and cycles stay pairwise; no transitive simplification
or global debt optimization occurs. For the 50.00 Birthday payment and reverse
20.00 Trip payment, Birthday yields Bob owing Alice 50.00, Trip yields Alice owing
Bob 20.00, and the default global result is Bob owing Alice 30.00. Filtering
already-netted global rows would give the wrong result and is never used.

## Application API

| Endpoint | Contract |
| --- | --- |
| `GET /api/participants/` | Array of `{id, name}`, ordered by name then ID. POST, PUT, PATCH, DELETE return 405. Existing extra participants are retained. |
| `GET /api/occasions/` | Array of `{id, name}`, ordered by name then ID. |
| `POST /api/occasions/` | Required trimmed name, case-insensitively unique and at most 100 characters; 201 `{id, name}` or field-level 400 `name` errors. Other writes return 405. |
| `GET /api/expenses/` | Array ordered by `-created_at`, then `-id`; nested payer/beneficiary, nested occasion or null, two-decimal amount string, description, UTC ISO 8601 timestamp. |
| `GET /api/expenses/?occasion=<id>` | Positive integer occasion ID filters with the same ordering; nonexistent IDs return `[]`, invalid filters return field-level 400 errors. |
| `POST /api/expenses/` | Existing distinct participant IDs, decimal string amount, description, optional existing occasion ID or null; 201 expense or field-level 400 errors. Other collection writes return 405. |
| `DELETE /api/expenses/{id}/` | Exactly one deletion; 204 empty body or 404 if missing. Other operation methods return 405. |
| `GET /api/balances/?occasion=<id>` | Pairwise debts recomputed from only that occasion’s expenses, with the same ID validation as Expenses; unknown IDs/empty occasions return `[]`. |
| `GET /api/balances/` | Global pairwise `{debtor, creditor, amount}` array, nested participants, positive decimal string, ordered by debtor ID then creditor ID. Writes return 405. |

All GET arrays return `[]` when empty. Backend occasion omission/null remains
compatible with older expense clients during rollout; the frontend also permits
No occasion and omits the request field. Response `Expense.occasion` is always nested `{id, name}` or
null, while request `NewExpense.occasion` is optional `number | null`.
Both expenses and balances accept an occasion filter. There is no editing, bulk
deletion, participant/occasion deletion, settlement, or authentication API.

Amounts are ASCII decimal strings from `0.01` to `999999.99`, with at most two
fractional digits. `"1"`/`"1.2"` become `"1.00"`/`"1.20"`. Numeric JSON amounts,
exponents, signs, whitespace, zero, negatives, and excess precision are rejected.
Conversion uses `Decimal`, storage/calculation integer cents. Balance totals may
exceed the per-expense cap. API descriptions are required, trimmed, nonempty, and
bounded to 500 characters; model descriptions may be empty. IDs/timestamps are
server-owned. Supplied occasion IDs must be positive JSON integers referring to
existing rows, not strings or booleans.

Example request after fetching participant IDs and creating/fetching occasion 9:

```json
{
  "paid_by": 1,
  "expense_for": 2,
  "occasion": 9,
  "amount": "50.00",
  "description": "Dinner"
}
```

Example response (list GET wraps these objects in an array):

```json
{
  "id": 1,
  "paid_by": {"id": 1, "name": "Alice"},
  "expense_for": {"id": 2, "name": "Bob"},
  "occasion": {"id": 9, "name": "Dinner"},
  "amount": "50.00",
  "description": "Dinner",
  "created_at": "2026-10-04T10:00:00Z"
}
```

An omitted/null occasion creates the same response shape with `"occasion": null`.

## Storage and Hamravesh decision

SQLite is the preferred local development database. Its default file is ignored
at `backend/.local/expenses.sqlite3`; `SQLITE_PATH` selects another absolute path.
Tests use an isolated in-memory SQLite database. A configured `DATABASE_URL`
takes precedence and selects PostgreSQL via `dj-database-url` and Psycopg 3.
Empty, malformed, non-PostgreSQL, or host/database-less URLs fail startup with a
sanitized error; absent URLs retain SQLite. Environment/database files stay out
of version control and Docker contexts.

Production uses existing separate Hamravesh backend/frontend apps and managed
PostgreSQL 17. The recorded resource is `expense-db`, cluster `hamravesh-c11`,
namespace `saeidirasoul-expense-sharing`, with database name `postgres`. Verify
these values, current health, actual app identities, private connectivity, and TLS
requirements before an authorized release. Credentials remain private runtime
settings, never build arguments or CI inputs. No public database exposure or
Mac-to-production connection is required.

The new backend readiness check queries participants, the occasion canonical-name
column, and the expense occasion column. Missing 0002 or 0004 schema returns 503;
liveness remains independent of database access. Therefore run the additive
pending migrations through 0004 from the new code/image through a **verified
provider command mechanism**, while the previous app remains available, before promoting the new
backend. After backend health/API acceptance, promote the frontend. Old clients
can still submit expenses without an occasion; a stale old frontend's participant
creation attempt will receive 405 and requires reload. The exact provider
mechanism and release acceptance remain pending; no one-off job facility is
assumed. [Operations](operations.md) describes backup/rehearsal, bounded migration
locks, release-branch deployment, checks, and rollback leaving schema 0002–0004 intact.
No production operation has been executed for this change.

## Production packaging

Both Dockerfiles build from repository-root context with `.dockerignore`. The
backend installs locked production dependencies, selects `config.production`,
and runs Gunicorn on port 8000 as UID/GID 10001. Production requires PostgreSQL,
a private key, exact allowed hosts, and an exact frontend CORS origin. The
JSON-only API needs no static server. Migrations/seeds never run during build or
web startup; the runtime has Python but no uv, pytest, or Ruff.

The frontend uses npm ci/Vite, a required public `VITE_API_BASE_URL` build argument,
and Nginx on port 80 with `/health/` and SPA fallback. The URL is compiled into
JavaScript, so changing it requires rebuilding. Production defaults leave Django
HTTPS redirection false and trust no forwarded scheme header: the verified
Hamravesh ingress must own public HTTP-to-HTTPS redirects. Proxy trust and HSTS
require actual ingress/HTTPS verification. Health paths support internal HTTP
with allowed Host checks. See [production packaging](production-packaging.md).

## Checks and CI

Backend checks cover models, serializers, anonymous/read-only contracts,
filtering, global/scoped finances, duplicate insertion races, health behavior,
seed preservation, actual 0001-to-current migration preservation, 0002-to-0003
and 0003-to-0004 collision handling, Unicode canonical equivalence, and old-code
writes after upgrade.
Frontend Vitest/React Testing Library tests mock HTTP at fetch, exercise the real
typed client, and cover forms, caches, filters, errors, cancellation, and offline
writes. Playwright uses real Django/Vite with a fresh temporary SQLite database,
disables dotenv/inherited PostgreSQL settings, migrates/seeds, then cleans up.
Its journey covers optional occasions, required fields, historical ungrouped expenses,
global/filtered balances, independent tab selections/clearing, deletion/stale 404, keyboard focus, offline
failure dismissal, and desktop/320px screenshots. Reports/traces are ignored.

`.github/workflows/ci.yml` runs five jobs on PRs and pushes to `main`:
**Backend checks**, **Frontend checks**, **PostgreSQL 17 checks**, **Browser tests**,
and **Production images**. Python 3.13/Node 24 come from project version files;
uv/npm install lockfiles. PostgreSQL CI uses disposable public credentials and
an isolated `test_<database-name>` database; SQLite uses disposable/in-memory
storage. Images CI builds and runs the disposable tmpfs PostgreSQL Compose smoke,
then removes it. It publishes no images and deploys nothing. PRs targeting
`release` run CI; pushes to `release` do not trigger this workflow or deploy.
The runbook requires reviewed green promotion and deployment of recorded release
artifacts. No CI job uses Hamravesh credentials or production data.
