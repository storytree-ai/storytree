# storytree 0.3's sign-in route for CI, and CI's health role

This folder began as CI's Google identity for recording own health in the library on Cloud SQL
(ADR-0744 D3-D4). Since the library moved to the Mint box (ADR-0928), the **Own health** workflow
(`.github/workflows/own-health.yml`) records there instead: it joins the tailnet and connects by the
repository variable `HEALTH_PG_ADDRESS` as CI's health role, with the password `HEALTH_PG_PASSWORD`
(infra/library-host/README.md). The Cloud SQL instance was deleted on 2026-10-15, and with it the
health job's Cloud SQL roles, its workload identity binding and its three repository variables went
(increment_56b41c5dc9b8). **The owner applies this folder by hand.**
The gate's check:owner-applies fails a branch that changes it (Markdown aside) unless an open increment
waits on the owner with a note naming this folder (packages/dev-loop/src/owner-applies.mjs lists the folders).

| File | What it makes |
| --- | --- |
| [`main.tf`](main.tf) | A sign-in route in the existing `github-actions` pool, `storytree-0-3-main`, that accepts **only the repositories its `repository_ids` names (today this one), only on main**; [infra/website-publish](../website-publish/README.md) signs in through it. And the service account `storytree-ci-health`, which holds no role now: it is kept because CI's health role on the Mint box carries its database name, `storytree-ci-health@<project>.iam`. |
| [`grants.sql`](grants.sql) | What CI's health role may do in the storytree project's database: write health records and nothing else, enforced by the database (ADR-0747). Its header says exactly what it grants and why. The Mint box's copy is infra/library-host/grants.sql. |

## What the health role can and cannot do

It **can** open the project `storytree`, read its plan (stories, capabilities, contracts, arcs,
increments, the anchor), its health and their history, and add or replace **health**
records (a contract's verified test result) with their history entries.

It **cannot** read any other kind of record (a decision, a note, a question…) or write any but
health (a story, a decision, an increment…), change a record
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
PROJECT="$(gcloud config get-value project)"   # the cloud project's id
export TF_VAR_project_id="$PROJECT"
terraform init -backend-config="bucket=$PROJECT-tfstate"
terraform plan
terraform apply
```

The project's id is not written in this folder: `PROJECT` is it (`gcloud projects list` names it if
the login has none set), `TF_VAR_project_id` gives it to every plan and apply in that shell, and
init names the state bucket after it. A folder initialised before the bucket left `main.tf` needs
that init once more; it finds the same state, so nothing moves.

It keeps its own state (`ci-health-0.3` in the bucket 0.2's infra uses) and changes nothing of 0.2's.
The first plan after 2026-10-15 drops from the state what was removed by hand with the instance (the
two Cloud SQL role bindings, the workload identity binding and the database user): expect nothing to
add or change.

To check the route (read-only):

```bash
gcloud iam workload-identity-pools providers describe storytree-0-3-main \
  --workload-identity-pool=github-actions --location=global --project="$PROJECT" \
  --format='value(attributeCondition)'
# (assertion.repository_id == '1388231144' || assertion.repository_id == '1433007599') && assertion.ref == 'refs/heads/main'
```

Its mappings are limited to what bindings use: `attribute.job_workflow_ref`, which
infra/website-publish's binding names, beside `google.subject` and `attribute.repository_id`
(`--format='json(attributeMapping)'` on the same command lists them).

## Trusting another repository

The route trusts repositories by numeric id, the list `repository_ids` (default
`["1388231144", "1433007599"]`: this repository and the stand-in `storytree-ai/storytree-next`, which
takes this one's name at the cut-over). A repository made new under an old name has a new id, so its
runs are refused until its id is in the list. Trust a new id **beside** the old one, never instead
of it, so the old repository's CI keeps signing in until it is done with; drop the old id after.

From this folder, signed in and initialised as above, with `TF_VAR_project_id` set in the shell
(`<new id>` is `gh api repos/<owner>/<name> --jq .id`):

```bash
terraform plan  -var='repository_ids=["1388231144","<new id>"]'   # expect 0 to add, 1 to change, 0 to destroy
terraform apply -var='repository_ids=["1388231144","<new id>"]'
```

The one change is the provider's `attribute_condition`, in place:
`(assertion.repository_id == '1388231144' || assertion.repository_id == '<new id>') && assertion.ref == 'refs/heads/main'`.
Nothing is destroyed, and the service accounts and infra/website-publish's binding are untouched.
Dropping the old id later is the same two commands with `-var='repository_ids=["<new id>"]'`,
which puts the condition back to the single-id form. After each apply, land the same list as the
variable's default in [`main.tf`](main.tf), so a plain `terraform plan` shows no change again.
The read-only check above prints which ids the condition trusts.

The Tailscale side is the admin console's, not Terraform's: CI joins the tailnet with a trust
credential (Settings > Trust credentials) whose subject must match the run's OIDC subject. This
repository uses GitHub's immutable subject, which carries the owner's and the repository's ids:
`repo:storytree-ai@306221093/<name>@<repository id>:…`. Two jobs sign in, each with its own
credential: **Own health** (its client id and audience are the repository variables
`TS_WIF_CLIENT_ID` and `TS_WIF_AUDIENCE`) and **Capability list** (the same two names as variables
of the environment `plan-read`). To trust another repository, for each of the two credentials:

1. Open it in the console and note its subject, issuer, tags and scopes.
2. Add a new credential with the same issuer, tags and scopes, and the same subject with
   `<name>@<repository id>` replaced by `*@<new id>`:
   `repo:storytree-ai@306221093/*@<new id>:<tail>`, the tail kept from the old one. The `*` stands for
   the repository's name, so the credential matches both before and after a rename (the subject
   follows the name, and a repository keeps its id through a rename); the id pins it to the one
   repository.
3. Put the new credential's client id and audience into the new repository's `TS_WIF_CLIENT_ID`
   and `TS_WIF_AUDIENCE`, at the same place its twin's are (repository variables, or the
   `plan-read` environment's).

Keep the old credentials until the old repository is retired, then delete them.
