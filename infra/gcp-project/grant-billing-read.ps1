<#
.SYNOPSIS
  Gives the Mint box's service account read access to the billing export, for the twice-daily
  spend reading, and nothing else.

.DESCRIPTION
  Windows PowerShell 5.1. A dry run unless -Apply is given: the dry run only reads (the service
  account, the dataset's access list and the project's IAM policy) and prints each grant it would
  make. With -Apply it asks you to type the project id, then makes the two grants written out
  below, both additive (nothing already granted is removed or changed):
    1. roles/bigquery.dataViewer on the dataset billing_export only (a BigQuery GRANT statement,
       so no other dataset in the project is readable),
    2. roles/bigquery.jobUser on the project (to run the reading's one query).
  Then it reads both back. It is safe to run again: a grant already there is reported and skipped.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File infra\gcp-project\grant-billing-read.ps1
  powershell -ExecutionPolicy Bypass -File infra\gcp-project\grant-billing-read.ps1 -Apply
#>
[CmdletBinding()]
param(
  [string]$Project = 'storytree-498613',
  [switch]$Apply
)

$ErrorActionPreference = 'Continue'

# --- The two grants, and nothing else --------------------------------------------------------
$Dataset = 'billing_export'
$Account = "storytree-mint@$Project.iam.gserviceaccount.com"
$Member = "serviceAccount:$Account"
$DatasetRole = 'roles/bigquery.dataViewer'
$ProjectRole = 'roles/bigquery.jobUser'

function Stop-Run([string]$Why) { Write-Output "STOPPED: $Why"; exit 1 }

$gcloudCommand = Get-Command gcloud.cmd -ErrorAction SilentlyContinue
if ($null -eq $gcloudCommand) { Stop-Run 'gcloud.cmd is not on PATH (install the Google Cloud SDK and sign in).' }
$Gcloud = $gcloudCommand.Source
$bqCommand = Get-Command bq.cmd -ErrorAction SilentlyContinue
if ($null -eq $bqCommand) { Stop-Run 'bq.cmd is not on PATH (it comes with the Google Cloud SDK).' }
$Bq = $bqCommand.Source

# Runs gcloud with --quiet (no prompts) and returns its standard output; $LASTEXITCODE says how it went.
function Invoke-Gcloud([string[]]$Arguments) {
  & $Gcloud @Arguments --quiet
}
# Runs bq without prompts; $LASTEXITCODE says how it went.
function Invoke-Bq([string[]]$Arguments) {
  & $Bq --quiet --headless @Arguments
}

# Whether the dataset's access list gives the account read access, as a READER entry or by role.
function Test-DatasetGrant {
  $json = @(Invoke-Bq @('show', '--format=json', "${Project}:$Dataset"))
  if ($LASTEXITCODE -ne 0) { Stop-Run "could not read the dataset ${Project}:$Dataset (are you signed in, with access to it?)." }
  try { $info = ($json -join "`n") | ConvertFrom-Json -ErrorAction Stop }
  catch { Stop-Run "could not read the access list of ${Project}:$Dataset." }
  $script:DatasetLocation = $info.location
  if (-not $script:DatasetLocation) { Stop-Run "could not read the location of ${Project}:$Dataset." }
  $entries = @($info.access | Where-Object { $_.userByEmail -eq $Account -or $_.iamMember -eq $Member })
  return @($entries | Where-Object { $_.role -eq 'READER' -or $_.role -eq $DatasetRole }).Count -gt 0
}

# Whether the project's IAM policy gives the account the job user role.
function Test-ProjectGrant {
  $json = @(Invoke-Gcloud @('projects', 'get-iam-policy', $Project, '--format=json'))
  if ($LASTEXITCODE -ne 0) { Stop-Run "could not read the IAM policy of $Project." }
  try { $policy = ($json -join "`n") | ConvertFrom-Json -ErrorAction Stop }
  catch { Stop-Run "could not read the IAM policy of $Project." }
  return @($policy.bindings | Where-Object { $_.role -eq $ProjectRole -and @($_.members) -contains $Member }).Count -gt 0
}

$signedIn = Invoke-Gcloud @('config', 'get-value', 'account')
Write-Output "Project: $Project    Signed in as: $signedIn"
if ($Apply) { Write-Output 'Mode: APPLY (the grants will be made)' } else { Write-Output 'Mode: DRY RUN (nothing is changed; add -Apply to make the grants)' }

Invoke-Gcloud @('iam', 'service-accounts', 'describe', $Account, '--project', $Project, '--format=value(email)') | Out-Null
if ($LASTEXITCODE -ne 0) { Stop-Run "could not find the service account $Account in $Project." }
$hasDataset = Test-DatasetGrant
$hasProject = Test-ProjectGrant

if ($Apply -and -not ($hasDataset -and $hasProject)) {
  $typed = Read-Host "Type the project id ($Project) to make these grants"
  if ($typed -ne $Project) { Stop-Run 'the typed project id did not match; nothing was changed.' }
}

$failures = New-Object System.Collections.Generic.List[string]
Write-Output ''

# --- 1. Read the billing export dataset --------------------------------------------------------
$what = "grant $DatasetRole on dataset ${Project}:$Dataset to $Account"
if ($hasDataset) { Write-Output "SKIP   ${what}: already there" }
elseif (-not $Apply) { Write-Output "WOULD  $what" }
else {
  $grant = "GRANT ``$DatasetRole`` ON SCHEMA ``$Project.$Dataset`` TO '$Member'"
  Invoke-Bq @('query', "--project_id=$Project", "--location=$script:DatasetLocation", '--use_legacy_sql=false', $grant) | Out-Null
  if ($LASTEXITCODE -eq 0) { Write-Output "DONE   $what" } else { Write-Output "FAILED $what (bq exit $LASTEXITCODE)"; $failures.Add($what) }
}

# --- 2. Run query jobs in the project ----------------------------------------------------------
$what = "grant $ProjectRole on project $Project to $Account"
if ($hasProject) { Write-Output "SKIP   ${what}: already there" }
elseif (-not $Apply) { Write-Output "WOULD  $what" }
else {
  Invoke-Gcloud @('projects', 'add-iam-policy-binding', $Project, "--member=$Member", "--role=$ProjectRole", '--condition=None') | Out-Null
  if ($LASTEXITCODE -eq 0) { Write-Output "DONE   $what" } else { Write-Output "FAILED $what (gcloud exit $LASTEXITCODE)"; $failures.Add($what) }
}

# --- Read both back ----------------------------------------------------------------------------
if ($Apply) {
  Write-Output ''
  if (Test-DatasetGrant) { Write-Output "CHECK  dataset ${Project}:$Dataset lets $Account read it" } else { Write-Output "FAILED dataset ${Project}:$Dataset does not yet show the grant"; $failures.Add('read back the dataset grant') }
  if (Test-ProjectGrant) { Write-Output "CHECK  project $Project gives $Account $ProjectRole" } else { Write-Output "FAILED project $Project does not yet show $ProjectRole"; $failures.Add('read back the project grant') }
}

Write-Output ''
if ($failures.Count -gt 0) {
  Write-Output "Finished with $($failures.Count) step(s) not done:"
  foreach ($f in $failures) { Write-Output "  - $f" }
  exit 2
}
if ($Apply) { Write-Output 'Finished: both grants are in place.' } else { Write-Output 'Dry run finished: nothing was changed.' }
