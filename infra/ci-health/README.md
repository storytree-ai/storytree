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
| [`grants.sql`](grants.sql) | Lets that database user write health records in the storytree project's database and nothing else, enforced by the database (ADR-0747). Its header says exactly what it grants and why. |

## What the account can and cannot do

It **can** sign in to the instance, open the project `storytree`, read its plan and history, and
add or replace **health** records (a contract's verified test result) with their history entries.

It **cannot** write any other kind of record (a story, a decision, an increment…), change a record
of another kind into health or back, delete anything, create, alter or drop a table, take on the
role that owns the database, or read or write any other project's records (Postgres lets every
account connect to a database by default, but no table of any project is granted to it). Row-level security on `record`
and `record_event` enforces the record rule; it is enabled, not forced, so the owner's own accounts
(the laptop, the Mint box, the app), which act as the owning role, are unaffected.

It opens the project only while the project's tables are current: storytree then touches no table.
When a newer storytree has added a table, the owner's next open (the app, after its update) brings
the tables up to date; until then CI's open is refused with `tables need to be set up or upgraded,
which only the role that owns its database … may do`, and nothing is recorded.

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
Studio**, database **`storytree_storytree`**, signed in as **your own Google account** (IAM
database authentication: the account the storytree app uses, which may act as the database's
owning role), and run [`grants.sql`](grants.sql). It first takes on that role, so everything it
grants is granted by the owner; if it says `… may not act as …`, you are signed in as an account
that may not (the `postgres` user, say): sign in as your own. Its last query must show one row with
`may_connect`, `reads`, `writes_record`, `writes_history` and `rls` true, and `may_act_as_owner`,
`may_create` and `forced` false.

Before step 4, open the project once with a storytree that has ADR-0747 (the app after its update,
or `pnpm storytree arc list` from a current checkout): that open records the tables' version, which
CI's open reads to know it need not touch them.

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
user is missing; `permission denied` means step 2 has not run; `tables need to be set up or
upgraded` means the owner's storytree has not opened the project since its tables last changed
(open it once, as step 2 says, and run the workflow again).

To check what the account may do at any time, run grants.sql's last query on its own (it changes
nothing).

## Undoing it

Unset the three variables (the workflow goes back to recording nothing). To take its rights back
without destroying anything, in `storytree_storytree` as your own account:

```sql
SET ROLE storytree_creator;  -- or whichever role owns storytree_storytree
REVOKE ALL ON library_meta, record, record_event FROM "storytree-ci-health@storytree-498613.iam";
REVOKE ALL ON SEQUENCE record_event_seq_seq FROM "storytree-ci-health@storytree-498613.iam";
REVOKE ALL ON SCHEMA public FROM "storytree-ci-health@storytree-498613.iam";
REVOKE CONNECT ON DATABASE storytree_storytree FROM "storytree-ci-health@storytree-498613.iam";
DROP POLICY ci_health_read ON record; DROP POLICY ci_health_insert ON record; DROP POLICY ci_health_update ON record;
DROP POLICY ci_health_read ON record_event; DROP POLICY ci_health_insert ON record_event;
RESET ROLE;
```

Row-level security can stay enabled: it binds no account but CI's. Then `terraform destroy` here
removes the database user and the identity (Postgres refuses to drop a user that still holds
grants, so revoke first).
