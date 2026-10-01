# The website's identity for publishing

After each merge that changes the website, the **Publish website** workflow
(`.github/workflows/website.yml`) builds `packages/website` and uploads it to
https://crisp-globe-bf6v.here.now. The upload needs the here.now API key, which lives in Secret
Manager as `heredotnow_api_key` in `storytree-498613`. To read it the workflow needs a Google
identity of its own. This folder is that identity, written down; **the owner applies it by hand**.
Until the last step is done, the publish step says "Website publishing skipped: no here.now key"
and names the two repository variables below; the build and its tests still run.

| File | What it makes |
| --- | --- |
| [`main.tf`](main.tf) | The service account `storytree-website-publish`, with Secret Accessor on the one secret `heredotnow_api_key` (a binding on that secret, not on the project), and leave for this repository's workflows on main to act as it. |

It makes no sign-in route of its own: it reuses [infra/ci-health](../ci-health/README.md)'s
`storytree-0-3-main`, whose condition is already exactly "this repository, only on main"
(`assertion.repository_id == '1388231144' && assertion.ref == 'refs/heads/main'`). So ci-health must
be applied first; it is.

## What the account can and cannot do

It **can** read the versions of the secret `heredotnow_api_key`. It **cannot** read any other
secret, change or delete that one, or touch anything else in the project. Any workflow of this
repository running on main can act as it (the same reach as ci-health's account); a pull request's
run, a fork, or another repository cannot, because the sign-in route refuses them before any
account is in question.

The workflow puts the key into the publish step's environment only, masked (`::add-mask::`) before
anything else reads it; the uploader never logs it.

## What to run, in order

Everything from this folder (`infra/website-publish`), signed in to Google as the project owner
(`gcloud auth application-default login`).

**1. Create the identity.**

```bash
terraform init
terraform plan     # expect 3 to add, 0 to change, 0 to destroy
terraform apply
```

The three are the service account, its Secret Accessor binding on `heredotnow_api_key`, and the
binding that lets this repository's main-only sign-in act as it. It keeps its own state
(`website-publish-0.3`, beside ci-health's `ci-health-0.3` in the same bucket) and changes nothing
of ci-health's or 0.2's. A plan that fails reading `storytree-0-3-main` means ci-health's provider
is missing: apply [infra/ci-health](../ci-health/README.md) step 1 first.

**2. Turn it on.** Set the two repository variables from Terraform's outputs (Settings > Secrets and
variables > Actions > Variables, or with `gh`):

```bash
gh variable set WEBSITE_WIF_PROVIDER    --repo storytree-ai/storytree --body "$(terraform output -raw WEBSITE_WIF_PROVIDER)"
gh variable set WEBSITE_SERVICE_ACCOUNT --repo storytree-ai/storytree --body "$(terraform output -raw WEBSITE_SERVICE_ACCOUNT)"
```

`WEBSITE_WIF_PROVIDER` comes out the same as the existing `HEALTH_WIF_PROVIDER`, because the route is
shared. They are variables, not secrets: neither is a credential. The sign-in itself is GitHub's
short-lived token, exchanged each run.

**3. Publish once.** `gh workflow run website.yml --repo storytree-ai/storytree --ref main` (or
Actions > Publish website > Run workflow), and watch it: `gh run watch --repo storytree-ai/storytree`.

## How to verify it worked

1. The run's **Sign in to Google as the website's publishing identity** step runs (it is skipped
   while the variables are unset).
2. The **Publish, or clearly skip without a publishing identity** step logs
   `Website published: https://crisp-globe-bf6v.here.now/` instead of the skip line.
3. https://crisp-globe-bf6v.here.now serves the 0.3 site: the pitch, the install one-liner and the
   project forest drawn from 0.3's own library.

If it fails: a red sign-in step means step 2's variables do not match Terraform's outputs, or the
route refused the run (a run not on main always is). `PERMISSION_DENIED` from
`gcloud secrets versions access` means the Secret Accessor binding is missing (step 1). `Website
publish manifest failed (HTTP 401)` or `403` means here.now refused the key: put a key for the
account that owns `crisp-globe-bf6v` as a new version of the secret and run step 3 again.

## Undoing it

Unset the two variables (the workflow goes back to the skip), then `terraform destroy` here, which
removes the account and its two bindings and leaves the secret and ci-health's route alone.
