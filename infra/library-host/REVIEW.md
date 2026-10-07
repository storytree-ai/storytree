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
