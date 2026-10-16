#!/bin/bash
# Linux acceptance, the update over the previous stable (increment_9184e6e6e3fe), the twin of
# mac-acceptance/harness/self-update.sh, run on a fresh GitHub ubuntu-latest runner under a virtual display by
# .github/workflows/linux-self-update.yml: the stable one-liner's install, with a project and an arc made on it, left
# running and idle, takes the newest release by its own AppImage update (contract 4.4) and reopens on it with the arc
# kept and the setup check passing. If it has not updated itself in time, the newest release's one-liner is run over
# the install, as Don's Mac update check did, and proved-by.txt says which of the two this run proved.
# Every step records its output and exit code in $OUT and carries on, so one failure still leaves the rest observed.
# The repository is public, so nothing here prints a secret, and no agent is signed in.
set -u
OUT=${1:?usage: self-update.sh <output folder>}
mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)
APP="$HOME/.local/share/storytree-0.3"
HOMEDIR="$HOME/.storytree/0.3"
PROJECT="$HOME/st-linux-self-update"
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

shot() { import -window root "$OUT/$1.png" && echo "screenshot $1.png" || echo "screenshot failed for $1"; }
# The version the installed AppImage's own desktop entry says it is, read without mounting it, as install.sh does.
appversion() { (cd "$(mktemp -d)" && "$APP/storytree-0.3" --appimage-extract storytree-0.3.desktop >/dev/null 2>&1 && sed -n 's/^X-AppImage-Version=//p' squashfs-root/storytree-0.3.desktop | grep .); }
running() { pgrep -f '\.local/share/storytree-0\.3/storytree-0\.3' > /dev/null; }

step machine sh -c 'cat /etc/os-release; uname -srm; id -un; echo "HOME=$HOME"; echo "apparmor_restrict_unprivileged_userns=$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>&1)"'
# The release the app should update itself to: the newest published one, whose Linux feed the development channel reads.
step latest-linux sh -c 'curl -fsSL https://github.com/storytree-ai/storytree/releases/latest/download/latest-linux.yml'
sed -n 's/^version: //p' "$OUT/latest-linux.txt" > "$OUT/latest-version.txt"

# What a desktop has and a server image lacks, as run.sh gives it.
step packages sh -c 'sudo apt-get update -qq && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq libfuse2t64 xvfb openbox imagemagick expect x11-utils >/dev/null'
export DISPLAY=:99
Xvfb :99 -screen 0 1440x900x24 >"$OUT/xvfb.log" 2>&1 &
sleep 2
openbox >"$OUT/openbox.log" 2>&1 &
# Claude Code installed but never signed in, so connection writes its hooks and the setup check has them to read.
step claude-install sh -c 'npm install -g @anthropic-ai/claude-code >/dev/null 2>&1; command -v claude && claude --version'

mkdir -p "$PROJECT"
cd "$PROJECT" || exit 1
# The previous stable: the stable one-liner exactly as the release page gives it, its questions answered as a person
# would: 1 connects Claude Code, Enter takes this folder and the suggested project name.
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
STABLE_ONE_LINER="curl -fsSL https://raw.githubusercontent.com/storytree-ai/storytree/release-channel-stable/install-storytree.sh | sh"
echo "$STABLE_ONE_LINER" > "$OUT/one-liner.txt"
step install expect "$OUT/answer.exp" "$STABLE_ONE_LINER"
step version-before appversion
sleep 10
step processes-installed sh -c "pgrep -fa storytree; echo; pgrep -fa postgres"
shot first-open

# Something to keep: an arc and a story in the project's database, read back before and after the update.
st() { bash -c ". '$HOME/.profile' && cd '$PROJECT' && storytree $*"; }
step doctor-before st doctor
step grow-arc st arc new --title "'A to-do page'" --intent "'A visitor keeps a short list'" --end-state "'The page adds and ticks items'"
step grow-story st library new story --title "'Keep a to-do list'" --description "'A visitor adds items and ticks them off'"
step arcs-before st arc list
step tree-before st tree

# Stable's pin is the build just installed, so a stable app would see nothing newer. Record the installation as
# development, whose feed is the newest release, and restart it so it reads the channel from its launch. Setup for
# this run only; no user does this.
step channel sh -c "cat '$HOMEDIR/release-channel.json'; echo; printf '{\"schema\":1,\"channel\":\"development\"}' > '$HOMEDIR/release-channel.json' && cat '$HOMEDIR/release-channel.json'"
step quit sh -c "pkill -TERM -f '\.local/share/storytree-0\.3/storytree-0\.3'; for _ in \$(seq 1 30); do pgrep -f '\.local/share/storytree-0\.3/storytree-0\.3' > /dev/null || exit 0; sleep 2; done; exit 1"
# Reopened by its menu entry's command, as a desktop would, so the sandbox flag the installer chose is kept.
REOPEN=$(sed -n 's/^Exec=//p' "$HOME/.local/share/applications/storytree-0.3.desktop" | sed 's/ %U$//')
echo "$REOPEN" > "$OUT/reopen.txt"
(eval "setsid $REOPEN" > "$OUT/reopen.log" 2>&1 &)
sleep 20
step processes-reopened sh -c "pgrep -fa storytree; echo; pgrep -fa postgres"

# Leave it running and untouched. It waits ten minutes after a launch and for an idle window (4.4), checks every
# three minutes, then replaces its AppImage and restarts. Poll the file's version, never the app, for 40 minutes.
FROM=$(tr -d '[:space:]' < "$OUT/version-before.txt")
waited=1
start=$SECONDS
while [ $((SECONDS - start)) -lt 2400 ]; do
  v=$(appversion)
  r=$(running && echo running || echo stopped)
  echo "$(date -u +%H:%M:%S) $v $r" >> "$OUT/update-wait.txt"
  if [ -n "$v" ] && [ "$v" != "$FROM" ] && [ "$r" = running ]; then waited=0; break; fi
  sleep 30
done
printf '%s\t%s\t%s\n' update-wait "$waited" "$((SECONDS - start))" >> "$STEPS"
cat "$OUT/update-wait.txt"

if [ "$waited" = 0 ]; then
  echo self-update > "$OUT/proved-by.txt"
else
  # The fallback the increment names: the newest release's own one-liner, run over the install.
  echo one-liner > "$OUT/proved-by.txt"
  NEW_ONE_LINER="curl -fsSL https://github.com/storytree-ai/storytree/releases/latest/download/install-storytree.sh | sh -s -- --channel development"
  echo "$NEW_ONE_LINER" >> "$OUT/one-liner.txt"
  step install-over expect "$OUT/answer.exp" "$NEW_ONE_LINER"
fi
sleep 30
step version-after appversion
step processes-after sh -c "pgrep -fa storytree; echo; pgrep -fa postgres"
shot after-update
step arcs-after st arc list
step tree-after st tree
step doctor-after st doctor
step releases-log cat "$HOMEDIR/releases.log"
step app-logs sh -c "ls -la '$HOMEDIR' 2>&1; tail -n 120 '$HOME/.config/storytree-0.3/logs/main.log' 2>&1"

echo "== proved by $(cat "$OUT/proved-by.txt")"
echo "== steps"
cat "$STEPS"
