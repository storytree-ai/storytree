# The website's Google identity for publishing (arc_a5b72bd96bd9): the publish job in
# .github/workflows/website.yml signs in with it, keylessly, and reads the here.now key from
# Secret Manager. Authored here, applied by the owner by hand (README.md): an agent holds no
# credentials for any of it.
#
# GitHub's OIDC token -> the workload identity pool `github-actions` -> infra/ci-health's provider
# `storytree-0-3-main`, which accepts ONLY this repository's token on main -> the service account
# storytree-website-publish -> read access to ONE secret, heredotnow_api_key.
#
# The provider is reused, not made again: its condition is already exactly this repository on
# main, which is what publishing needs. So infra/ci-health must be applied first; the data source
# below fails the plan clearly if it is not.
#
# Its own state (prefix website-publish-0.3), beside ci-health's, so applying this never touches
# ci-health's or 0.2's resources.

terraform {
  required_version = ">= 1.5"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
  backend "gcs" {
    bucket = "storytree-498613-tfstate"
    prefix = "website-publish-0.3"
  }
}

variable "project_id" {
  type    = string
  default = "storytree-498613"
}

variable "secret_id" {
  type        = string
  default     = "heredotnow_api_key"
  description = "The Secret Manager secret holding the here.now API key (created by the owner)."
}

# storytree-ai/storytree, by its numeric id: `gh api repos/storytree-ai/storytree --jq .id`. A
# name can be taken again by another repository after a rename or a deletion; the id cannot.
variable "repository_id" {
  type    = string
  default = "1388231144"
}

provider "google" {
  project = var.project_id
}

data "google_project" "this" {}

locals {
  pool = "projects/${data.google_project.this.number}/locations/global/workloadIdentityPools/github-actions"
}

# ── Who may sign in: this repository's workflows, on main (infra/ci-health's provider) ─────────

data "google_iam_workload_identity_pool_provider" "main" {
  workload_identity_pool_id          = "github-actions"
  workload_identity_pool_provider_id = "storytree-0-3-main"
}

# ── Who it signs in as ────────────────────────────────────────────────────────────────────────

resource "google_service_account" "website_publish" {
  account_id   = "storytree-website-publish"
  display_name = "storytree 0.3 CI: reads the here.now key to publish the website (keyless)"
}

# Read the one secret, and nothing else: a binding on the secret, not on the project.
resource "google_secret_manager_secret_iam_member" "website_publish_key" {
  project   = var.project_id
  secret_id = var.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.website_publish.email}"
}

# Tokens from this repository may act as the account. As in infra/ci-health, the principal set is
# keyed on repository_id, which only the main-only provider above maps, so a token can match only
# through it, and so only on main. Any workflow of this repository on main can therefore act as
# it, as with ci-health's account; what it can reach is the one secret.
resource "google_service_account_iam_member" "website_publish_workload_identity" {
  service_account_id = google_service_account.website_publish.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${local.pool}/attribute.repository_id/${var.repository_id}"
}

# ── The repository variables (README.md step 2) ──────────────────────────────────────────────

output "WEBSITE_WIF_PROVIDER" {
  value = data.google_iam_workload_identity_pool_provider.main.name
}

output "WEBSITE_SERVICE_ACCOUNT" {
  value = google_service_account.website_publish.email
}
