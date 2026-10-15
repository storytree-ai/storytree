# storytree 0.3's sign-in route for CI, and CI's health role

This folder began as CI's Google identity for recording own health in the library on Cloud SQL
(ADR-0744 D3-D4). Since the library moved to the Mint box (ADR-0928), the **Own health** workflow
(`.github/workflows/own-health.yml`) records there instead: it joins the tailnet and connects by the
repository variable `HEALTH_PG_ADDRESS` as CI's health role, with the password `HEALTH_PG_PASSWORD`
(infra/library-host/README.md). The Cloud SQL instance was deleted on 2026-10-15, and with it the
health job's Cloud SQL roles, its workload identity binding and its three repository variables went
(increment_56b41c5dc9b8). **The owner applies this folder by hand.**

| File | What it makes |
| --- | --- |
| [`main.tf`](main.tf) | A sign-in route in the existing `github-actions` pool, `storytree-0-3-main`, that accepts **only this repository, only on main**; [infra/website-publish](../website-publish/README.md) signs in through it. And the service account `storytree-ci-health`, which holds no role now: it is kept because CI's health role on the Mint box carries its database name, `storytree-ci-health@storytree-498613.iam`. |
| [`grants.sql`](grants.sql) | What CI's health role may do in the storytree project's database: write health records and nothing else, enforced by the database (ADR-0747). Its header says exactly what it grants and why. The Mint box's copy is infra/library-host/grants.sql. |

## What the health role can and cannot do

It **can** open the project `storytree`, read its plan and history, and add or replace **health**
records (a contract's verified test result) with their history entries.

It **cannot** write any other kind of record (a story, a decision, an increment…), change a record
of another kind into health or back, delete anything, create, alter or drop a table, take on the
role that owns the database, or read or write any other project's records (Postgres lets every
account connect to a database by default, but no table of any project is granted to it). Row-level
security on `record` and `record_event` enforces the record rule; it is enabled, not forced, so the
owner's own accounts, which act as the owning role, are unaffected.

It opens the project only while the project's tables are current: storytree then touches no table.
When a newer storytree has added a table, the owner's next open brings the tables up to date; until
then CI's open is refused with `tables need to be set up or upgraded, which only the role that owns
its database … may do`, and nothing is recorded.

## Applying it

From this folder (`infra/ci-health`), signed in to Google as the project owner
(`gcloud auth application-default login`):

```bash
terraform init
terraform plan
terraform apply
```

It keeps its own state (`ci-health-0.3` in the bucket 0.2's infra uses) and changes nothing of 0.2's.
The first plan after 2026-10-15 drops from the state what was removed by hand with the instance (the
two Cloud SQL role bindings, the workload identity binding and the database user): expect nothing to
add or change.

To check the route (read-only):

```bash
gcloud iam workload-identity-pools providers describe storytree-0-3-main \
  --workload-identity-pool=github-actions --location=global --project=storytree-498613 \
  --format='value(attributeCondition)'
# assertion.repository_id == '1388231144' && assertion.ref == 'refs/heads/main'
```
