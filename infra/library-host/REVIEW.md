# Script review — 2026-10-06

Read-only reviewer `/root/review_host` approved the scripts before execution.
The reviewer made no edits, ran no scripts and accessed no databases.

Initial review found four issues, all corrected and re-reviewed: a stale file
lock after interruption, the timer depending on the temporary worktree,
incomplete SQL password-log protection, and inherited PostgreSQL environment
settings. Transition review then found that an IAM reader could see another
connection's backend type as NULL; the freeze check now counts all connections.
The first dump attempt exposed 0.2's unassumable database owner. A further
read-only review approved using its existing IAM table grants with row security
off (failure rather than filtered data), trying 0.2 first and preserving each
completed dump's manifest. Rollback now preflights owner permissions before any
dump; the laptop must supply the missing privileged path for 0.2.

Final review: **Approved. No remaining review blockers.** Host and smoke approval
covers the rehearsal increment's authorized actions after dry runs. Cutover and
rollback have dry-run approval for this increment; their real execution belongs
to the separately authorized future freeze window.

Approved SHA-256 values:

```text
5b08ad9f2550ed4e16cc1fd916b3d8228a699f87753f356b95db44e6a51293f4  host.mjs
4101c6b5a5bf1bff7fc90a84cab5b929d520fac5daf74f882811244689a97a53  smoke.mjs
2fc649788cf3175c5093fa75efdbd86a8c551bd30cc58f2cc4a7065f8c645238  transition.mjs
6612f24130477114e6c299ed095e72c9cdc98a46164cf1bd6e03862bab7af66e  cutover.sh
f50d740b96317d5211110ab4b063a19c028f4074cfaaeb5d875a6de4bb7ab7ae  rollback.sh
9ae2652acd9baf64c56eec59238fb1d02f7a074319f123295a4de386d5404083  grants.sql
30ae3bacafd6e6886085a699845e1e07560064f50245d2861a84f4663413154b  verify-local.mjs
```

`setup.sh` is the exact existing owner-run setup script; this lane did not rerun
it. `host.test.mjs` protects count comparison, manifest validation and the freeze
attestation. Operational proof and bucket receipts live in the lane report and
private `~/storytree-lanes/library-backups/` manifests, not in source control.

`verify-local.mjs` received a further read-only approval and passed its dry run
and real run: two unique fixture databases verified real dump/restore, counts,
schemas, indexes, sequence state and bad-checksum refusal, then were dropped.
This proof does not stand in for the blocked four-database rehearsal or bucket
backups. Mint IAM lacks USAGE on 0.2's `events` schema; the migration increment
remains held for owner action. No backup timer was installed.

## Addendum — 2026-10-07: three 0.3 databases only

The owner's answer to question_fa4243ccb8ef ("A - we dont need backups for 0.2")
takes 0.2's frozen `storytree` database out of scope. `host.mjs` and
`transition.mjs` now copy, back up, stage, swap and roll back exactly
`storytree_storytree`, `storytree-activity` and `storytree-trunks`, and `dump`
refuses any database whose owner it may not act as. The 0.2 read-access SQL above
was never run and its files were removed. The two `cloud-dump-*` markers are
retired; a fresh `cloud-copy-*` budget allows one copy and at most one more.

A read-only reviewer approved the amendment with no blockers and three minor
findings, all applied and re-approved: the rehearsal refuses existing local
databases before writing its attempt marker or dumping, the rollback preflight
requires all three databases on the target, and the Cloud scratch rehearsal
prefers the project database's owner role.

The first real copy then met a full Cloud SQL ("remaining connection slots are
reserved"), after writing its attempt marker and before dumping anything. A
reviewed change makes Cloud connections wait for a slot (refused at connect, so
no data moves), writes the marker only after the inventory check, and, after a
further review, retries scratch-database create, mark and drop the same way. The
second copy, smoke, three verified backups, a bucket restore, the Cloud scratch
rehearsal and the timer installation all ran at the hashes below, each after its
dry run. They supersede the hashes above for `host.mjs` and `transition.mjs`:

```text
10e700f33c71ddadb3032a750e92bfe5eaefa44700d06f1b607e05c2efe6806d  host.mjs
7e2a4bb5cce511f062f5e19e00e6c1017cfe99c06b58731e09b531fdb5549ed5  transition.mjs
```

## Addendum — 2026-10-12: storytree-lag joins the backups

increment_35a3540e35b2. `backup` also dumps, scratch-restores and uploads
`storytree-lag`, the lag runner's history (made by `pnpm lag:box` on Mint, owned by
`storytree_library`, unmarked, so only the three marked databases keep the mark
check; `dump` still refuses a database it may not act as). A manifest naming the
three, or the three and `storytree-lag`, restores; anything else is refused. The
Cloud copy, cutover and rollback still name the three. Reviewed by the
change-reviewer with no findings. Real runs, each after its dry run: one verified
backup (`backups/20261011T202510219Z-c1c443e3`, four dumps), a bucket restore of
it and of the pre-change `backups/20261011T180047712Z-56cc40d1`, then the timer
re-installed by the README's path (the replaced units kept under
`~/storytree-lanes/library-backups/replaced-units-increment_35a3540e35b2/`), now
running `runtime-20261011T205304635Z-3c67f849`:

```text
cf16714fe59d2fc0e168b2cce67b3329cece039e4ee88700e9919fe535c7a0f7  host.mjs
```

## Addendum — 2026-10-15: storytree-quality joins the backups

increment_12f4800dc93e. `backup` also dumps, scratch-restores and uploads
`storytree-quality`, the QA ledger (`packages/quality-assurance`: every
change-reviewer return, hit and answer, which ADR-0956 D7's ten-review refusal
counts), owned by `storytree_library` and unmarked like `storytree-lag`. A manifest
naming the three, the three and `storytree-lag`, or all five restores; anything
else is refused. The Cloud copy, cutover and rollback still name the three.
Reviewed by the change-reviewer with no findings. Real runs, each after its dry
run: one verified backup (`backups/20261015T000729408Z-82609577`, five dumps), a
bucket restore of it and of the pre-change `backups/20261015T000047703Z-d54d3776`
(four dumps), then the timer re-installed by the README's path (the replaced units
kept under `~/storytree-lanes/library-backups/replaced-units-increment_12f4800dc93e/`),
now running `runtime-20261015T001739907Z-d8a9b3a8`:

```text
33223a1040ffd5ad51c8f697cce8bc3dd33ba9ffec72350a67e4e4113edb479a  host.mjs
```

## Addendum — 2026-10-15: the Cloud SQL paths retired

increment_f371a46ecc94. The Cloud SQL instance was deleted on 2026-10-15
(increment_56b41c5dc9b8), so `host.mjs` loses `rehearsal`, `rollback-rehearsal`,
its Cloud SQL proxy and the connection-slot wait, and `transition.mjs`,
`cutover.sh` and `rollback.sh` are removed with the freeze check and its test.
`provision`, `backup`, `restore-backup` and `install-timer` are unchanged, except
that the timer's runtime copy no longer carries `grants.sql`, which `backup` never
read. The hashes above stay as evidence of what ran.

Reviewed by the change-reviewer with no findings. Real runs, each after its dry
run: one verified backup from the branch (`backups/20261015T061401182Z-01713fc9`,
five dumps), then the timer re-installed by the README's path (the replaced units
kept under `~/storytree-lanes/library-backups/replaced-units-increment_f371a46ecc94/`),
now running `runtime-20261015T062513351Z-48e865e3`, whose service was started once
and passed (`backups/20261015T062517218Z-88be4a8d`):

```text
2a23ecc2673f55b067da99fa77a585b3de14f76a600aac09f4f9fa1d9708979a  host.mjs
```

## Addendum — 2026-10-21: cloud-route.sh (ADR-1093 D3)

`cloud-route.sh` installs the cloud sessions' HTTPS route on the box: `storytree-wsproxy`
(127.0.0.1:8080, reaching only 127.0.0.1:5432) and `storytree-cloudflared` (the owner's tunnel,
its token through systemd credentials). A read-only reviewer, working blind, re-derived every pinned
hash (Go 1.27.3, cloudflared 2026.10.2's .deb, wsproxy's source at 99ed92dd), rebuilt wsproxy twice
offline from two paths to the pinned binary hash, and ran it with the unit's settings: only
127.0.0.1:5432 was proxied; other ports, encoded addresses, `0x7f.0.0.1` and the Host header were
refused. Both units pass `systemd-analyze verify` (exposure 4.0 and 4.1); the dry run and review
ran as an unprivileged user and changed nothing.

First review: approved with minor findings, all applied and re-reviewed: the real run checks a
root-owned copy of the script against the hash below (the copy in the owner's home is writable by
his account's other processes); the scratch folder is removed on exit; the token file must be a
regular file of the sudo user, read (at most 8 KiB) and deleted as that user; no `&&` chain hides a
failed step; every pg_hba rule covering 127.0.0.1 must ask for a password; the review runs
`dpkg --verify` and asks the public hostname without a token, expecting Access's refusal (it
answered 403); cloudflared stops with wsproxy (`BindsTo=`), may not reach private, tailnet or
link-local ranges, and serves no management diagnostics. The re-review approved the fixes and
found re-runs would stop at the port check (process names are cut to 15 characters); ports are now
matched by process id against each unit's main process.

The owner's real run is pending; no lane runs it.

Approved SHA-256:

```text
6be3b0305c4161c2ad27307eca89ec63f014c34231dd2c7b96863e18a17cdfef  cloud-route.sh
```
