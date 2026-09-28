# CI's identity for recording own health

After each change to main, the **Own health** workflow (`.github/workflows/own-health.yml`) runs each
of storytree 0.3's own stories' tests and records every contract's verified health in the library
on Cloud SQL, as "storytree test run on CI", with the commit in each note (ADR-0744 D3-D4). To do
that it needs a Google identity of its own. This folder is that identity, written down; **the owner
applies it by hand**. Until the last step is done, the workflow says "CI has no Google identity to
record health with" and passes without recording anything.

| File | What it makes |
| --- | --- |
| [`main.tf`](main.tf) | A sign-in route in the existing `github-actions` pool that accepts **only this repository, only on main**; the service account `storytree-ci-health` (Cloud SQL Client + Cloud SQL Instance User, nothing else); its database user on `storytree-pg`. |
| [`grants.sql`](grants.sql) | Lets that database user act as the role that owns the library's database. Read its header: why table grants alone do not work, and what that costs. |

## What to run, in order

Everything from this folder (`infra/ci-health`), signed in to Google as the project owner
(`gcloud auth application-default login`).

**1. Create the identity.**

```bash
terraform init
terraform plan     # expect 6 to add, 0 to change, 0 to destroy
terraform apply
```

It keeps its own state (`ci-health-0.3` in the bucket 0.2's infra uses) and changes nothing of 0.2's.

**2. Let it into the library.** Open the instance `storytree-pg` in the Cloud Console, **Cloud SQL
Studio**, database `postgres`, signed in as the `postgres` user (or the account that created the
library's owning role), and run [`grants.sql`](grants.sql). Its last query must show one row with
`may_act = true`. If it says `permission denied to grant role`, the account you are signed in as
did not create that role: sign in as the one that did.

**3. Check the sign-in route before trusting it** (optional, read-only):

```bash
gcloud iam workload-identity-pools providers describe storytree-0-3-main \
  --workload-identity-pool=github-actions --location=global --project=storytree-498613 \
  --format='value(attributeCondition)'
# assertion.repository_id == '1388231144' && assertion.ref == 'refs/heads/main'
```

**4. Turn it on.** Set the three repository variables from Terraform's outputs (Settings > Secrets
and variables > Actions > Variables, or with `gh`):

```bash
gh variable set HEALTH_WIF_PROVIDER      --repo storytree-ai/storytree --body "$(terraform output -raw HEALTH_WIF_PROVIDER)"
gh variable set HEALTH_SERVICE_ACCOUNT   --repo storytree-ai/storytree --body "$(terraform output -raw HEALTH_SERVICE_ACCOUNT)"
gh variable set HEALTH_CLOUDSQL_INSTANCE --repo storytree-ai/storytree --body "$(terraform output -raw HEALTH_CLOUDSQL_INSTANCE)"
```

They are variables, not secrets: none of them is a credential. The sign-in itself is GitHub's
short-lived token, exchanged each run.

## How to verify it worked

1. Run the workflow on main: `gh workflow run own-health.yml --repo storytree-ai/storytree --ref main`
   (or Actions > Own health > Run workflow), and watch it: `gh run watch --repo storytree-ai/storytree`.
2. Its log says `the library on Cloud SQL: storytree-498613:australia-southeast1:storytree-pg, as
   storytree-ci-health@storytree-498613.iam`, then each story's verified health "by "storytree test
   run on CI" at commit <sha>", and ends `recorded: N passing, M failing; …` for each story.
3. In the library, a contract's verified health now reads `storytree test run on CI · <time> · 2/2
   tests passed, at commit <sha>` (the forest's drill-down shows it, or `storytree` on the laptop).

If it fails: a red **Sign in to Google** step means step 4's variables do not match Terraform's
outputs, or the sign-in route refused the run (a run not on main always is). Past that, the check
says what to fix in its own words: `did not let … in as a database user` means step 1's database
user is missing; `must be owner` or `permission denied` means step 2 has not run.

## Undoing it

Unset the three variables (the workflow goes back to recording nothing), then `terraform destroy`
here. The role grant goes with the database user; to take it back without destroying anything:
`REVOKE <owning role> FROM "storytree-ci-health@storytree-498613.iam";`.
