#!/usr/bin/env bash
# journey.sh <dir> <out> <step>…: the agent link's live check (setup check 8.6) against this checkout's dev build.
# The first step makes a throwaway home (app setup's dev-home: its own HOME, agent homes and Postgres) unless
# <dir> already holds one. Steps:
#   codex | claude-code   a new folder set up as a project, one session told "Add a sign-up form, with tests."
#   unplanned             in the Claude Code folder, one session told to ignore storytree and only edit a file
# Claude Code signs in with CLAUDE_CODE_OAUTH_TOKEN (a long-lived token: `claude setup-token`), never a copy of
# ~/.claude's sign-in. The sessions' replies are kept as evidence; observe.mjs reads only the library and the
# activity log.
set -uo pipefail
dir=$1; out=$2; shift 2
repo=$(cd "$(dirname "$0")/../../../../.." && pwd)
mkdir -p "$out"
if [ ! -f "$dir/env.sh" ]; then
  ( cd "$repo" && pnpm -s --filter @storytree/app-setup dev-home "$dir" --codex --claude ) > "$out/dev-home.txt" 2>&1
  date -u +%FT%TZ > "$out/started.txt"
fi
. "$dir/env.sh"
stamp=$(date -u +%H%M)
for step in "$@"; do
  if [ "$step" = unplanned ]; then
    project=$(cat "$out/claude-code-project.txt")
    cd "$dir/$project"
    echo "$project" > "$out/unplanned-project.txt"
    date -u +%FT%TZ > "$out/unplanned-session-started.txt"
    timeout 600 claude -p --model haiku "Do not use storytree or any of its tools, and do not call check_setup. Only append the line 'an unplanned edit' to notes.txt in this folder, then stop." --dangerously-skip-permissions > "$out/unplanned-session.txt" 2>&1
    echo $? > "$out/unplanned-session-exit.txt"
    date -u +%FT%TZ > "$out/unplanned-session-ended.txt"
    continue
  fi
  agent=$step; project="st-live-$agent-$stamp"; folder="$dir/$project"
  echo "$project" > "$out/$agent-project.txt"
  mkdir -p "$folder" && cd "$folder" && git init -q
  storytree doctor > "$out/$agent-doctor-before.txt" 2>&1
  storytree doctor --set-up "$project" > "$out/$agent-set-up.txt" 2>&1
  date -u +%FT%TZ > "$out/$agent-session-started.txt"
  if [ "$agent" = claude-code ]; then
    timeout 3600 claude -p "Add a sign-up form, with tests." --dangerously-skip-permissions > "$out/$agent-session.txt" 2>&1
  else
    # --dangerously-bypass-hook-trust stands in for the user trusting storytree's hooks in /hooks.
    timeout 3600 codex exec --skip-git-repo-check --approve-for-me --dangerously-bypass-hook-trust "Add a sign-up form, with tests." > "$out/$agent-session.txt" 2>&1
  fi
  echo $? > "$out/$agent-session-exit.txt"
  date -u +%FT%TZ > "$out/$agent-session-ended.txt"
  storytree doctor > "$out/$agent-doctor-after.txt" 2>&1
  { git -C "$folder" status --short; git -C "$folder" log --oneline; } > "$out/$agent-files.txt" 2>&1
done
