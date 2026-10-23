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
snapshot's per-table row counts before **any** upload. Every restore, here and in
the proof below, runs `pg_restore` and reads its counts as `storytree_library` over
`127.0.0.1` with the password in `~/.storytree/library-host/postgres-password`,
never as the superuser; the superuser only creates and drops the scratch database
around it. `pg_dump` and `pg_restore` are PostgreSQL 16's, called by absolute path
(`/usr/lib/postgresql/16/bin`). Scratch names are unique;
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

Copy the `gs://…/backups/<timestamp>` printed by a successful run. A restore takes
only a backup verified off the box: `--verified` names the verified list, a text file
the off-box check writes, one manifest SHA-256 opening each line (`#` lines are
comments).

```sh
node infra/library-host/host.mjs restore-backup gs://storytree-498613-library-backups/backups/TIMESTAMP --verified VERIFIED-LIST --dry-run
node infra/library-host/host.mjs restore-backup gs://storytree-498613-library-backups/backups/TIMESTAMP --verified VERIFIED-LIST
```

Before it downloads any dump it refuses the prefix when its manifest's SHA-256 is not
on that list, when the timestamp in its name is in the future, or when any of its
objects was created before that time or more than two hours after it. The proof
then downloads every dump the manifest names (a backup from before
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
bundles the reviewed script with its `pg` dependency (esbuild) into one `host.mjs`
in a private, versioned runtime folder outside the disposable worktree, so nothing a
backup runs resolves from any checkout's `node_modules`. The service's `PATH` is
`/usr/bin:/bin` alone; gcloud and the PostgreSQL clients are named by absolute path.
Output goes to `~/storytree-lanes/library-backups/timer.log`. Existing unit files are
refused.

When `host.mjs` changes, re-run `install-timer` as below so the timer runs the new
bundle (older runtime folders stay, as evidence of what ran). A runtime installed
before the bundling keeps running its old copy until this is done:

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

## Cloud sessions' HTTPS route (ADR-1093)

A Claude Code cloud session cannot reach port 5432 or the tailnet, so it reaches the library
over HTTPS instead: Cloudflare Access (a service token) and the owner's tunnel `mint-library`,
whose public hostname `library.storytree.dev` Cloudflare routes to `http://localhost:8080` on
the box. `cloud-route.sh` installs the box's half as two systemd services:

- `storytree-wsproxy`: Neon's wsproxy (Postgres over WebSocket), listening on 127.0.0.1:8080
  (metrics on 127.0.0.1:2112), allowed to reach only 127.0.0.1:5432, as a dynamic unprivileged
  user that systemd also forbids any address but loopback.
- `storytree-cloudflared`: cloudflared running the tunnel, its token read from
  `/etc/storytree/cloudflared-mint-library.token` (root:root, 600) through systemd's
  credentials, so it is never on a command line, in a unit file or printed.

Both versions are pinned. cloudflared is Cloudflare's .deb, checked against its published
SHA-256. wsproxy has no releases, so the script builds a pinned commit with a pinned, checked Go,
its modules checked against its `go.sum`; the build is reproducible, so the binary's own SHA-256
is pinned too and a build that differs is refused. It changes nothing in pg_hba or Postgres:
wsproxy arrives from 127.0.0.1, which pg_hba already admits with a password, and the script
stops if that line is missing. A tunnel connection therefore looks like a local client to
Postgres; what gates it is Access's service token and the role's password.

The owner runs it (ADR-0928 D5; no lane does), from PowerShell on the laptop. First the token,
from GCP Secret Manager into a private file in his home on the box:

```powershell
gcloud secrets versions access latest --secret=cloudflare-mint-library --project=635716509357 | ssh mint 'umask 077; cat > ~/cloudflared-token.tmp'
```

Run the real run straight after: until it moves the token into place, any process of his account
on the box could read that file (delete it with `ssh mint 'rm ~/cloudflared-token.tmp'` if the run
stops early). Then the script from `main`, its dry run (no sudo), and the real run. The real run
first copies the script into root's own folder and checks that copy against the SHA-256 recorded in
`REVIEW.md` (read it on GitHub, not on the box), so nothing his account runs on the box can change
what root runs; the run moves the token into place and deletes the temporary file:

```powershell
ssh mint 'git -C ~/code/storytree03 fetch -q origin main && git -C ~/code/storytree03 show origin/main:infra/library-host/cloud-route.sh > ~/cloud-route.sh'
ssh mint 'bash ~/cloud-route.sh --dry-run --install-token ~/cloudflared-token.tmp'
ssh -t mint 'sudo install -m 700 ~/cloud-route.sh /root/cloud-route.sh && sudo sha256sum /root/cloud-route.sh | grep ^6be3b0305c4161c2ad27307eca89ec63f014c34231dd2c7b96863e18a17cdfef && sudo bash /root/cloud-route.sh --install-token ~/cloudflared-token.tmp'
ssh -t mint 'sudo bash /root/cloud-route.sh --review'
```

If the `grep` prints nothing, the copy is not the reviewed script, and nothing runs. The review is
run from root's checked copy too, so nothing on the box can fake its report.

`--review` changes nothing and needs no sudo (sudo only lets it read root's copy): it reports the installed versions against the
pins, the services and the user they run as, every listener on 8080, 2112 and 20241, wsproxy's
allow-list and what it answers for 127.0.0.1:5432 and for 127.0.0.1:22, what
`https://library.storytree.dev` answers a request with no service token (Access's 302, 401 or 403;
anything else is a warning), and whether every pg_hba rule covering 127.0.0.1 asks for a password.
Rerunning the real run is safe: what already matches is left alone. To move to new versions,
change a pin together with its hash and have the script reviewed again.

### A cloud session on the route

The path, end to end: a Claude Code cloud session's `pg` client (packages/library, a `wss://`
address) → the container's agent proxy (`HTTPS_PROXY`, which lets only the environment's allowed
domains through) → Cloudflare Access at `library.storytree.dev`, which wants the service token's
two headers → the tunnel `mint-library` → `http://localhost:8080` on the box (wsproxy) →
Postgres on 127.0.0.1:5432, as `storytree_library` with its password.

Where each secret lives:

| Secret | In the cloud environment | Master copy | On the box |
| --- | --- | --- | --- |
| Access service token `cloud-sessions` (id and secret) | `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` | GCP Secret Manager, project 635716509357 | — |
| `storytree_library`'s password | `PGPASSWORD` | GCP Secret Manager, project 635716509357 | — |
| The tunnel's token | — | Secret Manager `cloudflare-mint-library` | `/etc/storytree/cloudflared-mint-library.token` |

The cloud environment (claude.ai, the storytree environment's settings) also lists
`library.storytree.dev` in its **Allowed domains**: without it the agent proxy refuses the
connection before Cloudflare sees it. The library reads the password from `PGPASSWORD` when no
`postgres` key is saved, and the Access headers from `CF_ACCESS_CLIENT_ID` and
`CF_ACCESS_CLIENT_SECRET` when no `cf-access-client-id` / `cf-access-client-secret` keys are saved,
so a cloud session saves no keys at all.

A fresh container needs nothing by hand. Every cloud session starts with no storytree settings,
so the session-start hook (`packages/dev-loop/src/provision-worktree.mjs`, contract 2.6), when
`CLAUDE_CODE_REMOTE=true` and `CF_ACCESS_CLIENT_ID` is set, installs with
`ONNXRUNTIME_NODE_INSTALL=skip` (the agent proxy cuts off onnxruntime's download, and the failed
install also timed out the MCP server's start), then runs
`storytree settings set library postgres wss://storytree_library@library.storytree.dev/postgres`
(or the environment's `STORYTREE_LIBRARY_ADDRESS`, when set) and `storytree doctor --join storytree`.
Each container is a new machine to the library, so each joins as its own. To do it by hand:

```sh
ONNXRUNTIME_NODE_INSTALL=skip pnpm install
pnpm storytree settings set library postgres wss://storytree_library@library.storytree.dev/postgres
pnpm storytree doctor --join storytree
pnpm storytree arc list
```

The tunnel's published route must be **HTTP**, `http://localhost:8080`, never HTTPS: wsproxy speaks
plain HTTP on loopback, and an HTTPS origin makes cloudflared fail its TLS handshake ("first record
does not look like a TLS handshake"), which every client sees as Cloudflare's 502. Reading the
statuses from a cloud session: 403 (or a redirect to a login page) without the token, or 401 with
a wrong secret, is Access refusing; 502 or 530 past Access is the tunnel or the box (cloudflared
down, or the route's origin wrong); a WebSocket error after that is wsproxy or Postgres.

**Rotating the service token.** It expires about **2027-10-20**. Before then: in Cloudflare Zero
Trust, Access → Service Auth, make a new service token; add it to the `cloud-sessions token` policy
of the `storytree library` application; put its id and secret into Secret Manager (new versions)
and into the cloud environment's `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET`; check from a
new cloud session that `pnpm storytree arc list` reads; then revoke the old token. The password
rotates the same way: Postgres first (`ALTER ROLE storytree_library PASSWORD …` on the box), then
Secret Manager and `PGPASSWORD`.

**Turning the route off.** Stop the box's half: `ssh -t mint 'sudo systemctl disable --now
storytree-cloudflared'` (and `storytree-wsproxy` as well to close the loopback listener). Cloud
sessions then get 502/530 past Access and reach nothing; the laptop, CI and Mint lanes are
untouched, since they reach Postgres over Tailscale or loopback and never through this route. For
a harder stop, revoke the service token in Access, or remove the public hostname from the tunnel.
`sudo systemctl enable --now storytree-wsproxy storytree-cloudflared` turns it back on.
