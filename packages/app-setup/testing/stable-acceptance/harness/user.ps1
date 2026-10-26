# The run's fresh Windows user, made and taken away by the owner's elevated SSH login (process_81a7122f6849).
# Everything the user does runs from one on-demand scheduled task as that user, never over SSH as it: OpenSSH and
# Start-Process -Credential leave a user's profile loaded until a reboot, so its profile could not be removed after.
#   create <name>: a standard local user with a random password nobody keeps, and its task st-acc-<name>, registered
#     while the password exists, with no trigger, so it runs only when step starts it.
#   step <name> <script.ps1> [minutes]: copies the script into the user's run folder, runs it as the user through
#     the task, waits for the task to end (or ends it at the time limit) and prints its output.
#   remove <name>: ends its task and processes, deletes the task, the user, its profile and its run folder.
#   sweep: removes every user an earlier run left (each is described as this script makes it), and their profiles.
$ErrorActionPreference = 'Stop'
$verb, $name, $rest = $args
$described = 'storytree acceptance run, removed after'
if ($verb -eq 'sweep') {
  $left = @(Get-LocalUser | Where-Object { $_.Name -like 'st-*' -and $_.Description -eq $described } | ForEach-Object Name)
  foreach ($user in $left) { & $PSCommandPath remove $user }
  if (-not $left) { & $PSCommandPath remove st-none }
  return
}
if ($name -cnotmatch '^st-[a-z0-9-]{1,16}$') { throw "user name must look like st-<letters>: $name" }
$run = "$env:ProgramData\st-acceptance\$name"
$task = "st-acc-$name"
# A standard user may not log on as a batch job here, which its task needs: the run grants that right to its own user
# only, and remove takes it back before the user goes.
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices; using System.Security.Principal;
public static class StRights {
  [StructLayout(LayoutKind.Sequential)] struct U { public ushort Length; public ushort Max; [MarshalAs(UnmanagedType.LPWStr)] public string Buffer; }
  [StructLayout(LayoutKind.Sequential)] struct A { public int Length; public IntPtr R, O; public uint Attr; public IntPtr S, Q; }
  [DllImport("advapi32.dll")] static extern uint LsaOpenPolicy(IntPtr s, ref A a, int access, out IntPtr h);
  [DllImport("advapi32.dll")] static extern uint LsaAddAccountRights(IntPtr h, byte[] sid, U[] r, int n);
  [DllImport("advapi32.dll")] static extern uint LsaRemoveAccountRights(IntPtr h, byte[] sid, bool all, U[] r, int n);
  [DllImport("advapi32.dll")] static extern uint LsaClose(IntPtr h);
  static uint Do(string sid, bool add) {
    var s = new SecurityIdentifier(sid); var b = new byte[s.BinaryLength]; s.GetBinaryForm(b, 0);
    var a = new A(); IntPtr h; uint e = LsaOpenPolicy(IntPtr.Zero, ref a, 0x00000800 | 0x00000010, out h); if (e != 0) return e;
    var r = new U[] { new U { Buffer = "SeBatchLogonRight", Length = 34, Max = 36 } };
    e = add ? LsaAddAccountRights(h, b, r, 1) : LsaRemoveAccountRights(h, b, false, r, 1); LsaClose(h); return e;
  }
  public static uint Grant(string sid) { return Do(sid, true); }
  public static uint Revoke(string sid) { return Do(sid, false); }
}
"@
function Wait-Task([datetime]$Before, [int]$Minutes) {
  $deadline = (Get-Date).AddMinutes($Minutes)
  # Start-ScheduledTask returns before the task runs: it has ended once its last run is newer and it is not running.
  do {
    Start-Sleep 3
    $state = (Get-ScheduledTask -TaskName $task).State
    $ran = (Get-ScheduledTaskInfo -TaskName $task).LastRunTime -gt $Before
  } while ((-not $ran -or $state -eq 'Running') -and (Get-Date) -lt $deadline)
  if ($state -eq 'Running') { Stop-ScheduledTask -TaskName $task; "timed out after $Minutes minutes: task ended" }
  "task result: $((Get-ScheduledTaskInfo -TaskName $task).LastTaskResult)"
}
if ($verb -eq 'create') {
  if (Get-LocalUser -Name $name -ErrorAction SilentlyContinue) { throw "$name already exists: remove it first" }
  $chars = [char[]]'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  $bytes = New-Object byte[] 24; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $plain = (-join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })) + '#7a'
  New-LocalUser -Name $name -Password (ConvertTo-SecureString $plain -AsPlainText -Force) -PasswordNeverExpires -AccountNeverExpires -Description $described | Out-Null
  $sid = (Get-LocalUser $name).SID.Value
  New-Item -ItemType Directory -Force $run | Out-Null
  if ([StRights]::Grant($sid)) { throw "could not let $name log on as a batch job" }
  icacls $run /inheritance:r /grant:r "*${sid}:(OI)(CI)M" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
  # The task runs step.cmd, which step rewrites for each step with output of its own: an app a step starts keeps
  # that step's output open, so a shared file would refuse every later step.
  $action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$run\step.cmd`""
  $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 4) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $task -Action $action -Settings $settings -User $name -Password $plain | Out-Null
  "created $name ($sid) and its task $task"
} elseif ($verb -eq 'step') {
  $script, $minutes = $rest
  $stamp = "step-$(Get-Date -Format yyyyMMdd-HHmmss-fff)"
  Copy-Item -LiteralPath $script "$run\$stamp.ps1" -Force
  Set-Content -LiteralPath "$run\step.cmd" -Encoding ascii -Value "@powershell -NoProfile -ExecutionPolicy Bypass -File `"$run\$stamp.ps1`" > `"$run\$stamp.out`" 2>&1"
  $before = (Get-ScheduledTaskInfo -TaskName $task).LastRunTime
  Start-ScheduledTask -TaskName $task
  $waited = Wait-Task $before ([int]($(if ($minutes) { $minutes } else { 30 })))
  if (Test-Path "$run\$stamp.out") { Get-Content -LiteralPath "$run\$stamp.out" }
  $waited
} elseif ($verb -eq 'remove') {
  if (Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $task -Confirm:$false
  }
  $user = Get-LocalUser -Name $name -ErrorAction SilentlyContinue
  if ($user) {
    $sid = $user.SID.Value
    Get-Process -IncludeUserName | Where-Object { $_.UserName -eq "$env:COMPUTERNAME\$name" } | Stop-Process -Force -ErrorAction SilentlyContinue
    [void][StRights]::Revoke($sid)
    Remove-LocalUser -Name $name
  }
  # Windows keeps a removed user's profile loaded until the laptop restarts (seen 2026-10-16, with no process or
  # handle of the user's left): its files go now, the hive and its folder at the first remove after a restart, which
  # also takes any earlier run's left over the same way.
  $users = @(Get-LocalUser | ForEach-Object { $_.SID.Value })
  Get-CimInstance Win32_UserProfile | Where-Object { (Split-Path -Leaf $_.LocalPath) -match '^st-[a-z0-9-]+$' -and $_.SID -notin $users } | ForEach-Object {
    $path = $_.LocalPath
    try { Remove-CimInstance -InputObject $_ -ErrorAction Stop; "profile $path removed" }
    catch { Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction SilentlyContinue; "profile $path still loaded until a restart; its files removed" }
  }
  Remove-Item -LiteralPath $run -Recurse -Force -ErrorAction SilentlyContinue
  "removed ${name}: user $([bool](Get-LocalUser $name -ErrorAction SilentlyContinue)), run folder $(Test-Path $run), task $([bool](Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue))"
} else { throw 'usage: user.ps1 create|step|remove <name> [script] [minutes]' }
