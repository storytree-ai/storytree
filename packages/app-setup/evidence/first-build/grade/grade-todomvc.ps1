<#
.SYNOPSIS
  Grades a TodoMVC app folder with the official tastejs/todomvc Cypress spec.

.DESCRIPTION
  One command: places a copy of the app where the suite expects it
  (todomvc\examples\<Framework>\), serves the suite's repo root with the
  suite's own static server (todomvc\tests\server.js, port 8000, the port
  cypress.config.js's baseUrl names), runs cypress\e2e\spec.cy.js headless
  with --env framework=<Framework>, prints a pass/fail table, then stops the
  server, removes the placed copy and stops any Cypress process the run left.

  The spec, its support files and cypress.config.js are used unmodified.
  The only run-time settings are: env framework=<Framework> (the switch the
  spec requires), video=false and screenshotOnRunFailure=false (no
  artefacts), and baseUrl only if -Port is not 8000.

  Framework 'vanillajs' (the default) is the suite's name for the plain-JS
  localStorage app: it is not in noLocalStorageCheck / noLocalStorageSpyCheck
  (so every localStorage assertion applies), it is in blurAfterType, it has
  no knownIssues entries, and it maps to the folder examples\vanillajs.

  First use installs what is missing: the sparse clone of the suite (pinned
  commit) and Cypress (pinned to the repo lockfile's 15.14.2) in this folder, so copy
  this folder somewhere outside the storytree repository before the first run.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File grade-todomvc.ps1 -AppPath C:\path\to\app
  powershell -ExecutionPolicy Bypass -File grade-todomvc.ps1 -AppPath C:\path\to\app -Runs 2

  Exit code: 0 when every test passed in every run, 1 when any failed,
  2 when the suite could not be run.
#>
param(
  [Parameter(Mandatory = $true)][string]$AppPath,
  [string]$Framework = 'vanillajs',
  [int]$Runs = 1,
  [int]$Port = 8000,
  [string]$Browser = 'electron',
  [string]$SuiteCommit = 'ff43b02e59dfa604386bb382034b2cd07c2bcd8a'
)

# Native tools (git, npm, npx) write progress to stderr; under 'Stop' PowerShell 5.1
# can turn that into terminating errors, so exit codes are checked explicitly instead.
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Suite = Join-Path $Here 'todomvc'
$Spec = Join-Path $Suite 'cypress\e2e\spec.cy.js'
$Helper = Join-Path $Here 'run-cypress.mjs'
$ResultsDir = Join-Path $Here 'results'
$env:CYPRESS_VERIFY_TIMEOUT = '180000'   # first launch on this machine takes > 30 s

function Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }

# ---- inputs --------------------------------------------------------------
$AppPath = (Resolve-Path -LiteralPath $AppPath -ErrorAction Stop).Path
if (-not (Test-Path -LiteralPath (Join-Path $AppPath 'index.html'))) {
  Write-Error "No index.html in $AppPath"; exit 2
}
if ($Framework -notmatch '^[A-Za-z0-9_.-]+$') { Write-Error "Bad framework name: $Framework"; exit 2 }
if (-not (Test-Path -LiteralPath $Helper)) { Write-Error "Missing helper $Helper"; exit 2 }

# ---- suite: sparse clone of tastejs/todomvc at a pinned commit -----------
if (-not (Test-Path -LiteralPath $Spec)) {
  Step "Fetching the official suite (tastejs/todomvc @ $($SuiteCommit.Substring(0,8)), sparse)"
  git clone --depth 1 --filter=blob:none --sparse --no-checkout https://github.com/tastejs/todomvc.git $Suite
  if ($LASTEXITCODE -ne 0) { Write-Error 'git clone failed'; exit 2 }
  git -C $Suite sparse-checkout set --no-cone /cypress/ /cypress.config.js /package.json /tests/
  git -C $Suite fetch --depth 1 origin $SuiteCommit
  git -C $Suite checkout --detach $SuiteCommit
  if ($LASTEXITCODE -ne 0) { Write-Error 'git checkout of the suite commit failed'; exit 2 }
}
$actualCommit = (git -C $Suite rev-parse HEAD).Trim()

# ---- Cypress + express, local to this folder ----------------------------
if (-not (Test-Path -LiteralPath (Join-Path $Here 'node_modules\cypress')) -or
    -not (Test-Path -LiteralPath (Join-Path $Here 'node_modules\express'))) {
  Step 'Installing Cypress and express locally (npm install)'
  # Kept as grader-package.json in the repository so no workspace tool takes it for a package.
  if (-not (Test-Path -LiteralPath (Join-Path $Here 'package.json'))) { Copy-Item (Join-Path $Here 'grader-package.json') (Join-Path $Here 'package.json') }
  Push-Location $Here
  try { npm install --no-audit --no-fund } finally { Pop-Location }
  if ($LASTEXITCODE -ne 0) { Write-Error 'npm install failed'; exit 2 }
}
Push-Location $Here
try {
  # npm may block Cypress's postinstall, so make sure the binary is present and verified.
  npx --no-install cypress verify *> $null
  if ($LASTEXITCODE -ne 0) {
    Step 'Installing / verifying the Cypress binary'
    npx --no-install cypress install
    npx --no-install cypress verify
    if ($LASTEXITCODE -ne 0) { Write-Error 'cypress verify failed'; exit 2 }
  }
} finally { Pop-Location }

# ---- port must be free, or we would test whatever else is serving it ----
$busy = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($busy) { Write-Error "Port $Port is already in use (PID $($busy[0].OwningProcess)); stop it first."; exit 2 }

# ---- place ---------------------------------------------------------------
$Target = Join-Path $Suite "examples\$Framework"
Step "Placing a copy of $AppPath at $Target"
if (Test-Path -LiteralPath $Target) { Remove-Item -LiteralPath $Target -Recurse -Force }
New-Item -ItemType Directory -Force -Path (Split-Path $Target) | Out-Null
Copy-Item -LiteralPath $AppPath -Destination $Target -Recurse -ErrorAction Stop

New-Item -ItemType Directory -Force -Path $ResultsDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$server = $null
$cypressBefore = @(Get-Process -Name Cypress -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
$runResults = @()
$runError = $false

try {
  # ---- serve -------------------------------------------------------------
  Step "Serving $Suite on http://localhost:$Port (todomvc\tests\server.js)"
  $env:PORT = "$Port"
  $server = Start-Process -FilePath 'node' -ArgumentList "`"$(Join-Path $Suite 'tests\server.js')`"" `
    -WorkingDirectory $Here -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $ResultsDir "server-$stamp.log") `
    -RedirectStandardError (Join-Path $ResultsDir "server-$stamp.err.log")
  $appUrl = "http://localhost:$Port/examples/$Framework/"
  $ready = $false
  for ($i = 0; $i -lt 60 -and -not $ready; $i++) {
    try {
      $r = Invoke-WebRequest -Uri $appUrl -UseBasicParsing -TimeoutSec 2
      if ($r.StatusCode -eq 200) { $ready = $true }
    } catch { Start-Sleep -Milliseconds 500 }
  }
  if (-not $ready) { throw "Server did not answer at $appUrl" }

  $baseUrlArg = ''
  if ($Port -ne 8000) { $baseUrlArg = "http://localhost:$Port/examples/" }

  # ---- run -----------------------------------------------------------------
  for ($run = 1; $run -le $Runs; $run++) {
    $out = Join-Path $ResultsDir "run-$stamp-$run.json"
    Step "Cypress run $run of $Runs (framework=$Framework, browser=$Browser)"
    Push-Location $Here
    try {
      if ($baseUrlArg) { node $Helper $Suite $Spec $Framework $Browser $out $baseUrlArg }
      else { node $Helper $Suite $Spec $Framework $Browser $out }
    } finally { Pop-Location }
    if (-not (Test-Path -LiteralPath $out)) { $runError = $true; Write-Warning "Run $run produced no results"; continue }
    $res = Get-Content -LiteralPath $out -Raw | ConvertFrom-Json
    if ($res.runError) { $runError = $true; Write-Warning "Run $run could not run: $($res.runError)"; continue }
    $runResults += , $res
  }
}
finally {
  # ---- stop everything this script started --------------------------------
  if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
  Remove-Item Env:\PORT -ErrorAction SilentlyContinue
  $leftover = @(Get-Process -Name Cypress -ErrorAction SilentlyContinue | Where-Object { $cypressBefore -notcontains $_.Id })
  foreach ($p in $leftover) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
  if (Test-Path -LiteralPath $Target) { Remove-Item -LiteralPath $Target -Recurse -Force -ErrorAction SilentlyContinue }
  Step "Server stopped; $($leftover.Count) leftover Cypress process(es) stopped; placed copy removed"
}

if ($runResults.Count -eq 0) { Write-Error 'No run produced results.'; exit 2 }

# ---- table -----------------------------------------------------------------
$label = @{ passed = 'PASS'; failed = 'FAIL'; pending = 'PEND'; skipped = 'SKIP' }
Write-Host ''
Write-Host "TodoMVC official suite  app=$AppPath  framework=$Framework"
Write-Host "suite commit $actualCommit  Cypress $($runResults[0].cypressVersion)  $($runResults[0].browser)"
Write-Host ''
$header = ''
for ($r = 1; $r -le $runResults.Count; $r++) { $header += ('run{0} ' -f $r) }
Write-Host ("{0}  {1}" -f $header, 'test')
Write-Host ("{0}  {1}" -f ('-' * $header.Length), ('-' * 60))
$first = $runResults[0].tests
$flaky = 0
for ($t = 0; $t -lt $first.Count; $t++) {
  $cells = ''
  $states = @()
  foreach ($res in $runResults) {
    $st = $res.tests[$t].state
    $states += $st
    $cells += ('{0,-5}' -f $label[$st]) + ' '
  }
  if (@($states | Select-Object -Unique).Count -gt 1) { $flaky++ }
  $name = ($first[$t].title | Select-Object -Skip 1) -join ' > '
  Write-Host ("{0}  {1}" -f $cells, $name)
  $err = $null
  foreach ($res in $runResults) { if ($res.tests[$t].error) { $err = $res.tests[$t].error; break } }
  if ($err) { Write-Host ("{0}    ! {1}" -f (' ' * $header.Length), $err) -ForegroundColor DarkYellow }
}
Write-Host ''
$anyFail = $false
for ($r = 0; $r -lt $runResults.Count; $r++) {
  $tot = $runResults[$r].totals
  if ($tot.failed -gt 0) { $anyFail = $true }
  Write-Host ("run{0}: {1} tests, {2} passed, {3} failed, {4} pending, {5} skipped" -f ($r + 1), $tot.tests, $tot.passed, $tot.failed, $tot.pending, $tot.skipped)
}
if ($runResults.Count -gt 1) { Write-Host "tests whose result differed between runs: $flaky" }
Write-Host "results JSON: $ResultsDir\run-$stamp-*.json"
if ($runError) { exit 2 }
if ($anyFail) { exit 1 }
exit 0
