#!/bin/bash
# Linux acceptance, the automated floor (increment_46e44175295b), the twin of mac-acceptance/harness/run.sh: what a
# first user's x64 Ubuntu desktop sees from the published one-liner, on a fresh GitHub ubuntu-latest runner under a
# virtual display, started by .github/workflows/linux-acceptance.yml. The hands-on run on the Mint box is not this.
# Every step records its output and exit code in $OUT and carries on, so one failure still leaves the rest observed.
# The repository is public, so nothing here prints a secret, and no agent is signed in.
set -u
OUT=${1:?usage: run.sh <output folder> [stable|development] [0.3.n on stable: install this build before it is pinned]}
CHANNEL=${2:-stable}
VERSION=${3:-}
case "$VERSION" in "" | 0.3.[1-9] | 0.3.[1-9]*[0-9]) ;; *) echo "run.sh: $VERSION is not a 0.3.<n> build" >&2; exit 2 ;; esac
case "${VERSION#0.3.}" in *[!0-9]*) echo "run.sh: $VERSION is not a 0.3.<n> build" >&2; exit 2 ;; esac
mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)
APP="$HOME/.local/share/storytree-0.3"
PROJECT="$HOME/st-linux-acceptance"
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

# The kernel setting that decides whether Chromium's sandbox can run unprivileged (ADR-1034) is recorded as the runner
# has it, never changed: a stock Ubuntu 24.04 desktop has it at 1, and the app must start there too.
step machine sh -c 'cat /etc/os-release; uname -srm; id -un; echo "HOME=$HOME"; echo "apparmor_restrict_unprivileged_userns=$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>&1)"; ldconfig -p | grep -E "libfuse\.so\.2|libfuse3" || true'
step before sh -c "ls -la '$APP' 2>&1; ls -la '$HOME/.storytree' 2>&1; command -v storytree; command -v claude; true"

# What a desktop has and a server image lacks: a display (Xvfb, with a window manager so the app's window is placed),
# libfuse2, which the installer names with its apt command when it is missing, and expect to answer its questions.
step packages sh -c 'sudo apt-get update -qq && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq libfuse2t64 xvfb openbox imagemagick expect x11-utils >/dev/null'
export DISPLAY=:99
Xvfb :99 -screen 0 1440x900x24 >"$OUT/xvfb.log" 2>&1 &
sleep 2
openbox >"$OUT/openbox.log" 2>&1 &

# Claude Code installed but never signed in, as on a computer whose owner has not signed in yet: connection then
# writes its hooks without any account touching this public runner.
step claude-install sh -c 'npm install -g @anthropic-ai/claude-code >/dev/null 2>&1; command -v claude && claude --version'

mkdir -p "$PROJECT"
cd "$PROJECT" || exit 1
# The one-liner exactly as the release page gives it, in a pseudo-terminal (expect) so its questions are asked and
# answered the way a person at a terminal would: 1 connects Claude Code, Enter takes this folder, Enter takes the
# suggested project name.
if [ "$CHANNEL" = development ]; then
  ONE_LINER="curl -fsSL https://github.com/storytree-ai/storytree/releases/latest/download/install-storytree.sh | sh -s -- --channel development"
elif [ -n "$VERSION" ]; then
  # A stable candidate before it is pinned: its own release's one-liner, which a pin would publish, told the build.
  ONE_LINER="curl -fsSL https://github.com/storytree-ai/storytree/releases/download/v$VERSION/install-storytree.sh | STORYTREE_ACCEPTANCE_VERSION=$VERSION sh"
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
# The version the installed AppImage's own desktop entry says it is, read without mounting it, as install.sh does.
step version sh -c "cd \"\$(mktemp -d)\" && '$APP/storytree-0.3' --appimage-extract storytree-0.3.desktop >/dev/null && sed -n 's/^X-AppImage-Version=//p' squashfs-root/storytree-0.3.desktop | grep ."
sleep 10
shot first-open

step menu-entry cat "$HOME/.local/share/applications/storytree-0.3.desktop"
step windows sh -c "xwininfo -root -tree | grep -i -E 'storytree|\"' | head -40"
step processes sh -c "pgrep -fa storytree; echo; pgrep -fa postgres"
# A desktop session's login reads ~/.profile, and every terminal opened in it inherits that PATH. A runner's login bash
# reads ~/.bash_profile instead when the image has one, so the desktop's login is done here by reading ~/.profile.
step profile sh -c "ls -la '$HOME'/.profile '$HOME'/.bash_profile '$HOME'/.bash_login 2>&1; cat '$HOME/.profile'"
st() { bash -c ". '$HOME/.profile' && cd '$PROJECT' && storytree $*"; }
step command-path bash -c ". '$HOME/.profile' && command -v storytree"
step doctor st doctor
step hooks sh -c "cat '$HOME/.claude/settings.json'; echo; ls -la '$HOME/.claude'"
step project-files sh -c "ls -la '$PROJECT'; cat '$PROJECT/.storytree.json'"

# Grow a small project with no agent: an arc, a story, read back as a tree.
step grow-arc st arc new --title "'A to-do page'" --intent "'A visitor keeps a short list'" --end-state "'The page adds and ticks items'"
step grow-story st library new story --title "'Keep a to-do list'" --description "'A visitor adds items and ticks them off'"
step tree st tree
step arcs st arc list
sleep 5
shot after-grow

step processes-after sh -c "pgrep -fa storytree; echo; pgrep -fa postgres"
step app-logs sh -c "ls -la '$HOME/.storytree/0.3' 2>&1; tail -n 40 '$HOME/.storytree/0.3/pgdata.log' 2>&1"

echo "== steps"
cat "$STEPS"
