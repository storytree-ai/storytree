# Answer storytree's open "Select Folder" dialog with Win32 messages: the folder's path into its folder box, then its Select Folder button.
Add-Type @'
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class Dlg {
  public delegate bool Proc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(Proc p, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr h, Proc p, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, string l);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, StringBuilder l);
  public static string Get(IntPtr h) { var s = new StringBuilder(1024); SendMessage(h, 0x000D, (IntPtr)1024, s); return s.ToString(); }
  public static string Cls(IntPtr h) { var s = new StringBuilder(256); GetClassName(h, s, 256); return s.ToString(); }
  public static string Txt(IntPtr h) { var s = new StringBuilder(512); GetWindowText(h, s, 512); return s.ToString(); }
  public static List<IntPtr> Tops() { var l = new List<IntPtr>(); EnumWindows((h, x) => { l.Add(h); return true; }, IntPtr.Zero); return l; }
  public static List<IntPtr> Kids(IntPtr p) { var l = new List<IntPtr>(); EnumChildWindows(p, (h, x) => { l.Add(h); return true; }, IntPtr.Zero); return l; }
}
'@
$target = "$HOME\PF Second Project"
New-Item -ItemType Directory -Force $target | Out-Null
$pids = @(Get-Process storytree-0.3 -EA SilentlyContinue | ForEach-Object Id)
$dialog = [IntPtr]::Zero
$deadline = (Get-Date).AddSeconds(90)
while ($dialog -eq [IntPtr]::Zero -and (Get-Date) -lt $deadline) {
  foreach ($h in [Dlg]::Tops()) { $p = 0; [Dlg]::GetWindowThreadProcessId($h, [ref]$p) | Out-Null; if ([Dlg]::Cls($h) -eq '#32770' -and [Dlg]::IsWindowVisible($h) -and $pids -contains [int]$p) { $dialog = $h } }
  if ($dialog -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 500 }
}
if ($dialog -eq [IntPtr]::Zero) { 'dialog: not seen within 90 s'; return }
"dialog: '$([Dlg]::Txt($dialog))'"
$kids = [Dlg]::Kids($dialog)
$edit = $kids | Where-Object { [Dlg]::Cls($_) -eq 'Edit' -and [Dlg]::GetDlgCtrlID($_) -eq 1152 } | Select-Object -First 1
$button = $kids | Where-Object { [Dlg]::Cls($_) -eq 'Button' -and [Dlg]::GetDlgCtrlID($_) -eq 1 } | Select-Object -First 1
if (-not $edit -or -not $button) { [Dlg]::PostMessage($dialog, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null; 'controls (dialog cancelled):'; $kids | ForEach-Object { "  {0} id={1} '{2}'" -f [Dlg]::Cls($_), [Dlg]::GetDlgCtrlID($_), [Dlg]::Txt($_) }; return }
[Dlg]::SendMessage($edit, 0x000C, [IntPtr]::Zero, $target) | Out-Null   # WM_SETTEXT
"folder box: '$([Dlg]::Get($edit))'; button: '$([Dlg]::Txt($button))'"
if ([Dlg]::Get($edit) -ne $target) { 'the folder box did not take the path: cancelling'; [Dlg]::PostMessage($dialog, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null; return }
[Dlg]::PostMessage($button, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null   # BM_CLICK
Start-Sleep 3
"dialog still open: $([Dlg]::IsWindowVisible($dialog))"
Start-Sleep 5
"marker: $(Get-Content -Raw -LiteralPath "$target\.storytree.json" -EA SilentlyContinue)"
