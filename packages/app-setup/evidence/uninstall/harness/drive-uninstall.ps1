# Runs storytree's uninstaller exactly as Windows Apps & features does (its registered UninstallString),
# in the logged-on session, and answers its dialogs as a user would: OK to "are you sure", then
# $Library (Yes keeps, No removes) to the library question. Each dialog is captured on its own
# (PrintWindow) before its button is clicked, so nothing else on the desktop appears.
# Usage: drive-uninstall.ps1 -Out <folder> -Library Yes|No
param([string]$Out, [ValidateSet('Yes', 'No')][string]$Library)
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class D {
  public delegate bool Enum(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool EnumWindows(Enum f, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr h, Enum f, IntPtr p);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  public static string Cls(IntPtr h) { var s = new StringBuilder(256); GetClassName(h, s, 256); return s.ToString(); }
  public static string Txt(IntPtr h) { var s = new StringBuilder(4096); GetWindowText(h, s, 4096); return s.ToString(); }
  public static List<IntPtr> Dialogs() { var l = new List<IntPtr>(); EnumWindows((h, p) => { if (IsWindowVisible(h) && Cls(h) == "#32770") l.Add(h); return true; }, IntPtr.Zero); return l; }
  public static List<IntPtr> Children(IntPtr w) { var l = new List<IntPtr>(); EnumChildWindows(w, (h, p) => { l.Add(h); return true; }, IntPtr.Zero); return l; }
}
'@
[D]::SetProcessDPIAware() | Out-Null
New-Item -ItemType Directory -Force $Out | Out-Null
function Capture($h, $file) {
  $r = New-Object D+RECT; [D]::GetWindowRect($h, [ref]$r) | Out-Null
  $bmp = New-Object System.Drawing.Bitmap ($r.R - $r.L), ($r.B - $r.T)
  $g = [System.Drawing.Graphics]::FromImage($bmp); $dc = $g.GetHdc(); [D]::PrintWindow($h, $dc, 2) | Out-Null; $g.ReleaseHdc($dc)
  $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose()
}
function Ours($h) {
  $procId = 0; [D]::GetWindowThreadProcessId($h, [ref]$procId) | Out-Null
  $p = Get-Process -Id $procId -EA SilentlyContinue
  return $p -and ($p.ProcessName -like 'Au_*' -or $p.ProcessName -like 'Un_*' -or $p.ProcessName -like 'Uninstall*')
}

$entry = Get-ItemProperty HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\* | Where-Object DisplayName -like 'storytree*' | Select-Object -First 1
"UninstallString: $($entry.UninstallString)"
$exe = ([regex]'^"([^"]+)"\s*(.*)$').Match($entry.UninstallString)
$start = Get-Date
Start-Process -FilePath $exe.Groups[1].Value -ArgumentList $exe.Groups[2].Value
$seen = @{}; $n = 0
while (((Get-Date) - $start).TotalSeconds -lt 300) {
  Start-Sleep -Milliseconds 500
  foreach ($h in [D]::Dialogs()) {
    if ($seen.ContainsKey([string]$h) -or -not (Ours $h)) { continue }
    Start-Sleep -Milliseconds 400
    $n++; $seen[[string]$h] = $true
    $kids = [D]::Children($h)
    $text = ($kids | Where-Object { [D]::Cls($_) -eq 'Static' } | ForEach-Object { [D]::Txt($_) } | Where-Object { $_ }) -join ' | '
    Capture $h (Join-Path $Out "dialog-$n.png")
    $want = if ($text -match 'Keep your storytree library') { "&$Library" } else { 'OK' }
    $button = $kids | Where-Object { [D]::Cls($_) -eq 'Button' -and ([D]::Txt($_) -replace '&', '') -eq ($want -replace '&', '') } | Select-Object -First 1
    "dialog $n at +$([int]((Get-Date) - $start).TotalSeconds)s, title '$([D]::Txt($h))': $text"
    if ($button) { [D]::SendMessage($button, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null; "  clicked $want" } else { "  no '$want' button: $((($kids | Where-Object { [D]::Cls($_) -eq 'Button' }) | ForEach-Object { [D]::Txt($_) }) -join ', ')" }
  }
  $running = @(Get-Process | Where-Object { $_.ProcessName -like 'Au_*' -or $_.ProcessName -like 'Un_*' -or $_.ProcessName -like 'Uninstall*' })
  if ($n -gt 0 -and $running.Count -eq 0) { break }
}
"uninstaller finished after $([int]((Get-Date) - $start).TotalSeconds)s; dialogs answered: $n"
