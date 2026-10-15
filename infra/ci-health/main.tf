# storytree 0.3's sign-in route for GitHub Actions on main, and the account CI's health role is
# named after. Authored here, applied by the owner by hand (README.md): an agent holds no
# credentials for any of it.
#
# The route: GitHub's OIDC token -> the workload identity pool storytree 0.2 already has
# (`github-actions`, 0.2's infra/ci-presence.tf) -> a provider of 0.3's own, which accepts ONLY this
# repository's token on main. infra/website-publish signs in through it.
#
# The own-health job once signed in through it as storytree-ci-health to record health on Cloud SQL.
# Since the library moved to the Mint box (ADR-0928) it records there over Tailscale with a password,
# and the Cloud SQL instance storytree used was deleted on 2026-10-15, so the account holds no role
# and nothing may act as it. It is kept because the box's CI role carries its database name
# (infra/library-host/README.md); grants.sql is what that role may do in the library.
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

# storytree-ai/storytree, by its numeric id: `gh api repos/storytree-ai/storytree --jq .id`. A
# name can be taken again by another repository after a rename or a deletion; the id cannot.
variable "repository_id" {
  type    = string
  default = "1388231144"
}

provider "google" {
  project = var.project_id
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

# ── The account CI's health role is named after ─────────────────────────────────────────────

resource "google_service_account" "ci_health" {
  account_id   = "storytree-ci-health"
  display_name = "storytree 0.3 CI: records own health in the library (keyless)"
}

output "WIF_PROVIDER" {
  value = google_iam_workload_identity_pool_provider.main.name
}
