# CI's Google identity for recording storytree 0.3's own health (ADR-0744 D3-D4): the
# `record own health` job in .github/workflows/own-health.yml signs in with it, keylessly, and
# records each contract's verified health in the library on Cloud SQL. Authored here, applied by
# the owner by hand (README.md): an agent holds no credentials for any of it.
#
# GitHub's OIDC token -> the workload identity pool storytree 0.2 already has (`github-actions`,
# 0.2's infra/ci-presence.tf) -> a provider of 0.3's own, which accepts ONLY this repository's
# token on main -> the service account storytree-ci-health -> the Cloud SQL connector's IAM
# database sign-in. What that account may do inside the library is grants.sql.
#
# Its own state (prefix ci-health-0.3), in the bucket 0.2's infra already uses, so applying this
# never touches 0.2's resources.

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
    prefix = "ci-health-0.3"
  }
}

variable "project_id" {
  type    = string
  default = "storytree-498613"
}

variable "region" {
  type    = string
  default = "australia-southeast1"
}

variable "instance" {
  type        = string
  default     = "storytree-pg"
  description = "The Cloud SQL instance the library is on (its id, not its connection name)."
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

# ── Who may sign in: this repository's workflows, on main ─────────────────────────────────────

# A provider of its own in 0.2's pool: 0.2's provider accepts only 0.2's repository. Its condition
# is what restricts the sign-in to main: a pull request's run carries refs/pull/<n>/merge and is
# refused here, before any service account is in question.
resource "google_iam_workload_identity_pool_provider" "main" {
  workload_identity_pool_id          = "github-actions"
  workload_identity_pool_provider_id = "storytree-0-3-main"
  display_name                       = "storytree 0.3, main only"
  description                        = "GitHub Actions OIDC for storytree-ai/storytree on main (own health, ADR-0744)"

  attribute_mapping = {
    "google.subject"          = "assertion.sub"
    "attribute.repository_id" = "assertion.repository_id"
    "attribute.ref"           = "assertion.ref"
  }
  attribute_condition = "assertion.repository_id == '${var.repository_id}' && assertion.ref == 'refs/heads/main'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

# ── Who it signs in as ────────────────────────────────────────────────────────────────────────

resource "google_service_account" "ci_health" {
  account_id   = "storytree-ci-health"
  display_name = "storytree 0.3 CI: records own health in the library (keyless)"
}

# Open a connection to the instance, and sign in to it as an IAM database user. Nothing broader:
# no admin, and no wake (the instance runs around the clock).
resource "google_project_iam_member" "ci_health_sql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.ci_health.email}"
}

resource "google_project_iam_member" "ci_health_sql_instance_user" {
  project = var.project_id
  role    = "roles/cloudsql.instanceUser"
  member  = "serviceAccount:${google_service_account.ci_health.email}"
}

# Tokens from this repository may act as the account. The principal set spans the whole pool, so
# it is keyed on repository_id, which only the provider above maps (0.2's maps the repository's
# name): its token can match only through that provider, and so only on main. A later provider in
# this pool that maps repository_id without a main-only condition would widen this; give it its
# own attribute name instead.
resource "google_service_account_iam_member" "ci_health_workload_identity" {
  service_account_id = google_service_account.ci_health.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${local.pool}/attribute.repository_id/${var.repository_id}"
}

# Its database user on the instance: the account's email without .gserviceaccount.com. A bare role
# until grants.sql runs.
resource "google_sql_user" "ci_health" {
  name     = trimsuffix(google_service_account.ci_health.email, ".gserviceaccount.com")
  instance = var.instance
  type     = "CLOUD_IAM_SERVICE_ACCOUNT"
}

# ── The repository variables (README.md step 4) ──────────────────────────────────────────────

output "HEALTH_WIF_PROVIDER" {
  value = google_iam_workload_identity_pool_provider.main.name
}

output "HEALTH_SERVICE_ACCOUNT" {
  value = google_service_account.ci_health.email
}

output "HEALTH_CLOUDSQL_INSTANCE" {
  value = "${var.project_id}:${var.region}:${var.instance}"
}

output "database_user" {
  value = google_sql_user.ci_health.name
}
