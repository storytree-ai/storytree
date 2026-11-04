# The evidence bucket

Evidence media a lane makes (screenshots, screen clips, performance traces, coverage files) goes to a
private Google Cloud Storage bucket, filed under the pull request it proves (`<pr-number>/...`),
instead of into git, whose history never shrinks (ADR-1234 D1). This folder is that bucket and the
one account that uploads to it, written down; **the owner applies it by hand**. The gate's
check:owner-applies fails a branch that changes it (Markdown aside) unless an open increment waits
on the owner with a note naming this folder (the owner's factory plugin micks-dev-loop lists the
folders, in src/owner-applies.mjs).

| File | What it makes |
| --- | --- |
| [`main.tf`](main.tf) | The bucket `<project>-evidence`, born with its cleanup policy; the service account `storytree-evidence`, with Object User on that bucket alone; and a budget that warns the owner when the bucket's month passes A$5. |

## The cleanup policy (ADR-1234 D2)

So the bucket cannot build up cost:

- **Every object is deleted 90 days after upload** (a lifecycle rule, `expire_days`). The arc-close
  sweep (ADR-1123, ADR-1127) deletes a closed arc's pull-request folders sooner.
- **Versioning is off and soft-delete retention is zero**, so a deleted or overwritten object stops
  costing at once (a new bucket otherwise keeps deleted objects, billed, for seven days).
- **Standard class, one region** (`AUSTRALIA-SOUTHEAST1`, the backup bucket's): no minimum storage
  duration, no retrieval fee, no copies in other regions.
- **Private**: public access prevention is enforced and access is uniform (no per-object grants). A
  link (`https://storage.cloud.google.com/<project>-evidence/<pr>/<file>`) opens for a signed-in
  account the project lets read it, the owner's; a session without that cannot open the evidence,
  which is accepted (D4).
- **A budget alert** (`monthly_budget_aud`, A$5) on the project, counting only cost labelled
  `storytree-use=evidence`, which the bucket carries. It emails the billing account's
  administrators at half and at all of the amount. A budget warns; it stops nothing.

## What the account can and cannot do (ADR-1234 D4)

`storytree-evidence` **can** create, list, read and delete objects in the evidence bucket: create to
upload, list and delete for the arc-close sweep. It **cannot** change the bucket, its lifecycle, its
labels or who may use it, touch any other bucket, or do anything else in the project: it has no role
on the project. Mint lanes use it by a key on the box (step 2). CI is not given it: CI keeps its own
screenshots as workflow artifacts, which expire on their own, and no CI job uploads evidence.

## What to run, in order

**1. Make the bucket, the account and the budget.** From this folder (`infra/evidence-bucket`),
signed in to Google as the project owner (`gcloud auth application-default login`):

```bash
PROJECT="$(gcloud config get-value project)"   # the cloud project's id
export TF_VAR_project_id="$PROJECT"
gcloud services enable cloudbilling.googleapis.com --project "$PROJECT"
terraform init -backend-config="bucket=$PROJECT-tfstate"
terraform plan     # expect 5 to add, 0 to change, 0 to destroy
terraform apply
```

The five are the bucket, the service account, its Object User binding on the bucket, the budget
API turned on in the project (it is left on if this is ever destroyed), and the budget. It keeps
its own state (`evidence-bucket-0.3`, beside ci-health's and website-publish's in the same bucket)
and changes nothing of theirs or 0.2's. The Cloud Billing API must be on before the plan: the budget
reads the project's billing account through it, and without it that comes back empty and the plan
fails with `Missing required argument` on `billing_account`. `PROJECT` is the cloud project's id, as in
[infra/ci-health](../ci-health/README.md#applying-it). A budget refused for a quota project means
the login's application-default credentials have none: `gcloud auth application-default
set-quota-project "$PROJECT"`, then apply again.

**2. Give the Mint box the account's key.** On the box, with the owner's gcloud login (it has one).
The box's gcloud is `~/google-cloud-sdk/bin/gcloud` and has no default project, so
`gcloud config get-value project` comes out empty there and the key would name
`storytree-evidence@.iam.gserviceaccount.com`: set `PROJECT` to the project's id as step 1 read it on
the laptop (`gcloud config get-value project` there):

```bash
PROJECT="<the project's id, as read on the laptop>"
install -d -m 700 ~/.storytree/evidence
~/google-cloud-sdk/bin/gcloud iam service-accounts keys create ~/.storytree/evidence/uploader.json \
  --iam-account="storytree-evidence@$PROJECT.iam.gserviceaccount.com"
chmod 600 ~/.storytree/evidence/uploader.json
```

The key never enters a repository. Lanes upload with `gcloud --credential-file-override` naming it,
as the library backups do with theirs (infra/library-host/host.mjs).

## How to verify it worked

Read-only, with the owner's login:

```bash
gcloud storage buckets describe "gs://$PROJECT-evidence" \
  --format="yaml(lifecycle_config,soft_delete_policy,versioning_enabled,public_access_prevention,uniform_bucket_level_access,storage_class,location,labels)"
# lifecycle_config: one rule, action Delete, condition age 90
# soft_delete_policy.retentionDurationSeconds: '0'; versioning_enabled absent or false
# public_access_prevention: enforced; uniform_bucket_level_access: true; storage_class: STANDARD
gcloud storage buckets get-iam-policy "gs://$PROJECT-evidence" --format=json
# storytree-evidence appears once, as roles/storage.objectUser
gcloud projects get-iam-policy "$PROJECT" --format=json | grep -c storytree-evidence
# 0: no role on the project
```

On the box, with `PROJECT` set as in step 2, the key uploads and the object can be removed again:

```bash
echo ok > /tmp/evidence-check.txt
~/google-cloud-sdk/bin/gcloud --credential-file-override="$HOME/.storytree/evidence/uploader.json" \
  storage cp /tmp/evidence-check.txt "gs://$PROJECT-evidence/0/evidence-check.txt"
~/google-cloud-sdk/bin/gcloud --credential-file-override="$HOME/.storytree/evidence/uploader.json" \
  storage rm "gs://$PROJECT-evidence/0/evidence-check.txt"
```
