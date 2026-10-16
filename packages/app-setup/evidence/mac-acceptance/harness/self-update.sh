#!/bin/bash
# Mac acceptance check (b) of decision_b0a98e971a05 D4, its second half (increment_e9ed21b673a3), run on a fresh
# GitHub macos-latest runner by .github/workflows/mac-self-update.yml: the Developer ID signed and notarised app
# passes Gatekeeper with the quarantine a browser download leaves, then, left running and idle, updates itself to
# the next release (contract 4.4) without the one-liner, and reopens on it with its project and database (1.5).
# Every step records its output and exit code in $OUT and carries on, so one failure still leaves the rest observed.
# The repository is public, so nothing here prints a secret, and no agent is signed in.
set -u
OUT=${1:?usage: self-update.sh <output folder> <0.3.n: the signed release to start from>}
FROM=${2:?usage: self-update.sh <output folder> <0.3.n: the signed release to start from>}
case "${FROM#0.3.}" in "" | *[!0-9]*) echo "self-update.sh: $FROM is not a 0.3.<n> build" >&2; exit 2 ;; esac
mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)
APP="$HOME/Applications/storytree-0.3.app"
HOMEDIR="$HOME/.storytree/0.3"
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
version() { defaults read "$APP/Contents/Info" CFBundleShortVersionString 2>/dev/null; }
running() { pgrep -f "^$APP/Contents/MacOS/storytree-0.3\$" > /dev/null; }
# limit SECONDS COMMAND…: a command that may wait on a dialog nobody here can see is stopped after SECONDS.
limit() { perl -e 'alarm shift; exec @ARGV' "$@"; }

step machine sh -c 'sw_vers; uname -m; sysctl -n machdep.cpu.brand_string; id -un; echo "HOME=$HOME"'
# The release the app should update itself to: the newest published one, whose Mac feed the development channel reads.
step latest-mac sh -c 'curl -fsSL https://github.com/storytree-ai/storytree/releases/latest/download/latest-mac.yml'

mkdir -p "$PROJECT"
cd "$PROJECT" || exit 1
# Release N, Developer ID signed and notarised, by its own release's one-liner (how run.sh installs a named build).
# Its questions are answered as a person would: S connects no agent here, Enter takes this folder and the name.
ONE_LINER="curl -fsSL https://github.com/storytree-ai/storytree/releases/download/v$FROM/install-storytree.sh | STORYTREE_ACCEPTANCE_VERSION=$FROM sh"
echo "$ONE_LINER" > "$OUT/one-liner.txt"
cat > "$OUT/answer.exp" <<'EXP'
set timeout 900
spawn sh -c [lindex $argv 0]
expect {
  "Choose 1, 2, 3 or S:" { send "S\r"; exp_continue }
  "Project folder:" { send "\r"; exp_continue }
  "Project name:" { send "\r"; exp_continue }
  timeout { puts "TIMED OUT waiting for the installer"; exit 124 }
  eof
}
catch wait result
exit [lindex $result 3]
EXP
step install expect "$OUT/answer.exp" "$ONE_LINER"
step version-before sh -c "defaults read '$APP/Contents/Info' CFBundleShortVersionString"

# A named build installs as stable, and stable's pin is still older than any Developer ID build, so a stable app
# would see nothing newer. Quit it and record the installation as development, whose feed is the newest release:
# the channel N and N+1 were both published on. Setup for this run only; no user does this.
step quit limit 60 osascript -e 'quit app "storytree-0.3"'
for _ in $(seq 1 30); do running || break; sleep 2; done
step channel sh -c "cat '$HOMEDIR/release-channel.json'; echo; printf '{\"schema\":1,\"channel\":\"development\"}' > '$HOMEDIR/release-channel.json' && cat '$HOMEDIR/release-channel.json'"

# Gatekeeper's first open, as a browser download meets it: the release's zip in ~/Downloads with the quarantine
# attribute a browser and Archive Utility put on every file, assessed, then opened the way Finder does. macOS runs
# a quarantined app from where it was downloaded through App Translocation (a read-only copy at a random path),
# which is not the installed app, so this copy is quit afterwards and the update below runs on the one-liner's
# install, which curl leaves unquarantined.
DOWNLOAD="$HOME/Downloads/storytree-0.3.app"
ZIP="storytree-0.3-$FROM-mac-arm64.zip"
QUARANTINE="0081;$(printf '%x' "$(date +%s)");Safari;$(uuidgen)"
step download sh -c "mkdir -p '$HOME/Downloads' && curl -fsSL -o '$HOME/Downloads/$ZIP' 'https://github.com/storytree-ai/storytree/releases/download/v$FROM/$ZIP' && ditto -x -k '$HOME/Downloads/$ZIP' '$HOME/Downloads' && ls -la '$HOME/Downloads'"
step quarantine sh -c "find '$DOWNLOAD' -exec xattr -w com.apple.quarantine '$QUARANTINE' {} + && xattr -l '$DOWNLOAD'"
step spctl spctl --assess --type execute --verbose=4 "$DOWNLOAD"
step codesign codesign --display --verbose=2 "$DOWNLOAD"
step stapler xcrun stapler validate "$DOWNLOAD"
# open waits while macOS asks whether to open an app from the internet, so it runs beside the steps that answer.
(limit 300 open "$DOWNLOAD" > "$OUT/open.txt" 2>&1; echo "open exit $?" >> "$OUT/open.txt") &
sleep 20
shot first-open-quarantined
step windows-quarantined limit 60 osascript -e 'tell application "System Events" to get {name, title of every window} of (every process whose background only is false)'
# A notarised app downloaded from the internet still asks once whether to open it; answer Open, as its user would.
step answer-open limit 60 osascript -e 'tell application "System Events" to tell process "CoreServicesUIAgent" to click button "Open" of window 1'
sleep 20
step dialog-after limit 60 osascript -e 'tell application "System Events" to get {name, title of every window} of (every process whose background only is false)'
step processes-open sh -c "pgrep -fl storytree; echo; pgrep -fl postgres"
step gatekeeper-log sh -c "log show --last 10m --style compact --predicate 'process == \"syspolicyd\" OR subsystem == \"com.apple.syspolicy\" OR process == \"CoreServicesUIAgent\"' | grep -i -E 'storytree|assess|quarantine|notar|translocat' | head -200"
step xattr-after-open xattr -p com.apple.quarantine "$DOWNLOAD"
shot first-open
step quit-download limit 60 osascript -e 'quit app "storytree-0.3"'
for _ in $(seq 1 30); do pgrep -f 'storytree-0.3.app/Contents/MacOS/storytree-0.3$' > /dev/null || break; sleep 2; done
step remove-download sh -c "rm -rf '$DOWNLOAD' '$HOME/Downloads/$ZIP'; pgrep -fl storytree; true"

# The one-liner's install, opened as its user would, then left to update itself.
step open-installed limit 120 open "$APP"
sleep 20
step processes-installed sh -c "pgrep -fl storytree; echo; pgrep -fl postgres"

# Something to keep: an arc and a story in the project's database, read back before and after the update.
st() { zsh -lc "cd '$PROJECT' && storytree $*"; }
step grow-arc st arc new --title "'A to-do page'" --intent "'A visitor keeps a short list'" --end-state "'The page adds and ticks items'"
step grow-story st library new story --title "'Keep a to-do list'" --description "'A visitor adds items and ticks them off'"
step tree-before st tree

# Leave it running and untouched. It waits ten minutes after a launch and for an idle window (4.4), checks every
# three minutes, then installs by itself and reopens. Poll the bundle's version, never the app, for 40 minutes.
step update-wait sh -c "start=\$(date +%s); while [ \$((\$(date +%s) - start)) -lt 2400 ]; do v=\$(defaults read '$APP/Contents/Info' CFBundleShortVersionString 2>/dev/null); r=\$(pgrep -f '^$APP/Contents/MacOS/storytree-0.3\$' > /dev/null && echo running || echo stopped); echo \"\$(date -u +%H:%M:%S) \$v \$r\"; if [ -n \"\$v\" ] && [ \"\$v\" != '$FROM' ] && [ \$r = running ]; then exit 0; fi; sleep 30; done; exit 1"
sleep 30
step version-after sh -c "defaults read '$APP/Contents/Info' CFBundleShortVersionString"
step processes-after sh -c "pgrep -fl storytree; echo; pgrep -fl postgres"
shot after-update
step tree-after st tree
step doctor st doctor
step spctl-after spctl --assess --type execute --verbose=4 "$APP"
step codesign-after codesign --display --verbose=2 "$APP"
step releases-log cat "$HOMEDIR/releases.log"
step app-logs sh -c "ls -la '$HOMEDIR' '$HOME/Library/Logs/storytree-0.3' 2>&1; tail -n 120 '$HOME/Library/Logs/storytree-0.3/main.log' 2>&1"

echo "== steps"
cat "$STEPS"
