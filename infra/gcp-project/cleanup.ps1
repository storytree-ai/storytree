<#
.SYNOPSIS
  Tidies the storytree Google Cloud project: deletes 0.2's leftover resources and turns off the
  APIs 0.3 does not use, against an explicit keep-list.

.DESCRIPTION
  Windows PowerShell 5.1. A dry run unless -Apply is given: the dry run only reads (lists what is
  there) and prints each step it would take. With -Apply it asks you to type the project id, then
  runs the steps in this order:
    1. delete the Artifact Registry repositories named below,
    2. delete the buckets named below, with everything in them,
    3. delete the two disabled 0.2 deployer service accounts (refused before 2026-10-31),
    4. turn off the APIs named below, one at a time and without --force, so Google refuses any
       API that something still enabled depends on, instead of turning that off too.
  Only names written out in this file are touched: nothing is chosen by pattern. Every list is
  checked against the keep-lists before anything runs. It is safe to run again: what is already
  gone is reported and skipped.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File infra\gcp-project\cleanup.ps1 -Project <project-id>
  powershell -ExecutionPolicy Bypass -File infra\gcp-project\cleanup.ps1 -Project <project-id> -Apply
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Project,
  [switch]$Apply
)

$ErrorActionPreference = 'Continue'

# --- What stays ------------------------------------------------------------------------------
# APIs 0.3 uses, plus the ones gcloud itself needs to make these changes. sts is GitHub's sign-in
# to the project (workload identity federation), used by infra/ci-health and infra/website-publish.
$KeepApis = @(
  'storage.googleapis.com', 'storage-api.googleapis.com', 'storage-component.googleapis.com',
  'secretmanager.googleapis.com',
  'iam.googleapis.com', 'iamcredentials.googleapis.com', 'sts.googleapis.com',
  'bigquery.googleapis.com', 'bigquerystorage.googleapis.com', 'bigqueryconnection.googleapis.com',
  'bigquerydatapolicy.googleapis.com', 'bigquerydatatransfer.googleapis.com',
  'bigquerymigration.googleapis.com', 'bigqueryreservation.googleapis.com',
  'billingbudgets.googleapis.com', 'logging.googleapis.com', 'monitoring.googleapis.com',
  'pubsub.googleapis.com',
  'cloudresourcemanager.googleapis.com', 'serviceusage.googleapis.com', 'servicemanagement.googleapis.com'
)
# storytree-dist: release downloads. library-backups: the library's backups and the archive/
# export of 0.2's database. tfstate: Terraform state of infra/ci-health and infra/website-publish.
$KeepBuckets = @(
  'storytree-dist',
  "$Project-library-backups",
  "$Project-tfstate"
)

# --- What goes -------------------------------------------------------------------------------
$DeleteRepos = @(
  @{ Name = 'cloud-run-source-deploy'; Location = 'australia-southeast1' },
  @{ Name = 'gcf-artifacts'; Location = 'australia-southeast1' }
)
$DeleteBuckets = @(
  'gcf-v2-sources-<number>-australia-southeast1',
  "run-sources-$Project-australia-southeast1",
  "$Project-studio-cd-build",
  "$Project-web-editor-cd-build",
  "${Project}_cloudbuild"
)
$DeleteServiceAccounts = @(
  "storytree-studio-deployer@$Project.iam.gserviceaccount.com",
  "storytree-web-editor-deployer@$Project.iam.gserviceaccount.com"
)
$ServiceAccountsNotBefore = [datetime]'2026-10-31'

$MapsApis = @(
  'addressvalidation', 'aerialview', 'airquality', 'areainsights', 'directions-backend',
  'distance-matrix-backend', 'elevation-backend', 'geocoding-backend', 'geolocation',
  'mapmanagement', 'maps-android-backend', 'maps-backend', 'maps-embed-backend', 'maps-ios-backend',
  'mapsandroid', 'mapsios', 'mapsplatformdatasets', 'mapstools', 'places-backend', 'places',
  'placewidgets', 'pollen', 'roads', 'routeoptimization', 'routes', 'solar', 'static-maps-backend',
  'street-view-image-backend', 'streetviewpublish', 'tile', 'timezone-backend', 'weather'
) | ForEach-Object { "$_.googleapis.com" }
$OtherApis = @(
  'generativelanguage', 'cloudaicompanion', 'geminicloudassist', 'cloudbuild', 'run',
  'cloudfunctions', 'cloudscheduler', 'artifactregistry', 'containerregistry', 'dataform',
  'dataplex', 'datastore', 'sqladmin'
) | ForEach-Object { "$_.googleapis.com" }
$DisableApis = @($MapsApis) + @($OtherApis)

# --- Checks before anything runs -------------------------------------------------------------
function Stop-Run([string]$Why) { Write-Output "STOPPED: $Why"; exit 1 }

$clash = @($DisableApis | Where-Object { $KeepApis -contains $_ })
if ($clash.Count -gt 0) { Stop-Run "these APIs are on both the keep-list and the disable list: $($clash -join ', ')" }
$clash = @($DeleteBuckets | Where-Object { $KeepBuckets -contains $_ })
if ($clash.Count -gt 0) { Stop-Run "these buckets are on both the keep-list and the delete list: $($clash -join ', ')" }

$gcloudCommand = Get-Command gcloud.cmd -ErrorAction SilentlyContinue
if ($null -eq $gcloudCommand) { Stop-Run 'gcloud.cmd is not on PATH (install the Google Cloud SDK and sign in).' }
$Gcloud = $gcloudCommand.Source

# Runs gcloud with --quiet (no prompts) and returns its standard output; $LASTEXITCODE says how it went.
function Invoke-Gcloud([string[]]$Arguments) {
  & $Gcloud @Arguments --quiet
}

$account = Invoke-Gcloud @('config', 'get-value', 'account')
# Cloud Functions names its source bucket after the project's number, which is looked up here.
$number = Invoke-Gcloud @('projects', 'describe', $Project, '--format=value(projectNumber)')
if ($LASTEXITCODE -ne 0 -or -not $number) { Stop-Run "could not read the project number of $Project (are you signed in, with access to it?)." }
$DeleteBuckets = @($DeleteBuckets | ForEach-Object { $_.Replace('<number>', "$number".Trim()) })
Write-Output "Project: $Project    Signed in as: $account"
if ($Apply) { Write-Output 'Mode: APPLY (changes will be made)' } else { Write-Output 'Mode: DRY RUN (nothing is changed; add -Apply to make the changes)' }

$enabled = @(Invoke-Gcloud @('services', 'list', '--enabled', '--project', $Project, '--format=value(config.name)'))
if ($LASTEXITCODE -ne 0 -or $enabled.Count -eq 0) { Stop-Run "could not list the enabled APIs of $Project (are you signed in, with access to it?)." }
$buckets = @(Invoke-Gcloud @('storage', 'buckets', 'list', '--project', $Project, '--format=value(name)'))
if ($LASTEXITCODE -ne 0) { Stop-Run "could not list the buckets of $Project." }
$accounts = @(Invoke-Gcloud @('iam', 'service-accounts', 'list', '--project', $Project, '--format=csv[no-heading](email,disabled)'))
if ($LASTEXITCODE -ne 0) { Stop-Run "could not list the service accounts of $Project." }
$repos = @()
if ($enabled -contains 'artifactregistry.googleapis.com') {
  # JSON, because the plain value() format shortens each name to its last part.
  $repoJson = @(Invoke-Gcloud @('artifacts', 'repositories', 'list', '--project', $Project, '--format=json(name)'))
  if ($LASTEXITCODE -ne 0) { Stop-Run "could not list the Artifact Registry repositories of $Project." }
  # A list that cannot be read stops the run: reading it as empty would turn the API off with
  # the repositories still in it.
  try { $parsed = ($repoJson -join "`n") | ConvertFrom-Json -ErrorAction Stop }
  catch { Stop-Run "could not read the Artifact Registry repository list of $Project." }
  $repos = @($parsed | ForEach-Object { $_.name } | Where-Object { $_ })
}

if ($Apply) {
  $typed = Read-Host "Type the project id ($Project) to make these changes"
  if ($typed -ne $Project) { Stop-Run 'the typed project id did not match; nothing was changed.' }
}

$failures = New-Object System.Collections.Generic.List[string]
# Prints what it would do (dry run) or does it; sets $script:StepOk to say whether it worked.
function Step([string]$What, [string[]]$Arguments) {
  $script:StepOk = $true
  if (-not $Apply) { Write-Output "WOULD  $What"; return }
  Invoke-Gcloud $Arguments | Out-Null
  if ($LASTEXITCODE -eq 0) { Write-Output "DONE   $What"; return }
  Write-Output "FAILED $What (gcloud exit $LASTEXITCODE)"
  $failures.Add($What)
  $script:StepOk = $false
}

# --- 1. Artifact Registry repositories -------------------------------------------------------
Write-Output ''
Write-Output '1. Artifact Registry repositories'
$reposLeft = $false
foreach ($repo in $DeleteRepos) {
  $full = "projects/$Project/locations/$($repo.Location)/repositories/$($repo.Name)"
  if ($repos -notcontains $full) { Write-Output "SKIP   $($repo.Name) ($($repo.Location)): not there"; continue }
  Step "delete repository $($repo.Name) ($($repo.Location))" @('artifacts', 'repositories', 'delete', $repo.Name, '--location', $repo.Location, '--project', $Project)
  if (-not $script:StepOk) { $reposLeft = $true }
}

# --- 2. Buckets --------------------------------------------------------------------------------
Write-Output ''
Write-Output '2. Buckets (each with everything in it)'
foreach ($bucket in $DeleteBuckets) {
  if ($buckets -notcontains $bucket) { Write-Output "SKIP   gs://${bucket}: not there"; continue }
  Step "delete gs://$bucket and its contents" @('storage', 'rm', '--recursive', "gs://$bucket")
}
foreach ($bucket in $buckets) {
  if (($DeleteBuckets -notcontains $bucket) -and ($KeepBuckets -notcontains $bucket)) { Write-Output "LEAVE  gs://${bucket}: on neither list" }
}

# --- 3. Service accounts -----------------------------------------------------------------------
Write-Output ''
Write-Output '3. 0.2 deployer service accounts'
foreach ($email in $DeleteServiceAccounts) {
  $row = @($accounts | Where-Object { $_ -like "$email,*" })
  if ($row.Count -eq 0) { Write-Output "SKIP   ${email}: not there"; continue }
  if ($row[0] -notlike '*,True') { Write-Output "REFUSE ${email}: it is not disabled, so something may still use it"; $failures.Add("delete $email"); continue }
  if ((Get-Date) -lt $ServiceAccountsNotBefore) { Write-Output "WAIT   ${email}: not before $($ServiceAccountsNotBefore.ToString('yyyy-MM-dd')); run this again then"; continue }
  Step "delete service account $email" @('iam', 'service-accounts', 'delete', $email, '--project', $Project)
}

# --- 4. APIs -----------------------------------------------------------------------------------
Write-Output ''
Write-Output '4. APIs to turn off'
$toDisable = @($DisableApis | Where-Object { $enabled -contains $_ })
foreach ($api in $DisableApis) { if ($enabled -notcontains $api) { Write-Output "SKIP   ${api}: already off" } }
if ($reposLeft) {
  Write-Output 'KEEP   artifactregistry.googleapis.com: a repository could not be deleted, so the API stays on this run'
  $toDisable = @($toDisable | Where-Object { $_ -ne 'artifactregistry.googleapis.com' })
}
if (-not $Apply) {
  foreach ($api in $toDisable) { Write-Output "WOULD  turn off $api" }
} else {
  # One at a time, without --force. An API another enabled API depends on is refused; it is tried
  # again after the rest, until a pass turns nothing off.
  $pending = $toDisable
  do {
    $stillPending = @()
    foreach ($api in $pending) {
      Invoke-Gcloud @('services', 'disable', $api, '--project', $Project) | Out-Null
      if ($LASTEXITCODE -eq 0) { Write-Output "DONE   turn off $api" } else { $stillPending += $api }
    }
    $progress = $stillPending.Count -lt $pending.Count
    $pending = $stillPending
  } while ($progress -and $pending.Count -gt 0)
  foreach ($api in $pending) { Write-Output "FAILED turn off $api (Google refused it, as gcloud says above: an enabled API depends on it, or it was used in the last 30 days; run this again later)"; $failures.Add("turn off $api") }
}
foreach ($api in $enabled) {
  if (($DisableApis -notcontains $api) -and ($KeepApis -notcontains $api)) { Write-Output "LEAVE  ${api}: on neither list" }
}

Write-Output ''
if ($failures.Count -gt 0) {
  Write-Output "Finished with $($failures.Count) step(s) not done:"
  foreach ($f in $failures) { Write-Output "  - $f" }
  exit 2
}
if ($Apply) { Write-Output 'Finished: every step done.' } else { Write-Output 'Dry run finished: nothing was changed.' }
