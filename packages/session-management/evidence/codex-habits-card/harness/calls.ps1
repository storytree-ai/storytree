# The trial's actions in order, from its Codex session record (not the auto-reviewer's sessions): each
# storytree call with its status and key arguments, each file change, each shell command. Usage: calls.ps1 <label>
param([string]$Label)
$files = Get-ChildItem -Recurse "$HOME\st-habits\home-$Label\sessions" -Filter *.jsonl |
  Where-Object { -not (Select-String -Path $_.FullName -Pattern 'whose request action you are assessing' -SimpleMatch -Quiet) }
foreach ($file in $files) {
  foreach ($line in Get-Content $file.FullName) {
    $o = $line | ConvertFrom-Json
    if ($o.type -ne 'event_msg' -or $o.payload.type -ne 'item_completed') { continue }
    $item = $o.payload.item
    switch ($item.type) {
      'McpToolCall' {
        $a = $item.arguments
        $keys = @('result', 'disposition', 'safe', 'title') | Where-Object { $a.PSObject.Properties.Name -contains $_ } | ForEach-Object { $v = [string]$a.$_; "$_=$($v.Substring(0, [Math]::Min(40, $v.Length)))" }
        "st:$($item.tool) [$($item.status)] $($keys -join ' ')"
      }
      'FileChange' { "EDIT $(@($item.changes.PSObject.Properties.Name | ForEach-Object { Split-Path -Leaf $_ }) -join ',')" }
      'CommandExecution' { "CMD" }
    }
  }
}
