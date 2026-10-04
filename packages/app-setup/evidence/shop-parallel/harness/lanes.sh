#!/usr/bin/env bash
# The supervisor's side of the parallel harness, run on the Mint box. Never touches the shop's code.
#   lanes.sh push                      copy this harness (and the first build's shared pieces) to the laptop's st-par
#   lanes.sh start <turn> [session]    start one lane's turn in the laptop's desktop session, fresh or resuming
#   lanes.sh wait <turn>...            block until every named turn has written its exit line; prints the meta
#   lanes.sh fetch <turn>...           copy the turns' transcripts to the private folder and summarise them here
#   lanes.sh shot <name>               capture the laptop app's window into shots/<name>.png
#   lanes.sh session <turn>            the Claude Code session id a turn ran in (to resume it)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; first="$here/../../shop/harness"
private="${SHOP_PRIVATE:-$HOME/storytree-lanes/shop-parallel-private}"; evidence="$here/.."
mkdir -p "$private" "$evidence/runs" "$evidence/shots"
ps() { ssh -n winlap "powershell -NoProfile -ExecutionPolicy Bypass -Command \"$1\"" | tr -d '\r'; }
case "$1" in
  push)
    ssh -n winlap "mkdir st-par 2>nul & mkdir st-par\\prompts 2>nul & mkdir st-par\\runs 2>nul & mkdir st-par\\shots 2>nul" || true
    scp -q "$first/hold-run.mjs" "$first/appshot.ps1" "$first/state.ps1" "$first/pgport.ps1" winlap:st-par/
    scp -q "$here"/*.ps1 "$here/projects.txt" winlap:st-par/
    scp -q "$here"/prompts/*.txt winlap:st-par/prompts/
    ;;
  start)
    turn="$2"; resume="${3:-}"
    printf '& "$HOME\\st-par\\held-lane-turn.ps1" -Turn %s%s\r\n' "$turn" "${resume:+ -Resume $resume}" > "$private/$turn.in.txt"
    scp -q "$private/$turn.in.txt" "winlap:st-par/$turn.in.txt"
    ssh -n winlap "powershell -NoProfile -ExecutionPolicy Bypass -File st-par\\start-task.ps1 $turn C:\\Users\\mickh\\st-par\\$turn.in.txt" | tr -d '\r'
    ;;
  wait)
    shift
    for turn in "$@"; do
      until ssh -n winlap "type st-par\\runs\\$turn.meta.txt 2>nul" | grep -q '^exit'; do sleep 30; done
      ssh -n winlap "type st-par\\runs\\$turn.meta.txt" | tr -d '\r'
      ssh -n winlap "schtasks /delete /tn st-$turn /f" >/dev/null 2>&1 || true
    done
    ;;
  fetch)
    shift
    for turn in "$@"; do
      scp -q "winlap:st-par/runs/$turn.jsonl" "$private/$turn.jsonl"
      scp -q "winlap:st-par/runs/$turn.meta.txt" "$evidence/runs/$turn.meta.txt"
      node "$first/sum.mjs" "$private/$turn.jsonl" > "$evidence/runs/$turn.summary.txt" || true
      echo "$turn: $(tail -1 "$evidence/runs/$turn.meta.txt")"
    done
    ;;
  shot)
    printf '& "$HOME\\st-par\\shot.ps1" -Name %s\r\n' "$2" > "$private/shot.in.txt"
    scp -q "$private/shot.in.txt" winlap:st-par/shot.in.txt
    ssh -n winlap "powershell -NoProfile -ExecutionPolicy Bypass -File st-par\\start-task.ps1 shot C:\\Users\\mickh\\st-par\\shot.in.txt" >/dev/null
    for i in $(seq 1 30); do ssh -n winlap "type st-par\\shot.stdout.txt 2>nul" | grep -q "$2" && break; sleep 2; done
    ssh -n winlap "schtasks /delete /tn st-shot /f" >/dev/null 2>&1 || true
    scp -q "winlap:st-par/shots/$2.png" "$evidence/shots/$2.png" && echo "shots/$2.png"
    ;;
  session)
    ssh -n winlap "type st-par\\runs\\$2.meta.txt" | tr -d '\r' | sed -n 's/.* session \([^ ]*\).*/\1/p'
    ;;
  *) echo "unknown: $1" >&2; exit 2 ;;
esac
