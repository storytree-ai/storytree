# Storytree's library on Mint

Operator tooling for ADR-0928, not a product package. The rehearsal does **not**
switch the laptop, Mint lanes or CI. Cloud SQL stays live until the separate
cutover increment. Run from the repository root with Node 24, installed workspace
dependencies, PostgreSQL 16 clients and the existing Google Cloud SDK.

Rollout status at this landing: roles and isolated settings are provisioned, and
the local fixture restore passed. The four-database rehearsal is held on missing
read permissions for 0.2. No verified bucket backups or timer are installed yet.

Every machine-changing script needs a read-only review and a dry run before its
real run. Do not run `cutover.sh` or `rollback.sh` for real during rehearsal.
`setup.sh` is the exact previously reviewed script the owner ran with sudo.
The lane does not have sudo and does not rerun it.

## Setup and rehearsal

Owner-only, on an unprepared Mint host:

```sh
sudo bash infra/library-host/setup.sh --dry-run
sudo bash infra/library-host/setup.sh
```

The service must be active and `psql -X -d postgres -c 'select 1'` must work as
`mickh` over the local socket. The Mint ADC service account must have Object
Creator and Object Viewer on `gs://storytree-498613-library-backups`, without
Object Admin or delete permission. The owner configures the bucket's 30-day
expiry on **backups/** only and seven-day soft delete; archive/ never expires.

```sh
node infra/library-host/host.mjs provision --dry-run
node infra/library-host/host.mjs provision
node infra/library-host/host.mjs rehearsal --dry-run
node infra/library-host/host.mjs rehearsal
node --import tsx infra/library-host/smoke.mjs --dry-run
node --import tsx infra/library-host/smoke.mjs
```

Provisioning creates `storytree_library` (LOGIN, CREATEDB, no superuser or role
creation), which owns each restored database and its objects. Address connections
already act as a database's owner when permitted (library contract 8.3); there is
no Cloud IAM dependency in this address path (contracts 15.1 and 10.12–10.13).
The CI role keeps its existing name, `storytree-ci-health@storytree-498613.iam`,
so restored row policies still name the right role. On Mint it uses a separate
SCRAM password, has no owner membership and may only write health records under
the ported `grants.sql` policies.

Passwords are generated on Mint, never supplied in argv or printed:

- `~/.storytree/library-host/postgres-password`: clients; 0600.
- `~/.storytree/library-host/ci-health-password`: CI; 0600.
- `~/.storytree/library-host/smoke-home`: isolated settings and a `postgres` key
  whose command reads the private client file. The real key store is untouched.

Rehearsal refuses existing destination database names. It copies all four source
databases (`storytree_storytree`, `storytree-activity`, `storytree-trunks`,
`storytree`) through a dedicated loopback Cloud SQL proxy on port 55432 with
automatic IAM authentication. It never changes the Cloud SQL instance. Attempt
markers in `~/storytree-lanes/library-backups/cloud-dump-*` limit this increment
to two full dump attempts; do not remove them to bypass that limit.

The transfer and cutover use `pg_dump -Fc`, not the library's project snapshot.
The project snapshot covers records/history only; the server move must also
preserve activity, trunks, 0.2, schemas, indexes, sequences and embedding caches.
Each dump and its row counts share an exported repeatable-read snapshot.
Restores use `--no-owner --no-acl --role=…`, mapping ownership to the destination
owner, and stop on the first SQL error. CI grants are reapplied explicitly.
See [PostgreSQL's dump documentation](https://www.postgresql.org/docs/16/app-pgdump.html)
and [restore options](https://www.postgresql.org/docs/16/app-pgrestore.html).

Smoke reads arcs and the plan through the isolated CLI, then creates, claims,
releases, reads over the tailnet hostname, and deletes a uniquely named project.
Its claim/release events remain under that throwaway project's name in the local
activity copy; it writes no project `storytree` records.

## Backup and restore proof

For a local fixture check independent of Cloud SQL (after provisioning), run
`node infra/library-host/verify-local.mjs --dry-run`, then the same command without
`--dry-run`. It creates and drops only two uniquely named local databases.

```sh
node infra/library-host/host.mjs backup --dry-run
node infra/library-host/host.mjs backup
# Repeat once for the second independent verified backup.
node infra/library-host/host.mjs backup
```

All four dumps must restore into new scratch databases and match their source
snapshot's per-table row counts before **any** upload. Scratch names are unique;
only databases marked as created by this increment may be dropped. No forced
disconnect or existing-database overwrite is used. A session advisory lock on
local Postgres serializes operations and releases automatically after a crash.

Uploads use only the explicitly checked Mint ADC credential, with a create-only
generation precondition. A manifest records sizes, SHA-256, source PostgreSQL
versions and row counts. It is uploaded **last**: a prefix without a manifest is
incomplete. A network failure may leave incomplete objects, which the uploader
cannot delete. Never treat those as a backup. The bucket lifecycle removes them
after 30 days. Successful runs delete only their own local dump files; manifests
and upload receipts stay under `~/storytree-lanes/library-backups/`.

Copy the `gs://…/backups/<timestamp>` printed by a successful run:

```sh
node infra/library-host/host.mjs restore-backup gs://storytree-498613-library-backups/backups/TIMESTAMP --dry-run
node infra/library-host/host.mjs restore-backup gs://storytree-498613-library-backups/backups/TIMESTAMP
node infra/library-host/host.mjs rollback-rehearsal gs://storytree-498613-library-backups/backups/TIMESTAMP --dry-run
node infra/library-host/host.mjs rollback-rehearsal gs://storytree-498613-library-backups/backups/TIMESTAMP
```

The local proof downloads all four dumps, verifies sizes/hashes and restores each
into scratch. The Cloud SQL proof restores the project backup only into
`storytree_rollback_rehearsal`, checks it, then drops it. It refuses an existing
scratch name. If Mint IAM lacks database-creation rights, the laptop owner must
perform that proof before cutover; do not grant new cloud rights from this lane.
Downloaded proof dumps remain private on disk as recovery evidence.

## Every six hours

```sh
loginctl show-user mickh -p Linger
node infra/library-host/host.mjs install-timer --dry-run
node infra/library-host/host.mjs install-timer
systemctl --user list-timers storytree-library-backup.timer
```

Requires `Linger=yes`; otherwise the owner runs
`sudo loginctl enable-linger mickh`, or a separately reviewed cron installation
is needed. The persistent user timer runs at 00:00, 06:00, 12:00 and 18:00 UTC,
with at most 60 seconds' jitter, and catches a missed run after boot. The installer
copies the reviewed script to a private, versioned runtime outside the disposable
worktree. Its `pg` dependency resolves from the permanent
`~/code/storytree03/node_modules`; keep that checkout installed. Output goes to
`~/storytree-lanes/library-backups/timer.log`. Existing unit files are refused.

The laptop cutover step enables the existing **No library backup for 12 hours**
Cloud Monitoring alert after checking it observes these writes. This rehearsal
does not enable alerts or switch CI. A restore/hash/count/upload failure exits
nonzero; inspect the service journal and timer log. A scratch left after power
loss is evidence, not permission to drop it without checking its ownership.

## Cutover and rollback: future owner window only

First land the CI/Tailscale increment. Then the owner freezes laptop sessions,
Mint lanes, CI and this backup timer. Close the desktop and tool servers, which
hold database connections. No lane in this increment touches queues/night-stop.
The cutover coordinator creates a private freeze JSON file with:

```json
{"direction":"cutover","at":"CURRENT_UTC_ISO_TIME","owner":"mickh","laptopPaused":true,"mintPaused":true,"ciPaused":true,"backupTimerPaused":true}
```

Its attestation expires after 30 minutes. Use `"direction":"rollback"` for the
reverse move. The script also refuses existing client connections on either
server. Dry runs have no side effects:

```sh
bash infra/library-host/cutover.sh --dry-run
# Only in the authorized freeze, never during rehearsal:
bash infra/library-host/cutover.sh --execute-after-freeze /absolute/owner-freeze.json
```

The script dumps the source, restores/checks new staging databases, retains every
old database under a `st_previous_*` name and swaps all four names in one
transaction. Originals are never dropped. Saved settings/auth, manifest and
`swap.json` stay in the private run directory. Failure before the swap leaves
existing databases intact; failure after it leaves the freeze in force. Inspect
`swap.json`, finish the settings/smoke step or reverse the name swaps under the
same freeze. The run writes `undo-swap.sql` before swapping and `swapped` after
commit. While every writer remains paused, an administrator connected to the
destination's `postgres` database can run `psql -X -v ON_ERROR_STOP=1 -f
/absolute/run/undo-swap.sql` with that destination's connection settings. This
renames the newly restored databases back to staging and restores the preserved
original names, dropping nothing. Restore the library setting saved in the run's
`settings.json` before any writer resumes. A missing `swapped` marker after a
crash requires checking the actual names against `swap.json` first. Do not blindly
retry: preserved databases and files are intentional.

After Mint passes, the laptop saves its client key using a command such as
`!ssh mickh@mickh-a520i-ac cat /home/mickh/.storytree/library-host/postgres-password`
via `storytree auth set postgres` stdin, sets the library to
`postgres://storytree_library@mickh-a520i-ac:5432/postgres`, restarts its app/tool
servers and smokes. The laptop alone stops Cloud SQL, enables the alert, switches
CI secrets/settings and resumes the backup timer and lanes.

For rollback, **the laptop starts Cloud SQL first**, then confirms readiness and
freezes all writers. Run `rollback.sh --dry-run`, then its same
`--execute-after-freeze` form. It dumps Mint, restores/checks new Cloud SQL staging
databases, retains originals, switches Mint back and smokes. The laptop switches
itself and CI back before lifting the freeze. Neither script starts, stops,
restarts or reconfigures an instance. The full multi-database transition still
needs its cutover-window proof; the scratch rehearsal proves the restore path.

**Known laptop step:** 0.2's `storytree` database is owned by `cloudsqlsuperuser`,
which Mint IAM cannot assume. Mint IAM also lacks USAGE on its `events` schema:
the second rehearsal attempt was refused before dumping any table. The owner
must grant complete read access and explicitly authorize any further Cloud dump
attempt; both of this increment's two attempt markers are retained. The full rollback script refuses this
before dumping or staging. Before cutover, the laptop owner must arrange and
review the privileged restore/name-swap for that frozen database, or explicitly
settle a policy for retaining its unchanged original during rollback. Do not
claim that the scratch rehearsal proves this privileged full rollback step.

## A week later

The retirement increment requires seven days of verified uploads, another bucket
restore and healthy CI. The owner makes a final archive/ export before deleting
the cloud instance. 0.2's frozen CLI calls the Cloud SQL connector unconditionally
(`packages/library/src/store/connection.ts` in the 0.2 checkout); its instance
override is a Cloud SQL name, not a Postgres address. No address-only switch was
found. Keep its restored Mint database and archived dump, and obtain the owner's
decision on archived access before retiring Cloud SQL. Do not modify 0.2 here.
