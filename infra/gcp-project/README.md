# Google Cloud project cleanup

`cleanup.ps1` tidies the storytree Google Cloud project (Windows PowerShell 5.1, run by the owner
with his own `gcloud` sign-in). It deletes what 0.2 left behind and turns off the APIs 0.3 does
not use. Every name it touches is written out in the script, next to keep-lists it checks first.

```powershell
powershell -ExecutionPolicy Bypass -File infra\gcp-project\cleanup.ps1 -Project <project-id>          # dry run: lists, changes nothing
powershell -ExecutionPolicy Bypass -File infra\gcp-project\cleanup.ps1 -Project <project-id> -Apply   # asks for the project id, then runs
```

Each line of output says what happens to one thing: `WOULD` (dry run), `DONE`, `FAILED`, `SKIP`
(already gone), `WAIT` (date-gated), `REFUSE` (a guard stopped it), `KEEP`, or `LEAVE` (on
neither list, so untouched). It exits 0 when everything it tried worked and 2 when a step was not
done. It is safe to run again.

What stays, and why:

- APIs: Cloud Storage, Secret Manager, IAM, IAM Credentials, Security Token Service (GitHub's
  sign-in, used by `infra/ci-health` and `infra/website-publish`), BigQuery, Billing Budgets,
  Logging, Monitoring, Pub/Sub, and the three gcloud needs to make changes (Resource Manager,
  Service Usage, Service Management), and Dataform, Dataplex and Datastore, which the Google Cloud
  APIs bundle depends on.
- Buckets: `storytree-dist`, `<project>-library-backups` (the library's backups and 0.2's database
  export) and `<project>-tfstate` (Terraform state of `infra/ci-health` and `infra/website-publish`).

The two 0.2 deployer service accounts are deleted only from 2026-10-31 on, a week after they were
disabled, and only while they are still disabled; before then the script says `WAIT`, so run it
again after that date.

APIs are turned off without `--force`, so Google refuses to turn off one that another enabled API
depends on, or one used in the last 30 days. Cloud SQL Admin was last used around 2026-10-15, so
expect it to be `FAILED` until about 2026-11-15: run the script again then. A refusal never turns
off anything else.

## Billing read access for the Mint box

`grant-billing-read.ps1` gives the box's service account (`storytree-mint`) what the twice-daily
spend reading needs, and nothing else: `roles/bigquery.dataViewer` on the dataset `billing_export`
only, and `roles/bigquery.jobUser` on the project, to run its one query. Run it from the checkout,
after `git pull`, with your own `gcloud` sign-in (Windows PowerShell 5.1):

```powershell
powershell -ExecutionPolicy Bypass -File infra\gcp-project\grant-billing-read.ps1           # dry run: reads, changes nothing
powershell -ExecutionPolicy Bypass -File infra\gcp-project\grant-billing-read.ps1 -Apply    # asks for the project id, then grants
```

Its lines read `WOULD`, `DONE`, `FAILED`, `SKIP` (already granted) and, after `-Apply`, `CHECK` (read
back). Both grants only add: nothing already granted is removed. It exits 0 when both are in place
(or, dry, would be made), 2 when a step was not done, and is safe to run again.
