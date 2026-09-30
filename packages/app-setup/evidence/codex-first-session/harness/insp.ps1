param([string]$Path)
$lines = Get-Content $Path
foreach ($l in $lines) {
  $o = $l | ConvertFrom-Json
  if ($o.type -eq 'response_item' -and $o.payload.type -eq 'message' -and $o.payload.role -ne 'assistant') {
    foreach ($c in $o.payload.content) { "== " + $o.payload.role + " (" + $c.text.Length + ")"; $c.text.Substring(0,[Math]::Min(700,$c.text.Length)) }
  }
  if ($o.type -eq 'world_state') { "== world_state keys: " + (($o.payload.state | Get-Member -MemberType NoteProperty).Name -join ',') }
}
