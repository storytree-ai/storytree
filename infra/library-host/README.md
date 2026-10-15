# Storytree's library on Mint

Operator tooling for ADR-0928, not a product package. Storytree's own library is
Postgres 16 on the Mint box; these scripts provision its roles, back it up to Cloud
Storage every six hours, and prove a backup restores. Run from the repository root
with Node 24, installed workspace dependencies, PostgreSQL 16 clients and the
existing Google Cloud SDK.

The Cloud SQL rehearsal, cutover and rollback (`rehearsal`, `rollback-rehearsal`,
`cutover.sh`, `rollback.sh`) were retired with the Cloud SQL instance on
2026-10-15, after its databases were exported to the bucket's `archive/`.

The library is the three 0.3 databases: `storytree_storytree`,
`storytree-activity` and `storytree-trunks`. 0.2's frozen `storytree` database was
never moved here (owner, 2026-10-07: "we dont need backups for 0.2"); its final
export sits under `archive/` in the bucket.

The backups also carry `storytree-lag`, the lag runner's history
(`packages/dev-loop/src/lag-box.mjs`): each action's baseline, its runs and the
reasons recorded by `pnpm lag:box rebaseline`. The runs could be measured again;
the reasons could not. They also carry `storytree-quality`, the QA ledger
(`packages/quality-assurance`): every change-reviewer return, hit and answer, which
ADR-0956 D7's ten-review refusal counts; a review cannot be re-run. Both are made
on Mint by their own packages.

Every machine-changing script needs a read-only review and a dry run before its
real run. `setup.sh` is the exact previously reviewed script the owner ran with
sudo. A lane does not have sudo and does not rerun it.

## Reaching it by a remote name

Over the tailnet (`mickh-a520i-ac`, its Tailscale names or `100.97.8.31`) the
library answers only over TLS, and storytree trusts its certificate only where the
address names it (ADR-0997 D1): no build of storytree trusts it, and an address
with no `sslrootcert` trusts Node's authorities alone, so it is refused
`untrusted-server`. `mint-library.crt` here is that certificate's public half,
committed because it is not a secret (ADR-0943 D3). It is a certificate that
cannot sign for other hosts (ADR-0997 D4): issued CA:FALSE, SHA-256
4F:4E:25:4E:…:A8:AA:AD. Its predecessor (90:B0:79:84:…:D3:F1:71, CA:TRUE) was retired
on 2026-10-12 and its key destroyed, so no build that pinned it trusts anything now.

- The laptop keeps its own copy at `C:\Users\mickh\.storytree\0.3\mint-library.crt`,
  and its library is
  `postgres://storytree_library@mickh-a520i-ac:5432/postgres?sslrootcert=C:/Users/mickh/.storytree/0.3/mint-library.crt`.
  Nothing that tidies the storytree home may remove that file.
- CI's two jobs that read the library (`capability-list.yml`, `own-health.yml`)
  name this file in the checkout:
  `?sslrootcert=$GITHUB_WORKSPACE/infra/library-host/mint-library.crt`.
- A new development machine copies `mint-library.crt` somewhere it keeps, then sets
  its library to the box's address with `?sslrootcert=<that absolute path>`.
- The box itself reaches the library at `127.0.0.1`: loopback, no TLS, no file.

## Setup

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
node --import tsx infra/library-host/smoke.mjs --dry-run
node --import tsx infra/library-host/smoke.mjs
```

Provisioning creates `storytree_library` (LOGIN, CREATEDB, no superuser or role
creation), which owns each database and its objects. Address connections
already act as a database's owner when permitted (library contract 8.3); there is
no Cloud IAM dependency in this address path (contracts 15.1 and 10.12–10.13).
The CI role keeps the name it had before the library moved here,
`storytree-ci-health@storytree-498613.iam`, so the row policies still name the
right role. On Mint it uses a separate SCRAM password, has no owner membership and
may only write health records under the `grants.sql` policies; run that file on
the box (its header says how) when its grants change.

CI's capability-list check reads the plan as a third role, `ci_plan_read`
(ADR-0952): read-only, the plan's records and their history, under
`plan-read-grants.sql`. Run that file on the box when its grants change; the gate's
contract 7.7 runs the check's reads as a role granted exactly that file, so a
read the check gains cannot land without its grant.

Passwords are generated on Mint, never supplied in argv or printed:

- `~/.storytree/library-host/postgres-password`: clients; 0600.
- `~/.storytree/library-host/ci-health-password`: CI; 0600.
- `~/.storytree/library-host/smoke-home`: isolated settings and a `postgres` key
  whose command reads the private client file. The real key store is untouched.

Backups use `pg_dump -Fc`, not the library's project snapshot. The project
snapshot covers records/history only; a server backup must also preserve
activity, trunks, schemas, indexes, sequences and embedding caches. Each dump and
its row counts share an exported repeatable-read snapshot. Restores use
`--no-owner --no-acl --role=…`, mapping ownership to the destination owner, and
stop on the first SQL error.
See [PostgreSQL's dump documentation](https://www.postgresql.org/docs/16/app-pgdump.html)
and [restore options](https://www.postgresql.org/docs/16/app-pgrestore.html).

Smoke reads arcs and the plan through the isolated CLI, then creates, claims,
releases, reads over the tailnet hostname, and deletes a uniquely named project.
Its claim/release events remain under that throwaway project's name in the
activity database; it writes no project `storytree` records.

## Backup and restore proof

For a local fixture check independent of the live library (after provisioning), run
`node infra/library-host/verify-local.mjs --dry-run`, then the same command without
`--dry-run`. It creates and drops only two uniquely named local databases.

```sh
node infra/library-host/host.mjs backup --dry-run
node infra/library-host/host.mjs backup
# Repeat once for the second independent verified backup.
node infra/library-host/host.mjs backup
```

All five dumps (the three 0.3 databases, `storytree-lag` and `storytree-quality`) must restore into new scratch databases and match their source
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
```

The proof downloads every dump the manifest names (a backup from before
`storytree-lag` joined names three, one from before `storytree-quality` joined
names four), verifies sizes/hashes and restores each into its own scratch
database, checks its row counts, then drops it. The live library is never
touched. Downloaded proof dumps remain private on disk as recovery evidence.

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

When `host.mjs` changes, re-install so the timer runs the new copy (older runtime
folders stay, as evidence of what ran):

```sh
systemctl --user disable --now storytree-library-backup.timer
rm ~/.config/systemd/user/storytree-library-backup.service ~/.config/systemd/user/storytree-library-backup.timer
node infra/library-host/host.mjs install-timer
grep ExecStart ~/.config/systemd/user/storytree-library-backup.service
```

The **No library backup for 12 hours** Cloud Monitoring alert is the one for these
uploads. A restore/hash/count/upload failure exits nonzero; inspect the service
journal and timer log. A scratch left after power loss is evidence, not permission
to drop it without checking its ownership.
