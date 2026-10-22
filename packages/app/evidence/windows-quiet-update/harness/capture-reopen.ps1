# Contract 4.4's Windows run (increment_341abe802574): the app the installer reopens after an update.
# The installer reopens it through Explorer, so it starts without the run's STORYTREE_HOME, in the
# default home, where this laptop's follow-main app is set up: it refuses to start there (contract
# 4.18) with a dialog. Record that process (command line, parent, start time) and the dialog's words
# to <out>\reopened.txt, then close the dialog. A user's installation has only the default home.
#   powershell -NoProfile -File capture-reopen.ps1 -InstallDir <dir> -Out <dir> [-WaitSeconds 120]
param([Parameter(Mandatory)][string]$InstallDir, [Parameter(Mandatory)][string]$Out, [int]$WaitSeconds = 120)
Add-Type -AssemblyName UIAutomationClient
$deadline = (Get-Date).AddSeconds($WaitSeconds)
do {
  $proc = Get-CimInstance Win32_Process -Filter "Name = 'storytree-0.3.exe'" |
    Where-Object { $_.ExecutablePath -like "$InstallDir\*" -and $_.CommandLine -match '--updated' -and $_.CommandLine -notmatch '--type=' } | Select-Object -First 1
  if (-not $proc) { Start-Sleep 2 }
} until ($proc -or (Get-Date) -gt $deadline)
if (-not $proc) { [IO.File]::WriteAllText((Join-Path $Out 'reopened.txt'), "no reopened app within $WaitSeconds s`n"); exit 0 }
$parent = Get-CimInstance Win32_Process -Filter "ProcessId = $($proc.ParentProcessId)"
$handle = 0; $deadline = (Get-Date).AddSeconds(30)
while ($handle -eq 0 -and (Get-Date) -lt $deadline) { Start-Sleep 1; $handle = (Get-Process -Id $proc.ProcessId -ErrorAction SilentlyContinue).MainWindowHandle }
$words = ''
if ($handle -ne 0) {
  $w = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
  $words = ($w.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition) | ForEach-Object { $_.Current.Name } | Where-Object { $_ } | Select-Object -Unique) -join "`n"
}
$lines = @("process $($proc.ProcessId), $($proc.CommandLine), parent $($parent.Name), started $($proc.CreationDate.ToUniversalTime().ToString('o'))",
  "window title: $((Get-Process -Id $proc.ProcessId -ErrorAction SilentlyContinue).MainWindowTitle)", $words)
[IO.File]::WriteAllText((Join-Path $Out 'reopened.txt'), ($lines -join "`n") + "`n")
$p = Get-Process -Id $proc.ProcessId -ErrorAction SilentlyContinue
if ($p) { [void]$p.CloseMainWindow() }
