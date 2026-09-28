# Capture only the storytree window (PrintWindow, so nothing else on the desktop appears) and report
# whether it is visible, minimised and in front. Must run in the logged-on session. Usage: screen-app.ps1 -Out <png>
param([string]$Out)
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class W {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
'@
[W]::SetProcessDPIAware() | Out-Null
$p = Get-Process storytree-0.3 -EA SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { "window: none (storytree processes: $(@(Get-Process storytree-0.3 -EA SilentlyContinue).Count))"; return }
$h = $p.MainWindowHandle
$r = New-Object W+RECT; [W]::GetWindowRect($h, [ref]$r) | Out-Null
"window: '$($p.MainWindowTitle)' pid $($p.Id) visible=$([W]::IsWindowVisible($h)) minimised=$([W]::IsIconic($h)) front=$([W]::GetForegroundWindow() -eq $h) rect=$($r.L),$($r.T),$($r.R),$($r.B)"
$w = $r.R - $r.L; $hh = $r.B - $r.T
if ($w -le 0 -or $hh -le 0 -or [W]::IsIconic($h)) { 'no capture (minimised or empty)'; return }
$bmp = New-Object System.Drawing.Bitmap $w, $hh
$g = [System.Drawing.Graphics]::FromImage($bmp)
$dc = $g.GetHdc(); [W]::PrintWindow($h, $dc, 2) | Out-Null; $g.ReleaseHdc($dc)
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose()
"saved $Out"
