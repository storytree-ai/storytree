# storytree's command line through the app's own node (Smart App Control refuses bin\storytree.exe here), run in a trial
# project's folder. Usage: st.ps1 <a|b> <storytree args...>
$P, $Rest = $args
Set-Location "$HOME\st-redo\$P\reddit-stats-$P"
$t = "$env:LOCALAPPDATA\Programs\storytree-0.3\resources\agent-tools"
[string[]]$r = @($Rest)
& "$t\node.exe" "$t\storytree.mjs" @r
