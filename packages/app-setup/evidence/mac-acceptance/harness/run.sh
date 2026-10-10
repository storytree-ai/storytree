#!/bin/bash
# Mac acceptance check (b) of decision_b0a98e971a05 D4 (increment_dcaf0f58fcf0), run on a fresh GitHub macos-latest
# runner by .github/workflows/mac-acceptance.yml: what a first user's Apple Silicon Mac sees from the published
# one-liner, without the self-update step (that waits for Apple's approval, increment_4dcfabc58d92).
# Every step records its output and exit code in $OUT and carries on, so one failure still leaves the rest observed.
# The repository is public, so nothing here prints a secret, and no agent is signed in.
set -u
OUT=${1:?usage: run.sh <output folder> [stable|development]}
CHANNEL=${2:-stable}
mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)
APP="$HOME/Applications/storytree-0.3.app"
PROJECT="$HOME/st-mac-acceptance"
STEPS="$OUT/steps.tsv"
printf 'step\texit\tseconds\n' > "$STEPS"

# step NAME COMMAND…: runs it with its output in NAME.txt and its exit code and time in steps.tsv.
step() {
  local name=$1; shift
  local start=$SECONDS
  echo "== $name: $*"
  "$@" > "$OUT/$name.txt" 2>&1
  local code=$?
  printf '%s\t%s\t%s\n' "$name" "$code" "$((SECONDS - start))" >> "$STEPS"
  cat "$OUT/$name.txt"
  return 0
}

shot() { screencapture -x "$OUT/$1.png" && echo "screenshot $1.png" || echo "screencapture failed for $1"; }

step machine sh -c 'sw_vers; uname -m; sysctl -n machdep.cpu.brand_string; id -un; echo "HOME=$HOME"'
step before sh -c "ls -la '$HOME/Applications' 2>&1; ls -la '$HOME/.storytree' 2>&1; command -v storytree; command -v claude; true"

# Claude Code installed but never signed in, as on a Mac whose owner has not signed in yet: connection then writes
# its hooks without any account touching this public runner.
step claude-install sh -c 'npm install -g @anthropic-ai/claude-code >/dev/null 2>&1; command -v claude && claude --version'

mkdir -p "$PROJECT"
cd "$PROJECT" || exit 1
# The one-liner exactly as the release page gives it, in a pseudo-terminal (expect, which macOS ships) so its
# questions are asked and answered the way a person at Terminal would: 1 connects Claude Code, Enter takes this
# folder, Enter takes the suggested project name.
# Each channel's one-liner as its release page gives it (install-storytree-mac*.txt).
if [ "$CHANNEL" = development ]; then
  ONE_LINER="curl -fsSL https://github.com/storytree-ai/storytree/releases/latest/download/install-storytree.sh | sh -s -- --channel development"
else
  ONE_LINER="curl -fsSL https://raw.githubusercontent.com/storytree-ai/storytree/release-channel-stable/install-storytree.sh | sh"
fi
echo "$ONE_LINER" > "$OUT/one-liner.txt"
cat > "$OUT/answer.exp" <<'EXP'
set timeout 900
spawn sh -c [lindex $argv 0]
expect {
  "Choose 1, 2, 3 or S:" { send "1\r"; exp_continue }
  "Project folder:" { send "\r"; exp_continue }
  "Project name:" { send "\r"; exp_continue }
  timeout { puts "TIMED OUT waiting for the installer"; exit 124 }
  eof
}
catch wait result
exit [lindex $result 3]
EXP
step install expect "$OUT/answer.exp" "$ONE_LINER"
step version defaults read "$APP/Contents/Info" CFBundleShortVersionString
sleep 10
shot first-open

# Gatekeeper: curl sets no quarantine attribute, so macOS should not assess the app at first open at all. Record the
# attribute, what an assessment would say, the signature, and what syspolicyd logged while the app opened.
step xattr xattr -lr "$APP/Contents/MacOS"
step xattr-app xattr -l "$APP"
step spctl spctl --assess --type execute --verbose=4 "$APP"
step codesign codesign --display --verbose=2 "$APP"
step gatekeeper-log sh -c "log show --last 15m --style compact --predicate 'process == \"syspolicyd\" OR subsystem == \"com.apple.syspolicy\" OR process == \"XprotectService\"' | grep -i -E 'storytree|assess|quarantine|notar' | head -200"
step tcc-log sh -c "log show --last 15m --style compact --predicate 'subsystem == \"com.apple.TCC\"' | grep -i storytree | head -200"
step windows osascript -e 'tell application "System Events" to get {name, title of every window} of (every process whose background only is false)'

step processes sh -c "pgrep -fl storytree; echo; pgrep -fl postgres"
step zprofile sh -c "cat '${ZDOTDIR:-$HOME}/.zprofile'"
# A new Terminal window is a login zsh, which reads ~/.zprofile.
st() { zsh -lc "cd '$PROJECT' && storytree $*"; }
step command-path zsh -lc 'command -v storytree'
step doctor st doctor
step hooks sh -c "cat '$HOME/.claude/settings.json'; echo; ls -la '$HOME/.claude'"
step project-files sh -c "ls -la '$PROJECT'; cat '$PROJECT/.storytree.json'"

# Grow a small project with no agent: an arc, a story with a capability and contract, read back as a tree.
step grow-arc st arc new --title "'A to-do page'" --intent "'A visitor keeps a short list'" --end-state "'The page adds and ticks items'"
step grow-story st library new story --title "'Keep a to-do list'" --description "'A visitor adds items and ticks them off'"
step tree st tree
step arcs st arc list
sleep 5
shot after-grow

step processes-after sh -c "pgrep -fl storytree; echo; pgrep -fl postgres"
step app-logs sh -c "ls -la '$HOME/.storytree/0.3' '$HOME/Library/Logs/storytree-0.3' 2>&1; tail -n 80 '$HOME/Library/Logs/storytree-0.3/main.log' 2>&1"
# Updating by hand while the app cannot update itself: a second run of the one-liner over an installed app downloads
# nothing, so the app is quit and moved out first, then the one-liner run again; the project must still be there.
step rerun-installed expect "$OUT/answer.exp" "$ONE_LINER"
step quit osascript -e 'quit app "storytree-0.3"'
sleep 10
step move-out sh -c "mv '$APP' '$HOME/.Trash/' && ls '$HOME/.Trash'"
step reinstall expect "$OUT/answer.exp" "$ONE_LINER"
sleep 10
step version-after sh -c "defaults read '$APP/Contents/Info' CFBundleShortVersionString"
step tree-after st tree
shot after-reinstall

echo "== steps"
cat "$STEPS"
