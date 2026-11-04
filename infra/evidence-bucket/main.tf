# The bucket evidence media goes to instead of git (ADR-1234 D1), born with its cleanup policy
# (D2), and the one account Mint lanes upload with (D4). Authored here, applied by the owner by hand
# (README.md): an agent holds no credentials for any of it.
#
# The cleanup policy, so it cannot build up cost: every object is deleted 90 days after upload;
# versioning is off and soft-delete retention is zero, so a deleted object stops costing at once;
# Standard class in one region (the backup bucket's). A budget on the project warns the owner when
# this bucket's month passes A$5.
#
# Its own state (prefix evidence-bucket-0.3), beside ci-health's and website-publish's, so applying
# this never touches theirs or 0.2's resources.

terraform {
  required_version = ">= 1.5"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
  # The bucket is named after the cloud project, so it is given at init (README.md): a backend
  # takes no variables.
  backend "gcs" {
    prefix = "evidence-bucket-0.3"
  }
}

# The cloud project's id, given each run (README.md): -var or TF_VAR_project_id.
variable "project_id" {
  type = string
}

variable "region" {
  type        = string
  default     = "AUSTRALIA-SOUTHEAST1"
  description = "The bucket's one region: the backup bucket's."
}

variable "expire_days" {
  type        = number
  default     = 90
  description = "Days after upload at which an evidence object is deleted (ADR-1234 D2)."
}

variable "monthly_budget_aud" {
  type        = number
  default     = 5
  description = "The bucket's monthly cost, in Australian dollars, past which the owner is warned."
}

# The budget API is called on the owner's own login, which needs a quota project: this one.
provider "google" {
  project               = var.project_id
  billing_project       = var.project_id
  user_project_override = true
}

data "google_project" "this" {}

# ── The bucket ────────────────────────────────────────────────────────────────────────────────

resource "google_storage_bucket" "evidence" {
  name          = "${var.project_id}-evidence"
  location      = var.region
  storage_class = "STANDARD"

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  # Never destroyed with objects in it by a plan: emptying it is a deliberate act.
  force_destroy = false

  # The budget below reads this bucket's cost by this label.
  labels = {
    storytree-use = "evidence"
  }

  versioning {
    enabled = false
  }

  # A deleted object is gone at once, never kept (and billed) for the default seven days.
  soft_delete_policy {
    retention_duration_seconds = 0
  }

  lifecycle_rule {
    condition {
      age = var.expire_days
    }
    action {
      type = "Delete"
    }
  }
}

# ── Who uploads: one account, on this bucket alone ────────────────────────────────────────────

resource "google_service_account" "evidence" {
  account_id   = "storytree-evidence"
  display_name = "storytree 0.3 lanes: write evidence objects to the evidence bucket, nothing else"
}

# Object User on this bucket, and no role on the project or any other bucket: create objects, and
# list and delete them so the arc-close sweep can remove a closed arc's pull-request folders sooner
# than the 90 days (ADR-1234 D2). It cannot change the bucket, its policy or its access.
resource "google_storage_bucket_iam_member" "evidence_objects" {
  bucket = google_storage_bucket.evidence.name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${google_service_account.evidence.email}"
}

# ── The budget alert ──────────────────────────────────────────────────────────────────────────

resource "google_project_service" "budgets" {
  service            = "billingbudgets.googleapis.com"
  disable_on_destroy = false
}

# Warns the billing account's administrators (the owner) by email at half and at all of the
# amount, counting only cost labelled as the evidence bucket's. A budget alerts; it caps nothing.
resource "google_billing_budget" "evidence" {
  billing_account = data.google_project.this.billing_account
  display_name    = "storytree evidence bucket, ${var.monthly_budget_aud} AUD a month"

  budget_filter {
    projects = ["projects/${data.google_project.this.number}"]
    labels = {
      storytree-use = "evidence"
    }
    calendar_period = "MONTH"
  }

  amount {
    specified_amount {
      currency_code = "AUD"
      units         = tostring(var.monthly_budget_aud)
    }
  }

  threshold_rules {
    threshold_percent = 0.5
  }
  threshold_rules {
    threshold_percent = 1.0
  }

  depends_on = [google_project_service.budgets]
}

output "EVIDENCE_BUCKET" {
  value = google_storage_bucket.evidence.name
}

output "EVIDENCE_SERVICE_ACCOUNT" {
  value = google_service_account.evidence.email
}
