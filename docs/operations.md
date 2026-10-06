# Release and operations runbook

This is the proposed procedure for an **authorized update of the existing
Hamravesh backend and frontend apps**, using the existing PostgreSQL database
and reviewed `release` branch. No production command, backup, migration, branch
promotion, image publication, or deployment has been executed for this change.
Local checks use disposable databases only. Actual provider controls, current
app identities, ingress, connectivity from Iran, and backup restoration require
verification before a release.

[Production packaging](production-packaging.md) defines images/settings;
[architecture](architecture.md) defines contracts. The new application has seeded,
read-only participants, Add Occasion, optional occasion selection in the UI,
ungrouped historical and new expenses, independent occasion filtering in each tab, individual
confirmed deletion, and global-by-default or occasion-scoped pairwise balances.
Preserve **all existing participants and expenses**.

## Release order and provider verification gate

The safe order is **reviewed release artifact → verified backup and restore
rehearsal → pending migrations through 0004 from new backend code/image
while the current app remains available → new backend promotion and API checks → new frontend promotion
and browser checks**. Do not promote the new backend first and hope a readiness
503 resolves: readiness queries the 0004 occasion key and the expense occasion
column. Use the candidate containing migrations 0002–0004 and `expenses/names.py`;
older images cannot apply missing migration code. Separately verify migration
history and the canonical-key constraint; readiness alone does not prove its
uniqueness or canonical data is correct.

| Item | Recorded value | Verify before release |
| --- | --- | --- |
| Branches | `main` integration, existing local `release` branch for production | Remote branch heads, protections, five required checks, and how each existing app builds/deploys that branch. |
| Database | Recorded `expense-db`, PostgreSQL 17, cluster `hamravesh-c11`, namespace `saeidirasoul-expense-sharing`, database name `postgres` | Actual identity/health/version, private connectivity, schema privileges, TLS, backup controls, restore privileges. Resource name differs from database name. |
| Backend app | Existing separate app, port 8000 | Actual app identifier, current digest/commit/settings, registry or Git build mechanism, rollout/probes/logs, candidate execution without changing public traffic. Do not assume its name is `expense-api`. |
| Frontend app | Existing separate app, port 80 | Actual app identifier, current digest/commit, compiled API origin, build/release mechanism and rollback controls. Do not assume its name is `expense-web`. |
| Public origins | Existing backend and frontend HTTPS origins | DNS/certificates, exact allowed hosts/CORS, access from Iran. `api.example.com`/`app.example.com` are placeholders. |
| Candidate migration command | **Unverified: exact Hamravesh panel action/API/CLI syntax** | Record the real mechanism, parameters, candidate image digest/source SHA, private environment/network injection, command override, exit status/log access, and absence of public routing. |
| Backups | Private encrypted durable storage | Retention, operator, recovery objectives, verified restore drill and any PITR capability. Do not assume these are enabled. |

**The exact provider command mechanism is a release gate, not an assumed one-off
job feature.** Verify it in the panel/provider documentation or with provider
support and rehearse it on an isolated database. It must execute Python from the
**new** backend artifact on the database's private network, with production
settings injected privately, while the existing live app keeps its image and
routing. If available, an isolated candidate execution environment or temporary
private app with a command override may satisfy this; neither capability is
asserted here. Record the exact verified action/command in the private release
record before proceeding. A shell in the old running image is insufficient.
Do not copy new source into live containers or make database access public.
If no suitable mechanism exists, postpone promotion until an equivalent safe
provider-supported mechanism is verified. Do not stop or replace the healthy
app merely to obtain migration code.

Keep ordinary-push automatic deployment disabled or gated by the reviewed release
approval. Confirm the actual app integration before changing settings. No new
cloud app/database provisioning is needed for this update.

## 1. Review and promote the release artifact

1. When separately authorized, review the feature PR into `main`, including all
   new source/migration files, API compatibility, Docker exclusions, and this
   runbook. Require **Backend checks**, **Frontend checks**, **PostgreSQL 17 checks**,
   **Browser tests**, and **Production images** green on the current revision.
2. After the approved merge, require the five checks on that exact `main` commit
   and record `approved_main_sha`. Later commits are not automatically approved.
3. Promote the approved revision into `release` through a reviewed, authorized
   PR. Freeze the source revision; require the same checks. CI runs for PRs to
   any target and pushes to `main`; a push to `release` alone runs no workflow
   and deploys nothing in repository CI. Verify provider triggers separately.
4. Record the final `release_sha` and compare its tree with approved main:

   ```sh
   git diff --exit-code "$approved_main_sha" "$release_sha" --
   ```

   Any content difference stops release for review/checks. Build/deploy from the
   recorded revision, not an unfrozen moving branch tip.
5. Privately record release/main SHAs, candidate and previous image digests,
   current settings, verified app identifiers/origins, command mechanism,
   migration plan, backup reference, operator/time, and acceptance results.
   Keep credentials and database snapshots out of Git and public logs.

The Production images CI job builds and checks a disposable PostgreSQL 17 stack;
it publishes no image and has no Hamravesh access. Its localhost frontend URL is
not a production artifact.

## 2. Prepare new artifacts without promoting the apps

Build from a clean checkout of `release_sha`. For the verified image workflow,
set authorized tags and the actual public backend origin:

```sh
docker build -f backend/Dockerfile -t "$backend_image_tag" .
docker build -f frontend/Dockerfile \
  --build-arg VITE_API_BASE_URL="$public_api_origin" \
  -t "$frontend_image_tag" .
```

Publish only through the separately authorized registry workflow and record
immutable digests. If the existing apps use Git builds, verify that the provider
builds the same root-context Dockerfiles from the recorded release SHA and records
identifiable artifacts **without immediately promoting the backend**. A build
from a moving branch or an old image is not the migration candidate. Revalidate
rebuilt images because base tags are mutable.

Retain the current apps and previous artifacts. Verify candidate settings against
existing settings; this release does not require credential rotation or URL changes:

- Backend: port 8000, image Gunicorn command, UID/GID 10001,
  `DJANGO_SETTINGS_MODULE=config.production`, `DEBUG=false`,
  `PYTHON_DOTENV_DISABLED=1`, private PostgreSQL `DATABASE_URL` with verified TLS,
  and the stable private `SECRET_KEY`. Never print or supply secrets as build args.
- Exact `ALLOWED_HOSTS`, including the internal probe Host, and exact
  `CORS_ALLOWED_ORIGIN` for the public frontend. No wildcard/credentialed CORS.
- Frontend: port 80, Nginx command, `/health/`, SPA fallback, and the public API
  origin compiled into the image. Runtime environment cannot replace that URL.
- Public HTTP-to-HTTPS redirects belong to the verified Hamravesh domain ingress.
  Leave `SECURE_SSL_REDIRECT` unset/false; stale true settings can cause HTTPS
  self-redirects behind TLS termination. Trust no forwarded scheme header until
  its exact value/sanitization and ingress bypass prevention are verified.
  Keep HSTS at 0 until HTTPS checks pass; preserve reviewed settings on rollback.

No migration/seed runs in image builds or Gunicorn startup. The runtime has
Python on PATH, not uv, pytest, pg_dump, or pg_restore.

## 3. Back up and rehearse against a restored database

Before touching live schema, verify managed backups, off-instance destination,
retention, restore permissions, and recovery objectives. Take a retained,
consistent pre-release backup; verify it by restoring to a **new isolated target**.
Provider scheduling/storage and PITR remain pending verification.

For a portable logical backup, use a trusted PostgreSQL **17** client environment
inside the private network through a verified operator mechanism. Privately
inject `PGHOST`, `PGPORT`, `PGDATABASE=postgres`, `PGUSER`, TLS settings/certificates,
and a mode-0600 `PGPASSFILE` outside the repository. Confirm the source identity;
never put a literal credential URL in commands or enable shell tracing:

```sh
set -eu
set +x
umask 077
psql --set=ON_ERROR_STOP=1 --command='SELECT current_database(), current_user, version();'
backup_dir=$(mktemp -d /tmp/expense-backup.XXXXXX)
pg_dump --format=custom --no-owner --no-acl --file="$backup_dir/expenses.dump"
pg_restore --list "$backup_dir/expenses.dump" > "$backup_dir/manifest.txt"
(cd "$backup_dir" && sha256sum expenses.dump > expenses.dump.sha256)
```

The archive contains schema, data, sequences, and Django migration history in a
consistent snapshot, but not server-wide roles. The dump role needs all relevant
table read privileges. Upload archive/checksum and source/time/image references
to approved encrypted durable storage; confirm upload. An ephemeral file or
archive listing alone is not recovery proof. See the
[PostgreSQL backup reference](https://www.postgresql.org/docs/17/backup-dump.html).

Restore the retrieved archive into a unique empty database through verified
private controls, never over the live `postgres` database:

```sh
set -eu
(cd "$restore_archive_dir" && sha256sum --check expenses.dump.sha256)
backup_archive="$restore_archive_dir/expenses.dump"
restore_db=expense_restore_YYYYMMDD_UNIQUE
test "$restore_db" != postgres
createdb --maintenance-db=postgres "$restore_db"
pg_restore --exit-on-error --single-transaction --no-owner --no-acl \
  --dbname="$restore_db" "$backup_archive"
```

Use a unique actual name, verified database-creation privileges, TLS, and an
application-compatible restore role. Explicit `--dbname` overrides `PGDATABASE`.
See the [restore reference](https://www.postgresql.org/docs/17/app-pgrestore.html).
If the role cannot create a target, arrange an empty one via verified provider
controls first.

Point isolated previous and candidate backend artifacts at the restored target
using private replacement connection settings; leave public routing closed.
Record all participant/occasion/expense IDs and fields, counts, and global pairwise balances
in private storage. Review candidate migration SQL/plan and run section 4 here
first. Compare every old row, not just counts: original payer/beneficiary, amount,
description, date, and IDs must match. Pre-0002 expenses acquire a null occasion;
existing occasion IDs, spellings, and assignments must remain unchanged through
0004, with canonical keys added correctly. Test old
code inserting an ungrouped expense after migration, new occasion/expense
creation with and without an occasion, case-variant duplicate errors, shared
filtering/clearing, global versus filtered balances, and individual deletion only on
this restored copy. Check sequences and record timing/lock behavior. Existing
extra participants must remain selectable. Do not run the fresh-stack smoke
script or automatic seed/reset against a restored target.

The backup is a snapshot. Writes occurring afterward are not in it; retain the
live database and account for newer writes in any recovery. A rehearsal does not
repoint the live app. Capture/verify a current pre-migration backup after rehearsal
if the rehearsal's backup is no longer the approved release recovery point.

## 4. Apply pending migrations through 0004 before backend promotion

Use the verified candidate command mechanism from the gate above. Confirm its
artifact is the recorded **new backend digest/release SHA**, contains
`expenses/migrations/0002_occasions.py` and
`0003_occasion_case_insensitive_names.py`, `0004_occasion_canonical_names.py`, and
`expenses/names.py`, selects the intended database privately,
and has no public traffic. Keep the current backend/frontend serving normally.
Only one operator/executor runs migrations; do not start competing migrations.

From the new image's `/app` working directory, with private settings injected:

```sh
set -eu
set +x
python manage.py check --deploy
python manage.py showmigrations expenses
python manage.py migrate --plan
python manage.py sqlmigrate expenses 0002
python manage.py sqlmigrate expenses 0003
python manage.py sqlmigrate expenses 0004
```

Expect `[X] 0001_initial`; 0002/0003 have not yet been released in production,
while local databases may already have them. 0004 is new. Verify actual migration
history and the exact pending plan; unexpected migrations stop the release.
Do not rewrite applied migrations. 0002 creates occasions and a nullable protected
expense reference, without changing old rows. 0003 is unchanged. 0004 checks for
Unicode-equivalent collisions, stages/backfills a canonical-key column, adds
non-null/nonblank/unique constraints, and removes 0003's inadequate SQL-lowercase
index. Review its shared Python canonicalization and both collision checks as well
as `sqlmigrate`, which cannot show the runtime data checks. Do not use `--fake`,
reverse migrations, or recreate the database.

If the occasion table already exists, perform a read-only preflight from the new
candidate code. Record diagnostics privately; names may be private business data:

```sh
python manage.py shell -c '
from collections import defaultdict
from expenses.models import Occasion
from expenses.names import canonical_occasion_name
by_key = defaultdict(list)
for row_id, name in Occasion.objects.order_by("id").values_list("id", "name"):
    by_key[canonical_occasion_name(name)].append((row_id, name))
conflicts = [rows for key, rows in by_key.items() if not key or len(rows) > 1]
for rows in conflicts:
    print("Conflicting occasion rows:", repr(rows))
raise SystemExit(1 if conflicts else 0)
'
```

SQL `LOWER()` is not a Unicode-aware substitute for this check. Migration 0004
also **stops with conflicting IDs and spellings before adding/backfilling**, and
rechecks immediately before writing keys. Neither names nor expense assignments
are changed. If there are conflicts, halt promotion and obtain an explicit owner
decision for each distinct occasion's new name. Apply only reviewed name renames
by ID through the verified private command mechanism, preserving all IDs and
`Expense.occasion_id` values. Before 0004, the new model's save/update hooks require
a column that is still absent: use reviewed private SQL or the historical migration
model for these renames, then retry the migration. After 0004, use model saves or
literal name updates so keys stay synchronized. There is no editing API.
Never delete, merge, reassign, or blanket-null records. Back up and rehearse any
rename separately, recheck for collisions, and retry. 0003 may stop earlier on
its existing narrower check. Any concurrent old-code occasion write can invalidate
preflight or fail after the new non-null key exists; stop occasion writes from an
already-running 0002/0003 app through verified controls until candidate promotion.
The current production 0001 app has no occasion writes and continues serving
participants and expenses during the migration. Do not publish the new frontend
or route the candidate before completing the entire chain.

PostgreSQL DDL still acquires locks; additive does not guarantee zero blocking.
Rehearse against realistic data/load, choose a low-traffic window, and set reviewed
lock/statement limits on the migration connection. Example initial limits below
are **subject to rehearsal**, not guaranteed sufficient for production volume:

```sh
set -eu
set +x
export PGOPTIONS="${PGOPTIONS:+$PGOPTIONS }-c lock_timeout=5s -c statement_timeout=60s"
python manage.py shell -c "from django.db import connection; cursor = connection.cursor(); cursor.execute('SHOW lock_timeout'); print('lock_timeout:', cursor.fetchone()[0]); cursor.execute('SHOW statement_timeout'); print('statement_timeout:', cursor.fetchone()[0])"
```

Confirm the connection reports the reviewed limits (here `5s` and `1min`), not
values overriding them through connection URL options. Stop if it does not. Then,
in that same candidate execution environment:

```sh
set -eu
python manage.py migrate expenses 0004 --noinput
python manage.py showmigrations expenses
python manage.py migrate --check
```

Stop on timeout/failure, inspect transaction/migration state through the candidate,
and retry only after resolving the cause. Migrations 0002–0004 use Django's default
transactional migration on PostgreSQL. Keep the old app routed; do not let a
waiting migration block requests indefinitely or promote an unready candidate.
If rehearsal cannot meet acceptable availability, stop release planning and
agree a separate maintenance procedure before executing live changes.

Verify 0002, 0003, and `0004_occasion_canonical_names` are all `[X]`, no pending
migrations remain, and inspect schema through private SQL:

```sql
SELECT name FROM django_migrations
WHERE app = 'expenses' ORDER BY name;
SELECT table_name, column_name, is_nullable
FROM information_schema.columns
WHERE table_schema = current_schema()
  AND ((table_name = 'expenses_expense' AND column_name = 'occasion_id')
    OR table_name = 'expenses_occasion')
ORDER BY table_name, ordinal_position;
SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname = current_schema() AND tablename = 'expenses_occasion'
  AND indexname IN ('occasion_canonical_name_unique', 'occasion_name_ci_unique');
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid = 'expenses_occasion'::regclass
  AND conname IN ('occasion_canonical_name_unique', 'occasion_canonical_name_not_empty');
SELECT count(*) AS occasions FROM expenses_occasion;
SELECT count(*) AS participants FROM expenses_participant;
SELECT count(*) AS expenses FROM expenses_expense;
SELECT count(*) AS assigned_expenses FROM expenses_expense WHERE occasion_id IS NOT NULL;
```

Verify the FK/index/constraints against the reviewed SQL: `occasion_id` nullable,
`canonical_name` NOT NULL and nonblank, `occasion_canonical_name_unique` present,
and `occasion_name_ci_unique` absent. Verify stored keys read-only from the same
candidate code:

```sh
python manage.py shell -c '
from expenses.models import Occasion
from expenses.names import canonical_occasion_name
mismatches = [row_id for row_id, name, key in
    Occasion.objects.values_list("id", "name", "canonical_name")
    if key != canonical_occasion_name(name)]
print("Canonical key mismatch IDs:", mismatches)
raise SystemExit(1 if mismatches else 0)
'
```

Preserve all prior display names, IDs, fields, and expense associations; only
the new key is backfilled. Before new-code writes, occasions and
assigned-expense counts should be zero for an initial 0002 rollout. With current
traffic still writing, compare a private pre-migration baseline while accounting
for legitimate concurrent creations/deletions; do not mistake a snapshot count
for an exact live invariant. The restore rehearsal proves exact preservation
without concurrent writes. Do not blanket-null existing assignments if this is
a rerun after a partial release.

Do **not** run seeding as routine cleanup on this existing database. Confirm the
four seeds and all extra participants remain; if a seed is unexpectedly missing,
investigate and separately review an idempotent `seed_participants` run. Never
remove extra people or expenses to force a four-person count.

Start the new backend candidate privately against the expanded schema. Require
liveness/readiness 200 and read-only API checks before promotion. The candidate's
readiness is expected to be 503 before the required 0002/0004 columns exist and
must be 200 after all migrations complete; liveness
requires no database even before migration. Failure leaves the current app serving
and the additive schema intact for investigation.

## 5. Promote backend, then frontend, and accept the release

Configure verified provider probes/routing gates with an allowed backend Host:

| Probe | Port/path | Expected |
| --- | --- | --- |
| Backend liveness | 8000 `/health/live/` | 200 `{"status":"alive"}`, no database access. |
| Backend readiness | 8000 `/health/ready/` | 200 `{"status":"ready"}` only when participant/occasion tables, occasion canonical key, and expense occasion column are usable; 503 otherwise. Empty usable tables are ready. |
| Frontend health | 80 `/health/` | 200 text `ok`. |

Docker checks backend liveness; configure provider **readiness** separately.
Verify actual probe intervals/timeouts/startup allowance and traffic gating.
Promote the recorded backend artifact only after section 4 succeeds, and confirm
health and the following API behavior on the new candidate/public backend:

- Participants GET includes all prior IDs/names and seeds; POST/PUT/PATCH/DELETE
  return 405. Do not send a participant-creation smoke to the old live backend.
- Occasions GET 200 with stable name/ID ordering; expense responses include nested
  occasion or null. All historical expenses remain visible unfiltered.
- `?occasion=<existing-positive-id>` returns only that occasion in the unchanged
  descending date/ID order; invalid IDs return field errors, unknown IDs `[]`.
- Default global balances match the pre-release pairwise baseline, accounting for
  real concurrent writes and including ungrouped expenses. Filtered balances use
  only that occasion’s expenses before netting by pair; an empty occasion returns
  `[]` and malformed IDs have the same field errors as the Expenses filter.
- Trimmed, Unicode-normalized/casefolded equivalent names (including Été/été and
  composed/decomposed accents) return HTTP 400 `name` errors, including insertion
  races; the stored-key constraint is present and key values match the shared function. Rehearse writes on the restored copy.

Exercise write/validation/duplicate-name/old-client omission cases on the restored
copy before live promotion. Production occasion creation is permanent through
this API: create only an intended real occasion with approval, not a disposable
smoke name. Existing recorded expenses are never deleted as test cleanup.

Then promote the frontend artifact built with the actual API origin. **New
frontend on old backend does not provide the complete feature** if occasion
endpoints or scoped balances are absent. Its No occasion save can tolerate a
failed occasion lookup, but that is not full release acceptance.
Old expense clients on new backend remain compatible through omitted/null occasion.
A cached old UI may still offer Add Person and get 405; keep the backend/frontend
gap short, verify HTML revalidation/hashed assets, and direct such clients to reload.
Do not restore participant POST just to support stale UI.

From a client in Iran, with verified public origins, check:

```sh
curl --fail --silent --show-error "$public_api_origin/health/live/"
curl --fail --silent --show-error "$public_api_origin/health/ready/"
curl --fail --silent --show-error "$public_frontend_origin/health/"
curl --fail --silent --show-error -D - \
  -H "Origin: $public_frontend_origin" "$public_api_origin/api/participants/"
curl --fail --silent --show-error "$public_api_origin/api/occasions/"
curl --fail --silent --show-error "$public_api_origin/api/expenses/"
curl --fail --silent --show-error "$public_api_origin/api/balances/"
curl --fail --silent --show-error -D - \
  -H 'Origin: https://untrusted.example.test' "$public_api_origin/api/participants/"
```

Allowed origin receives the exact CORS permission; untrusted origin receives
none, though curl can still read an anonymous API. Verify actual-browser JSON
POST/DELETE preflight, HTTP redirect to HTTPS, non-looping HTTPS, spoofed proxy
header behavior, and no CORS/mixed-content/console errors. Health does not prove
HTTPS/ingress behavior.

Desktop and **320px** browser acceptance: no Add Person; all seeded/extra
participants available; Add Occasion trimmed required name, field-level duplicate
errors, single save, and usable Cancel/Escape after network failure; new occasion
selectable; four required Add Expense labels (Paid by, Expense for, Amount,
Description) have red asterisks/accessible required state; Occasion is optional
with No occasion omitting the POST field and saving despite empty/failed lookups;
assigned names filter only Expenses; Balances offers All occasions/occasion
choices and Clear filter, with its own independent selection. Switching tabs must
retain each tab’s selection without copying it. Balances shows exactly one list:
All occasions is the global pairwise net (possibly empty when opposite expenses
cancel); a named occasion is that occasion’s net. Clearing only Expenses restores
historical null-occasion rows; clearing only Balances restores the global net. Verify scoped totals are recomputed
before pairwise netting, and deletion while filtered refreshes both scopes. Check keyboard
focus/trapping/restoration, modal scrolling/Save visibility, reload persistence,
and cancellation/confirmation of individual deletion.

Perform the full write journey on the restored copy. If a separately approved
live expense smoke is needed, use an intended existing occasion, record the
pair's baseline and **only the newly created smoke IDs**, then verify 50.00/20.00
opposite expenses shift that pair by 30.00 across occasions. Verify deletion
cancellation, remove the reverse smoke ID and see a 50.00 shift, then delete only
the remaining smoke ID through confirmation and restore the baseline. Never
assume an empty production pair, delete a historical record, or bulk-delete.
`backend/scripts/smoke_containers.py` is only for the fresh local Compose stack.

### Deployment-check warnings

`check --deploy` defaults report unsilenced W003 (anonymous JSON API without
session/cookie authority or CSRF middleware), W004 (HSTS 0 awaiting verified
HTTPS), and W008 (Django redirect false; ingress must redirect). With positive
HSTS and false subdomain/preload flags, W005/W021 replace W004. Existing image CI
sets redirect true only for its deploy-check command, showing W003/W004; that
command does not validate production ingress. Investigate other errors/warnings
and review [Django's proxy requirements](https://docs.djangoproject.com/en/5.2/ref/settings/#secure-proxy-ssl-header).

## 6. Rollback and recovery

Retain previous artifacts/settings, backup, and migration record before promotion.
On failed readiness/API/browser acceptance or increased errors, halt rollout and
inspect logs without dumping environments. Use verified provider traffic/rollback
controls; do not guess their UI/CLI syntax.

1. **Before promotion:** a failed candidate/migration leaves the current apps
   routed. Investigate migration status/collisions; preserve all data. If pending 0002–0004 applied
   successfully but candidate acceptance fails, leave the additive schema in
   place and keep the old apps. Do not reverse it.
2. **Frontend-only failure:** restore the previous frontend digest while retaining
   the healthy new backend/schema. Expense creation without occasion still works;
   the legacy participant button will receive 405 until a corrected frontend is
   deployed. A reviewed compatible frontend fix is preferable.
3. **Backend rollback required:** new frontend cannot remain on a backend lacking
   occasions. Restore the previous frontend before restoring the previous backend
   digest/settings, or use a prevalidated rollback artifact retaining the new API.
   Wait for health/readiness and repeat acceptance. A full legacy-pair rollback
   reintroduces its old participant-creation behavior and fails the new read-only
   spec; record that tradeoff in the authorized release decision and prioritize
   a reviewed fix. No claimed compatible rollback image exists without validation.
4. **Leave migrations 0002–0004 applied on code rollback.** Old code ignores
   the table/nullable column and continues writing ungrouped expenses. Occasion records and
   assignments remain stored for recovery/fix-forward. `migrate expenses 0001`
   would drop occasion data/associations: it is not a safe rollback step. Never
   fake migrations, delete participants/expenses, or restore over the live database.
   Code from 0002/0003 cannot create occasions without populating the retained
   non-null canonical key and may return 500. Use a prevalidated rollback artifact
   retaining the 0004 key-write/error handling, or fix forward. The original 0001
   app can still write ungrouped expenses because it does not create occasions.
   Do not drop the key constraint or add a blank default as a rollback workaround.
5. **Database recovery only if needed:** stop public writes through verified
   controls, take a private forensic backup if possible, agree recovery timestamp
   and reconciliation of all newer writes, restore into a new empty database,
   validate with the matching backend then the approved migration plan, and obtain
   separate authorization for data cutover. Change only the private backend
   connection to the validated target and repeat acceptance. Preserve the original
   database until separate retention approval. A pre-release backup alone omits
   newer writes and is not an automatic no-loss rollback.
6. Record artifacts, schema state, incident/outcome, and acceptance. Reconcile
   `release` through a reviewed fix/revert PR and green checks; do not rewrite
   shared history or deploy an unreviewed moving branch.

This runbook is proposed and unexecuted for this change. Exact candidate command,
provider build/promotion/rollback controls, app identities/origins, backup restore,
and public ingress acceptance remain verification items before production release.
