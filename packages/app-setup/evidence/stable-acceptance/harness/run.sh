#!/usr/bin/env bash
# The stable acceptance run (increment_82ef0ee2a9c9, ADR-1032 D6): on the old laptop, a fresh Windows user installs
# one exact build with the stable one-liner, opens the app, connects Claude Code, and a model-driven user (a headless
# Claude Code session given a user's goal) builds a small project through storytree and leaves feedback through the
# app's Send feedback page. A separate judge (judge.sh, a different model call) gives the verdict; cleanup removes the
# user and everything it made. Driven from the Mint box over `ssh winlap`, as process_81a7122f6849 says.
#
# Usage: run.sh <0.3.N> [evidence folder] [phase...]
#   phases, in order: before user prepare install app turn1 shots1 turn2 feedback verify after judge
#   (default all; naming some reruns only those, for a run's repair). Evidence stays out of the repository's
#   history: by default ~/storytree-lanes/stable-acceptance/<UTC stamp>-<version>/.
# Exit 0 only when the judge says PASS.
set -uo pipefail
VERSION=${1:?usage: run.sh <0.3.N> [evidence folder] [phase...]}
[[ $VERSION =~ ^0\.3\.[1-9][0-9]*$ ]] || { echo "not a 0.3.<n> version: $VERSION" >&2; exit 2; }
OUT=${2:-$HOME/storytree-lanes/stable-acceptance/$(date -u +%Y%m%dT%H%M%SZ)-$VERSION}
shift $(( $# >= 2 ? 2 : 1 ))
PHASES=${*:-before user prepare install app turn1 shots1 turn2 feedback verify after judge}
HOST=${STABLE_ACCEPTANCE_HOST:-winlap}
PORT=9333
HERE=$(cd "$(dirname "$0")" && pwd)
# The user's Claude Code signs in with a long-lived token made once for these runs (`claude setup-token`), kept on
# this box and put in the run's folder only for its life. Never a copy of anyone's sign-in: on 2026-10-16 a copied
# sign-in refreshed in a trial user rotated the token it came from, and the laptop's own Claude Code was signed out.
TOKEN=${STABLE_ACCEPTANCE_TOKEN_FILE:-$HOME/storytree-lanes/secrets/stable-acceptance.claude-token}
mkdir -p "$OUT/steps" "$OUT/ev"
# A name of its own each run: a removed user's profile folder stays until the laptop restarts (user.ps1).
[[ -s $OUT/user ]] || echo "st-${VERSION#0.3.}-$(date -u +%m%d%H%M)" > "$OUT/user"
NAME=$(cat "$OUT/user")
RUN="C:/ProgramData/st-acceptance/$NAME"
log() { echo "[$(date '+%F %T')] $*" | tee -a "$OUT/run.log"; }
admin() { ssh -n "$HOST" "powershell -NoProfile -ExecutionPolicy Bypass -File st-acc\\$*" 2>&1 | tr -d '\r'; }
put() { scp -q "$1" "$HOST:$RUN/$2"; }
# A step runs as the fresh user through its task; its output goes to the run's log.
step() {
  local name=$1 minutes=$2 more=${3:-}
  sed -e "s|@VERSION@|$VERSION|g" -e "s|@INSTALLER@|$INSTALLER|g" -e "s|@PORT@|$PORT|g" -e "s|@N@|${N:-}|g" -e "s|@MORE@|$more|g" "$HERE/steps/$name.ps1" > "$OUT/steps/$name.ps1"
  scp -q "$OUT/steps/$name.ps1" "$HOST:st-acc/$name.ps1"
  admin "user.ps1 step $NAME %USERPROFILE%\\st-acc\\$name.ps1 $minutes" | tee -a "$OUT/run.log"
}
fetch() { scp -q -r "$HOST:$RUN/ev/*" "$OUT/ev/" 2>/dev/null; }
cdp() { printf '%s\n' "$@" > "$OUT/steps/cdp-steps.txt"; put "$OUT/steps/cdp-steps.txt" cdp-steps.txt; step cdp 5; fetch; }
# The installer: the newest release's one-liner when it takes a version; until a release carries that option
# (increment_eddead0e5ef2), main's copy of the same file, which each release publishes unchanged.
INSTALLER=https://github.com/storytree-ai/storytree/releases/latest/download/install-storytree.ps1
curl -fsSL "$INSTALLER" | grep -q STORYTREE_ACCEPTANCE_VERSION \
  || INSTALLER=https://raw.githubusercontent.com/storytree-ai/storytree/main/packages/app-setup/src/deliver/install.ps1

ssh -n "$HOST" "if not exist st-acc mkdir st-acc" >/dev/null
for f in user.ps1 state.ps1; do scp -q "$HERE/$f" "$HOST:st-acc/$f"; done
for phase in $PHASES; do
  log "phase $phase"
  case $phase in
    before)
      [[ -s $TOKEN ]] || { log "no Claude Code token at $TOKEN: the owner makes one with claude setup-token (README)"; exit 3; }
      echo "$VERSION" > "$OUT/version"; echo "$INSTALLER" > "$OUT/installer"
      admin state.ps1 > "$OUT/state-before.txt"
      admin "user.ps1 sweep" | tee -a "$OUT/run.log" ;;
    user) admin "user.ps1 create $NAME" | tee -a "$OUT/run.log" ;;
    prepare)
      step prepare 10
      tr -d '\r\n' < "$TOKEN" > "$OUT/steps/claude-token.txt"; put "$OUT/steps/claude-token.txt" claude-token.txt
      rm -f "$OUT/steps/claude-token.txt" ;;
    install) step install 20; fetch ;;
    app)
      put "$HERE/steps/cdp.mjs" cdp.mjs
      step app 5
      cdp wait:15000 shot:01-first-open buttons: "text:#setup-help-title" ;;
    turn1)
      put "$HERE/prompts/turn-1.txt" prompt-1.txt
      N=1 step turn 75; fetch
      node "$HERE/sum.mjs" "$OUT/ev/turn-1.jsonl" > "$OUT/turn-1.summary.json" ;;
    shots1) cdp "mouse:Close app menu" wait:2000 shot:02-after-build "mouse:Stories" wait:2000 shot:03-stories ;;
    turn2)
      put "$HERE/prompts/turn-2.txt" prompt-2.txt
      N=2 step turn 20 --continue; fetch
      node "$HERE/sum.mjs" "$OUT/ev/turn-2.jsonl" > "$OUT/turn-2.summary.json" ;;
    feedback)
      reply=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).reply)' "$OUT/turn-2.summary.json")
      grep -m1 '^FEEDBACK TITLE:' <<<"$reply" | sed 's/^FEEDBACK TITLE: *//' > "$OUT/steps/feedback-title.txt"
      grep -m1 '^FEEDBACK:' <<<"$reply" | sed 's/^FEEDBACK: *//' > "$OUT/steps/feedback-body.txt"
      put "$OUT/steps/feedback-title.txt" feedback-title.txt; put "$OUT/steps/feedback-body.txt" feedback-body.txt
      cdp "mouse:App menu" wait:1500 "mouse:Help" wait:1500 "mouse:Send feedback" wait:1500 shot:04-feedback-page \
        "mouse:css=[data-feedback-form] input[name=title]" "typefile:$RUN/feedback-title.txt" \
        "mouse:css=[data-feedback-form] textarea" "typefile:$RUN/feedback-body.txt" shot:05-feedback-written \
        "mouse:Open GitHub draft" wait:3000 "text:[data-feedback-status]" shot:06-feedback-opened ;;
    verify)
      reply=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).reply)' "$OUT/turn-2.summary.json")
      grep -m1 '^TEST COMMAND:' <<<"$reply" | sed 's/^TEST COMMAND: *//; s/^`//; s/`$//' > "$OUT/steps/test-command.txt"
      put "$OUT/steps/test-command.txt" test-command.txt
      step verify 15; fetch ;;
    after)
      fetch
      admin "user.ps1 remove $NAME" | tee -a "$OUT/run.log"
      admin state.ps1 > "$OUT/state-after.txt"
      ssh -n "$HOST" "rmdir /s /q st-acc" >/dev/null 2>&1
      diff <(grep -v '^st-profiles:' "$OUT/state-before.txt") <(grep -v '^st-profiles:' "$OUT/state-after.txt") > "$OUT/state-diff.txt" \
        && log "the laptop is as it was before the run" || log "the laptop differs from before the run: state-diff.txt" ;;
    judge) bash "$HERE/judge.sh" "$OUT"; status=$? ;;
    *) log "unknown phase $phase"; exit 2 ;;
  esac
done
exit "${status:-0}"
