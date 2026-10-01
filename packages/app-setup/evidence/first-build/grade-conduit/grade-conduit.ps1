<#
.SYNOPSIS
  Grades a Conduit (RealWorld) frontend with the OFFICIAL RealWorld Playwright e2e suite.

.DESCRIPTION
  Serves -AppPath with a tiny static server (SPA fallback to index.html), or uses -AppUrl,
  runs the unmodified suite (realworld-apps/realworld specs/e2e, pinned commit) headless in
  Chromium, prints a PASS / FLAKY / FAIL / SKIP table with each failure's first error line,
  then stops everything it started.

  Exit codes: 0 every selected test passed (FLAKY = passed on a retry or on the confirmation
                re-run, and SKIP, do not fail),
              1 at least one test failed,
              2 could not run (no app, server did not start, install failed, suite modified,
                no tests selected, no report).

  Pinned: suite commit ebbcdeb8d55b42a3a613c787560498b8ef10003f, @playwright/test 1.60.0
  (the version in the Angular reference app's lockfile), Chromium build 1223 (bundled with 1.60.0).
  First use (needs network): clones the suite if missing, `npm ci` if node_modules is missing,
  and downloads the Chromium headless shell into .\browsers (about 270 MB). Later runs are offline except for the
  public API (https://api.realworld.show/api), which the suite and the app both talk to.

.PARAMETER AppPath
  Folder holding the app; index.html must be at its root. Served at http://127.0.0.1:<port>/.

.PARAMETER AppUrl
  URL of an already running app, at the root of its origin (e.g. https://demo.realworld.show).

.PARAMETER Specs
  What to run (comma-separated or an array). Each item is one of:
    an area: home | auth | articles | comments | social   (or 1..5) - see areas.json / NOTES.md
    all
    a spec file: health, navigation, url-navigation, settings, null-fields, error-handling,
      user-fetch-errors, xss-security, or any name ending in .spec.ts (articles.spec.ts,
      auth.spec.ts, comments.spec.ts, social.spec.ts - a bare 'articles' means the AREA)
    a raw Playwright location: e2e/<file>.spec.ts:<line>
  Default: all.

.PARAMETER Through
  Shorthand for the cumulative areas up to and including this one, e.g. -Through articles
  = home,auth,articles. Combined with -Specs if both are given.

.PARAMETER Retries
  Retries per failing test. Default 1, the suite's own base-config value for local runs.

.PARAMETER ConfirmDelay
  After the run, tests that failed every attempt are run once more, this many seconds later
  (default 15). A test that passes then is reported FLAKY, not FAIL: the shared demo API
  sometimes crosses sessions between concurrent clients for a short window. -1 turns it off.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\grade-conduit.ps1 -AppPath C:\work\conduit -Through home
.EXAMPLE
  .\grade-conduit.ps1 -AppUrl https://demo.realworld.show -Specs auth,settings
#>
[CmdletBinding()]
param(
  [string]$AppPath,
  [string]$AppUrl,
  [string[]]$Specs = @('all'),
  [string]$Through,
  [int]$Retries = 1,
  [int]$Port = 0,
  [int]$ConfirmDelay = 15,
  [string]$OutDir,
  [ValidateSet('spa', 'ssr', 'fullstack')][string]$TestMode = 'spa'
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$SuiteCommit = 'ebbcdeb8d55b42a3a613c787560498b8ef10003f'
$SuiteRepo = 'https://github.com/realworld-apps/realworld.git'
$PlaywrightVersion = '1.60.0'
$ChromiumDir = 'chromium_headless_shell-1223'
$suiteDir = Join-Path $root 'suite'
$cli = Join-Path $root 'node_modules\@playwright\test\cli.js'
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $root 'browsers'

$server = $null
$runStart = Get-Date
$exitCode = 2

function Say([string]$msg) { Write-Host "grade-conduit: $msg" }
function Fail2([string]$msg) { Say "COULD NOT RUN - $msg"; throw [System.OperationCanceledException]::new($msg) }

# Runs a native command with its output shown on the console (not captured), returns its exit code.
function Invoke-Native([string]$exe, [string[]]$argv) {
  & $exe @argv | Out-Host
  return $LASTEXITCODE
}

# Stops everything this run started: every live descendant of this PowerShell process (the static
# server, Playwright's node, its browsers), plus any orphaned browser from this grader's own
# .\browsers folder whose parent has already died (an interrupted run). Nothing else is touched.
function Stop-Started {
  $all = @(Get-CimInstance Win32_Process)
  $byParent = @{}
  foreach ($p in $all) {
    if (-not $byParent.ContainsKey($p.ParentProcessId)) { $byParent[$p.ParentProcessId] = @() }
    $byParent[$p.ParentProcessId] += $p
  }
  $me = $all | Where-Object { $_.ProcessId -eq $PID } | Select-Object -First 1
  $kill = @()
  $queue = New-Object System.Collections.Queue
  $queue.Enqueue($me)
  while ($queue.Count) {
    $parent = $queue.Dequeue()
    foreach ($c in @($byParent[$parent.ProcessId])) {
      # direct children must be younger than this run (an interactive shell may own older ones)
      $minAge = if ($parent.ProcessId -eq $PID) { $runStart } else { $parent.CreationDate }
      if ($c -and $c.CreationDate -ge $minAge) { $kill += $c; $queue.Enqueue($c) }
    }
  }
  $alive = @{}
  foreach ($p in $all) { $alive[$p.ProcessId] = $true }
  $browsers = Join-Path $root 'browsers'
  $kill += $all | Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath.StartsWith($browsers, [StringComparison]::OrdinalIgnoreCase) -and
    -not $alive.ContainsKey($_.ParentProcessId)
  }
  foreach ($p in $kill) { try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop } catch {} }
  if ($kill.Count) { Say "stopped $($kill.Count) process(es) it started" }
}

try {
  # ---------- arguments ----------
  if ([string]::IsNullOrWhiteSpace($AppPath) -eq [string]::IsNullOrWhiteSpace($AppUrl)) {
    Fail2 'give exactly one of -AppPath <folder> or -AppUrl <url>'
  }
  if (-not $OutDir) { $OutDir = Join-Path $root ('runs\' + (Get-Date -Format 'yyyyMMdd-HHmmss')) }
  New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
  $OutDir = (Resolve-Path $OutDir).Path

  # ---------- prerequisites / first-use installs ----------
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail2 'node is not on PATH (Node 18+ needed)' }
  if (-not (Test-Path (Join-Path $suiteDir '.git'))) {
    Say "first use: cloning the suite into $suiteDir"
    if ((Invoke-Native git @('clone', '--quiet', $SuiteRepo, $suiteDir)) -ne 0) { Fail2 'git clone of the suite failed' }
  }
  $head = (& git -C $suiteDir rev-parse HEAD).Trim()
  if ($head -ne $SuiteCommit) {
    Say "checking out the pinned suite commit $SuiteCommit (was $head)"
    $null = Invoke-Native git @('-C', $suiteDir, 'fetch', '--quiet', 'origin')
    if ((Invoke-Native git @('-C', $suiteDir, 'checkout', '--quiet', $SuiteCommit)) -ne 0) { Fail2 "cannot check out suite commit $SuiteCommit" }
  }
  $dirty = & git -C $suiteDir status --porcelain -- specs/e2e
  if ($dirty) { Fail2 "the suite's specs/e2e has local changes; it must run unmodified:`n$($dirty -join "`n")" }

  $pwPkg = Join-Path $root 'node_modules\@playwright\test\package.json'
  $haveVersion = if (Test-Path $pwPkg) { (Get-Content $pwPkg -Raw | ConvertFrom-Json).version } else { '' }
  if ($haveVersion -ne $PlaywrightVersion) {
    Say "first use: installing @playwright/test $PlaywrightVersion (npm ci)"
    # Kept as grader-package*.json in the repository so no workspace tool takes them for a package.
    foreach ($f in 'package.json', 'package-lock.json') {
      if (-not (Test-Path (Join-Path $root $f))) { Copy-Item (Join-Path $root "grader-$f") (Join-Path $root $f) }
    }
    Push-Location $root
    try { $rc = Invoke-Native npm.cmd @('ci', '--no-audit', '--no-fund') } finally { Pop-Location }
    if ($rc -ne 0) { Fail2 'npm ci failed' }
  }
  if (-not (Test-Path (Join-Path $env:PLAYWRIGHT_BROWSERS_PATH $ChromiumDir))) {
    Say "first use: downloading Chromium for Playwright $PlaywrightVersion into $env:PLAYWRIGHT_BROWSERS_PATH"
    if ((Invoke-Native node @($cli, 'install', '--only-shell', 'chromium')) -ne 0) { Fail2 'playwright install chromium failed' }
  }

  # ---------- what to run ----------
  $areaMap = Get-Content (Join-Path $root 'areas.json') -Raw | ConvertFrom-Json
  $order = @($areaMap.order)
  $items = @()
  foreach ($s in $Specs) { $items += ($s -split ',') | ForEach-Object { $_.Trim() } | Where-Object { $_ } }
  if ($Through) {
    $t = $Through.Trim().ToLower()
    if ($t -match '^[1-5]$') { $t = $order[[int]$t - 1] }
    $idx = [array]::IndexOf($order, $t)
    if ($idx -lt 0) { Fail2 "-Through must be one of $($order -join ', ') (or 1-5)" }
    $items = @($items | Where-Object { $_ -ne 'all' }) + $order[0..$idx]
  }
  $locations = New-Object System.Collections.Generic.List[string]
  $selectAll = $false
  foreach ($it in $items) {
    $k = $it.ToLower()
    if ($k -match '^[1-5]$') { $k = $order[[int]$k - 1] }
    if ($k -eq 'all') { $selectAll = $true }
    elseif ($order -contains $k) { foreach ($l in $areaMap.areas.$k) { $locations.Add($l) } }
    elseif ($k -match '^e2e/.+\.spec\.ts(:\d+)?$') { $locations.Add($k) }
    else {
      $f = $k -replace '\.spec\.ts$', '' -replace '\.ts$', ''
      if (-not (Test-Path (Join-Path $suiteDir "specs\e2e\$f.spec.ts"))) {
        Fail2 "unknown -Specs item '$it' (areas: $($order -join ', '), all, or a spec file name)"
      }
      $locations.Add("e2e/$f.spec.ts")
    }
  }
  if ($selectAll) { $locations.Clear() }   # no filter = the whole suite
  $locations = @($locations | Select-Object -Unique)

  # ---------- the app ----------
  if ($AppPath) {
    if (-not (Test-Path $AppPath -PathType Container)) { Fail2 "-AppPath '$AppPath' is not a folder" }
    $AppPath = (Resolve-Path $AppPath).Path
    if (-not (Test-Path (Join-Path $AppPath 'index.html'))) { Fail2 "no index.html at the root of $AppPath" }
    $portFile = Join-Path $OutDir 'server.port'
    Remove-Item $portFile -ErrorAction SilentlyContinue
    $server = Start-Process -FilePath node -PassThru -WindowStyle Hidden `
      -ArgumentList @("`"$(Join-Path $root 'serve.mjs')`"", '--root', "`"$AppPath`"", '--port', $Port, '--port-file', "`"$portFile`"") `
      -RedirectStandardOutput (Join-Path $OutDir 'server.out.log') -RedirectStandardError (Join-Path $OutDir 'server.err.log')
    $deadline = (Get-Date).AddSeconds(15)
    while (-not (Test-Path $portFile) -and (Get-Date) -lt $deadline -and -not $server.HasExited) { Start-Sleep -Milliseconds 200 }
    if (-not (Test-Path $portFile)) { Fail2 "static server did not start (see $OutDir\server.err.log)" }
    $baseUrl = "http://127.0.0.1:$((Get-Content $portFile -Raw).Trim())"
    Say "serving $AppPath at $baseUrl (SPA fallback to index.html)"
  } else {
    $u = [Uri]$AppUrl
    if ($u.AbsolutePath -ne '/') { Say "WARNING: the suite navigates to absolute paths (/login, /article/...), so an app under '$($u.AbsolutePath)' cannot pass; serve it at the origin root" }
    $baseUrl = $u.GetLeftPart([UriPartial]::Authority)
  }
  try {
    $probe = Invoke-WebRequest -Uri "$baseUrl/" -UseBasicParsing -TimeoutSec 20
  } catch [System.Net.WebException] {
    if (-not $_.Exception.Response) { Fail2 "app not reachable at $baseUrl/ ($($_.Exception.Message))" }
    Say "WARNING: $baseUrl/ answered HTTP $([int]$_.Exception.Response.StatusCode)"
  }

  # ---------- run ----------
  # Plain output (no colour escape codes), so the console output can be saved as a log.
  $env:FORCE_COLOR = '0'
  Remove-Item Env:NO_COLOR -ErrorAction SilentlyContinue
  $env:CONDUIT_BASE_URL = $baseUrl
  $env:GRADE_OUT = $OutDir
  $env:TEST_MODE = $TestMode
  $pwArgs = @($cli, 'test', '--config', (Join-Path $root 'playwright.config.ts'), '--retries', "$Retries") + $locations
  Say "suite realworld@$($SuiteCommit.Substring(0,8)), Playwright $PlaywrightVersion, chromium headless, TEST_MODE=$TestMode"
  Say "app $baseUrl ; selection: $(if ($locations.Count) { "$($locations.Count) location(s) from: $($items -join ', ')" } else { 'all' })"
  Say "results in $OutDir"
  Push-Location $root
  try { $pwExit = Invoke-Native node $pwArgs } finally { Pop-Location }

  $report = Join-Path $OutDir 'report.json'
  if (-not (Test-Path $report)) { Fail2 "Playwright wrote no report (exit $pwExit)" }
  $summarize = Join-Path $root 'summarize.mjs'
  $failedList = Join-Path $OutDir 'failed.txt'
  $first = Invoke-Native node @($summarize, $report, '--quiet', '--failed-out', $failedList)
  $finalArgs = @($summarize, $report, '--summary-out', (Join-Path $OutDir 'summary.json'))

  # Confirmation re-run: the shared public API sometimes hands one client's session to another
  # (see NOTES.md), which fails a test on every attempt of a short window. Re-running only the
  # failed tests a little later separates that from a real defect, which fails again.
  if ($first -eq 1 -and $ConfirmDelay -ge 0) {
    $again = @(Get-Content $failedList | Where-Object { $_ })
    Say "confirmation re-run of $($again.Count) failed location(s) in $ConfirmDelay s"
    Start-Sleep -Seconds $ConfirmDelay
    $confirmDir = Join-Path $OutDir 'confirm'
    $env:GRADE_OUT = $confirmDir
    Push-Location $root
    try { $null = Invoke-Native node (@($cli, 'test', '--config', (Join-Path $root 'playwright.config.ts'), '--retries', "$Retries") + $again) } finally { Pop-Location }
    $finalArgs += @('--confirm', (Join-Path $confirmDir 'report.json'))
  }
  $exitCode = Invoke-Native node $finalArgs
  if ($exitCode -eq 0 -and $pwExit -ne 0 -and $first -ne 1) {
    Say "WARNING: Playwright exited $pwExit although no test failed (see the list output above)"
  }
} catch [System.OperationCanceledException] {
  $exitCode = 2
} catch {
  Say "COULD NOT RUN - $($_.Exception.Message)"
  $exitCode = 2
} finally {
  Stop-Started
}
Say "exit $exitCode"
exit $exitCode
