# Release and operations runbook

This describes a future authorized release. No commit, push, PR, branch
promotion, image publication, cloud provisioning, production migration, backup,
or deployment has been performed. Local container smoke checks use disposable
PostgreSQL 17 only. Public HTTPS ingress, public URLs, connectivity from Iran,
and managed-database backup/restore have **not** been tested.

[Production packaging](production-packaging.md) defines the images and runtime
environment; [architecture](architecture.md) records the API/storage decisions.
Preserve Add Person, individual expense deletion with confirmation, and pairwise
balances during release and rollback. The API remains anonymous.

## Values requiring verification

| Item | Recorded choice or proposed value | Pending verification |
| --- | --- | --- |
| Branches | `main` for integration; `release` for production promotion | `release` does not exist locally yet. Its authorized creation, branch protection, and required checks must be established. |
| Database | Recorded Hamravesh resource `expense-db`, PostgreSQL 17, cluster `hamravesh-c11`, namespace `saeidirasoul-expense-sharing`; database name `postgres` | Current panel identity, health, version, internal connectivity, privileges, and TLS requirements. The resource name is not the database name. |
| Backend app | Separate app, proposed name `expense-api`, container port **8000** | Actual app name, cluster/namespace, registry access, resources, rollout controls, one-off command facility, and probes. |
| Frontend app | Separate app, proposed name `expense-web`, container port **80** | Actual app name, registry access, resources, routing, and rollout controls. |
| Public backend origin | `https://api.example.com` is a placeholder | Actual DNS, certificate, ownership, and access from Iran. |
| Public frontend origin | `https://app.example.com` is a placeholder | Actual DNS, certificate, ownership, and access from Iran. |
| HTTPS proxy | Hamravesh terminates TLS; its domain ingress owns HTTPS Redirect. No forwarded scheme header trusted by default | HTTPS Redirect enabled on every public app domain, non-looping HTTPS, Host preservation, and prevention of ingress bypass. Verify header/value sanitization before enabling any proxy-header trust. |
| Backups | Private encrypted durable storage, recurring and pre-release backups, restore drill | Provider controls, destination, frequency/retention, operator, recovery objectives, restore privileges, and any point-in-time recovery capability. |

Never deploy placeholder domains or disposable CI secrets. Verify the panel's
actual app, probe, rollout, and release-command controls before the steps below;
this document does not invent provider UI fields or CLI commands. Keep automatic
deployment on ordinary pushes disabled; promotion requires a reviewed release.

## 1. Green PR into main, then promote to release

1. When authorized, submit the feature branch as a PR into `main`. Review the
   complete diff, including Docker context exclusions, lockfiles, production
   settings, migration compatibility, and operations instructions. Require five
   green checks: **Backend checks**, **Frontend checks**, **PostgreSQL 17 checks**,
   **Browser tests**, and **Production images**.
2. Merge only after review and green checks on the current PR revision. Wait for
   the push-to-`main` run to pass all five jobs. Record that exact main commit as
   `approved_main_sha`; later commits do not automatically become approved.
3. After the release branch has been established through an authorized action,
   open a promotion PR from the approved `main` revision into `release`. Freeze
   `main` through the promotion if using it as the source branch; a changed head
   needs new review/checks. Require the same five green checks. PRs to any target
   run CI, but pushes only to `main` run CI; pushing `release` neither triggers
   this workflow nor deploys.
4. Merge the approved promotion when authorized. Record the resulting
   `release_sha` and verify its tree equals the approved main tree:

   ```sh
   git diff --exit-code "$approved_main_sha" "$release_sha" --
   ```

   A merge commit can have a different SHA. Any content difference stops this
   release and needs a new review/check run. Build from the recorded release
   commit, not a moving branch tip.
5. Keep a private release record containing both SHAs, final image digests,
   verified public origins, migration plan, pre-release backup reference,
   previous image digests/settings, operator, time, and acceptance results.
   Keep credentials and production data out of Git and CI logs.

The **Production images** job builds both existing Dockerfiles from root context
with locked dependencies, uses public `VITE_API_BASE_URL=http://localhost:8000`,
and runs the existing disposable Compose/HTTP smoke workflow. It publishes no
images, uses no Hamravesh environment, and cleans up even after failure.
GitHub-hosted Linux must provide Docker Engine/Compose; the job checks both and
fails clearly if unavailable. Check the [runner software manifest](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md)
if runner capabilities change.

## 2. Build final images and configure separate apps

From a clean checkout of `release_sha`, set the verified `public_api_origin`
and authorized registry/release tags. These variables hold public identifiers,
not credentials. Build using repository root context:

```sh
docker build -f backend/Dockerfile -t "$backend_image_tag" .
docker build -f frontend/Dockerfile \
  --build-arg VITE_API_BASE_URL="$public_api_origin" \
  -t "$frontend_image_tag" .
```

Publish through the verified registry workflow only when authorized. Record the
registry digests and select those immutable digests in Hamravesh. The CI
frontend's localhost URL cannot be used in production. Changing the public API
URL requires a new frontend build/digest; runtime environment cannot update
its bundle. Never put credentials in `VITE_` values or Docker build arguments.
Base-image tags are mutable, so later rebuilds are new artifacts to revalidate.

Configure two apps in the verified network/namespace:

- Backend: backend digest, port 8000, image's Gunicorn command and non-root
  UID/GID 10001. Keep `DJANGO_SETTINGS_MODULE=config.production`, `DEBUG=false`,
  and `PYTHON_DOTENV_DISABLED=1`. No startup dependency installation is needed.
- Frontend: frontend digest, port 80, image's Nginx command, `/health/`, and SPA
  fallback. No database or secret environment is needed.
- Privately inject backend `DATABASE_URL` using the connection panel's internal
  host/port/user, recorded database name `postgres`, and verified TLS options.
  Percent-encode special characters in URL credentials. SQLite is for local/CI
  use; the production module requires PostgreSQL.
- Privately inject a random backend `SECRET_KEY` of at least 50 characters with
  five distinct characters; development keys are rejected. Keep it stable
  across ordinary releases and rollback.
- Set exact backend hostnames in `ALLOWED_HOSTS`, including the specific internal
  Host needed by probes. No schemes, ports, `*`, or subdomain wildcards. Set
  `CORS_ALLOWED_ORIGIN` to the verified frontend origin without a trailing slash;
  no wildcard origins or credentialed CORS.
- Leave `SECURE_PROXY_SSL_HEADER`/`SECURE_PROXY_SSL_VALUE` unset until ingress
  header/value and sanitization are verified, then set both explicitly.
  Gunicorn's implicit forwarded-scheme trust is disabled; forwarded-host/port
  trust stays disabled. Clients must not bypass the trusted ingress.
- Enable Hamravesh's **HTTPS Redirect** setting at the domain ingress for every
  public backend and frontend domain before serving users. Hamravesh terminates
  TLS and must redirect public HTTP requests to HTTPS.
- Leave `SECURE_SSL_REDIRECT` unset or set it to `false` (the production default).
  Remove any stale `true` override from the backend environment. Django receives
  HTTP behind the TLS ingress; enabling its redirect without a verified scheme
  header makes public HTTPS API requests redirect to the same HTTPS URL.
  Start with `SECURE_HSTS_SECONDS=0`; after HTTPS verification, consider a short
  duration such as 3600. Subdomain inclusion and preload stay false.

Verify that ingress strips spoofed headers, preserves the intended Host,
redirects public HTTP, and serves HTTPS without a redirect loop. None of those
Hamravesh behaviors has been tested yet. Follow
[Django's proxy requirements](https://docs.djangoproject.com/en/5.2/ref/settings/#secure-proxy-ssl-header).

## 3. Back up and run one-off release commands

1. Review `python manage.py migrate --plan` in a one-off candidate backend
   container with its private runtime settings. Record compatibility with the
   previous backend. Packaging adds no database migration; the existing initial
   application migration remains unchanged.
2. Take and verify the pre-release backup below. If migration needs stopped
   writes, use a verified ingress maintenance/routing control or stop public
   backend traffic before backup/migration. Hiding the frontend alone does not
   stop anonymous API writes. Retain private operator access for release commands.
   Provider maintenance controls remain pending verification.
3. Keep candidate traffic closed. Run this sequence once inside the candidate
   backend image, with the private production environment injected:

   ```sh
   set -eu
   python manage.py check --deploy
   python manage.py migrate --noinput
   python manage.py seed_participants
   python manage.py migrate --check
   ```

   Stop on any failure. PATH contains the locked Python environment; uv is not
   in the runtime. Never attach migrations/seeding to image builds or worker
   startup. Rerun only when needed to recover an interrupted/failed release.
   Seeds are idempotent: missing Alice, Bob, Charlie, and David are created;
   existing IDs, added people, and expenses remain unchanged. A fresh database
   creates four people, and a second seed creates zero. No expenses are seeded.
4. Start the backend candidate and gate traffic on readiness. Roll out the
   frontend candidate. Keep the previous image pair available until acceptance
   passes, then record the outcome before ending maintenance.

### Actual check --deploy warnings

Production defaults report **W003**, **W004**, and **W008**, with none silenced:

| Warning | Reason and action |
| --- | --- |
| `security.W003` | No `CsrfViewMiddleware`. DRF is intentionally anonymous, JSON-only, and has no session/cookie authentication. Keep the warning visible; CORS is not authorization. Revisit CSRF if cookie-based authority is introduced in future scope. |
| `security.W004` | HSTS duration is 0 pending real HTTPS verification. Local HTTP smoke does not verify HTTPS or HSTS. |
| `security.W008` | Django's `SECURE_SSL_REDIRECT` is false because Hamravesh's domain ingress handles HTTP-to-HTTPS redirects. This is expected with proxy-managed redirects. Keep the warning visible and require HTTPS Redirect on every public app domain; do not enable Django redirects just to remove it. |

The disposable HTTP environment also sets `SECURE_SSL_REDIRECT=false` and reports
the same warnings. Existing image CI overrides it to true only for the deploy-check
command and reports W003/W004; that override does not represent production defaults
or test a TLS ingress. With positive HSTS duration and the current false subdomain/preload
flags, W004 is replaced by **W005** and **W021**. Investigate any other warning
or error. No production deploy check or HTTPS ingress test has been performed.

## 4. Health and browser/API acceptance

Provider probe UI fields, intervals, timeouts, startup allowance, and routing
gates are pending verification. Configure these exact paths and ports:

| Probe | Port/path | Expected result |
| --- | --- | --- |
| Backend liveness | 8000, `GET /health/live/` | 200 JSON `{"status":"alive"}` without database access. |
| Backend readiness | 8000, `GET /health/ready/` | 200 JSON `{"status":"ready"}` when the database/schema work; 503 otherwise. An empty usable table is ready. |
| Frontend health | 80, `GET /health/` | 200 text `ok`. |

Backend probes must send an allowed Host. Both backend health paths accept
internal HTTP checks without Django redirects and still validate Host. Docker's
probe checks liveness with the first parsed `ALLOWED_HOSTS` entry, after trimming
whitespace and removing empty entries; provider readiness must be configured
separately.

After authorized rollout, set verified `public_api_origin` and
`public_frontend_origin` and run from a client in Iran:

```sh
curl --fail --silent --show-error "$public_api_origin/health/live/"
curl --fail --silent --show-error "$public_api_origin/health/ready/"
curl --fail --silent --show-error "$public_frontend_origin/health/"
curl --fail --silent --show-error -D - \
  -H "Origin: $public_frontend_origin" "$public_api_origin/api/participants/"
curl --fail --silent --show-error -D - \
  -H 'Origin: https://untrusted.example.test' "$public_api_origin/api/participants/"
```

The allowed origin must receive its exact `Access-Control-Allow-Origin`; the
untrusted origin must receive no CORS permission. Curl can still read the
anonymous API. Verify browser preflight for JSON POST and DELETE from the
actual frontend. Test public HTTP redirects, non-looping HTTPS, and spoofed
forwarded values through ingress using the verified header. Health 200 and
deploy checks do not prove ingress behavior.

In the browser, verify static assets, direct SPA navigation/reload, both tabs,
participant dropdowns, and absence of CORS/mixed-content errors. Fresh seeded
views should be empty. For an approved write smoke, record the existing
Alice/Bob pair baseline and then:

1. Create identifiable Alice-for-Bob `50.00` and Bob-for-Alice `20.00` expenses.
   Capture their returned IDs, decimal string amounts, and UTC dates.
2. Reload and verify persistence and a signed `30.00` shift toward Alice in
   that pair, preserving other pairs. An initially empty pair reads “Bob owes
   Alice $30.00”; do not assume an existing production pair starts empty.
3. Cancel deletion and verify no change. Confirm deletion of the reverse
   expense (204), reload, and verify a `50.00` shift from baseline. Repeating
   that exact ID's DELETE returns 404.
4. Delete only the remaining smoke expense through its confirmation. Verify
   baseline expenses/balances return; never bulk-delete existing data.

Disposable CI also verifies Add Person and seed preservation. Exercise Add
Person in disposable/restore validation; a production participant is permanent
under this API and should be added only when intended. Never use the local
`backend/scripts/smoke_containers.py` for production or restored-data validation:
it targets the fixed local Compose stack and expects fresh seeds/empty expenses.

## 5. PostgreSQL backup

Before the first live release, verify managed backup controls, off-instance
destination, frequency/retention, operator, recovery point/time objectives, and
restore privileges. Do not assume automated backups or point-in-time recovery
are enabled. Require a successful restore drill and retained pre-release backup
before relying on recovery. Provider scheduling/storage remain pending.

For portable logical backup, use a trusted PostgreSQL **17** client environment
inside the private network, such as an authorized operator job using
`postgres:17`. The backend image lacks pg_dump/pg_restore. Privately inject
`PGHOST`, `PGPORT`, `PGDATABASE=postgres`, `PGUSER`, and verified `PGSSLMODE`/
certificate settings. Mount authentication in `PGPASSFILE` with mode 0600,
outside the repository. Never print credentials or put a literal URL in commands.
Confirm source identity, then run:

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

The dump includes schema/data/sequences and Django migration history in one
consistent snapshot, but not server-wide roles. The dump role needs read access
to every required table. Retain archive/checksum, source identity, snapshot time,
and matching image digests in approved encrypted durable storage with restricted
access, outside Git and the database instance. Confirm upload completion; a file
left in an ephemeral container is not a retained backup. Archive listing/checksum
alone does not prove recovery. Periodically retrieve and restore an archive.
See [PostgreSQL dump guidance](https://www.postgresql.org/docs/17/backup-dump.html).

## 6. Restore drill or recovery

1. Retrieve the selected archive/checksum into a private operator directory,
   set `restore_archive_dir` to its absolute path, and verify integrity:

   ```sh
   set -eu
   (cd "$restore_archive_dir" && sha256sum --check expenses.dump.sha256)
   backup_archive="$restore_archive_dir/expenses.dump"
   ```

2. Keep production intact. Use a **new empty database** with a unique name;
   never restore into the existing production `postgres` database. The commands
   below assume a verified role may create databases on the selected server.
   If it cannot, arrange an equivalent empty target through verified provider
   controls first. Database creation/restore permissions remain pending.

   ```sh
   set -eu
   restore_db=expense_restore_YYYYMMDD
   test "$restore_db" != postgres
   createdb --maintenance-db=postgres "$restore_db"
   pg_restore --exit-on-error --single-transaction --no-owner --no-acl \
     --dbname="$restore_db" "$backup_archive"
   psql --dbname="$restore_db" --set=ON_ERROR_STOP=1 \
     --command='SELECT count(*) FROM expenses_participant; SELECT count(*) FROM expenses_expense; SELECT count(*) FROM django_migrations;'
   ```

   Replace the date suffix with a unique target name. Explicit `--dbname`
   overrides `PGDATABASE`; private authentication/TLS variables must describe
   the selected server. Restore is one transaction and stops on failure.
   Ownership/ACL omission requires choosing a restore role that grants verified
   application access. Follow the [PostgreSQL restore reference](https://www.postgresql.org/docs/17/app-pgrestore.html).
3. Point an isolated backend validation container at the restored target with a
   private replacement `DATABASE_URL` and the image recorded with the backup.
   Keep public traffic closed. Run `python manage.py check --deploy`,
   `python manage.py migrate --check`, health/read-only API checks, and compare
   recorded counts, IDs, amounts, dates, descriptions, and pairwise balances.
   Create then delete a test expense in the restored target to verify sequences
   and constraints. Do not automatically migrate/seed or use the fresh-stack
   smoke script on a recovery target. Record success and elapsed recovery time.
4. For real recovery, stop public writes, agree the recovery timestamp and
   handling of newer writes, and preserve current data with a forensic backup
   if possible. Obtain explicit authorization for data cutover. Change only the
   backend's private connection setting to the validated restored database,
   restart it, and repeat readiness/browser/API acceptance before admitting
   traffic. Keep the original database until recovery and separate retention
   approval are complete. A drill never repoints the live app.

## 7. Rollback

Preserve previous backend/frontend digests, compiled frontend API origin,
private backend settings, migration state, and backup reference before rollout.
Roll back on failed readiness, increased errors, broken browser operations, or
failed HTTPS/CORS acceptance. Provider rollback/log/metric controls are pending.

1. Halt the candidate rollout. Keep traffic closed when writes/schema safety are
   uncertain. Inspect logs without dumping secret environment values.
2. For a compatible schema, select the previous backend/frontend **digests** in
   their separate apps, restore changed settings from the private release record,
   and wait for readiness. Preserve the database and stable key. The previous
   frontend contains its previous API URL; changing it requires rebuilding.
   Mutable tags or a fresh rebuild are not equivalent rollback artifacts.
3. Packaging changes no schema, so its rollback needs no reverse migration.
   On the first release, if there is no previous production image pair, stop
   the candidate apps, keep traffic closed, preserve the database, and prepare
   a reviewed fix; an unbuilt earlier source revision is not a rollback image.
   For future incompatible migrations, use the reviewed migration rollback
   plan or separate restore/cutover procedure. Do not guess a reverse migration
   target or restore over the live database. Explicitly handle newer writes
   and obtain authorization for any data loss.
4. Repeat health, exact CORS, browser, and controlled API acceptance. Record
   cause, artifacts, database state, and outcome before reopening traffic.
   Reconcile `release` through a reviewed fix/revert PR and green CI afterward;
   do not rewrite shared history.

These production procedures remain unexecuted. Branch controls, registry
promotion, app settings, public HTTPS/URLs, internal PostgreSQL connectivity,
and managed backup restoration still require separate deployment verification.
