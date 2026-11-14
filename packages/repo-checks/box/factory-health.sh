#!/usr/bin/env bash
# The Mint box's factory health (increment_c2f2555808ec, contract 7.9): records the owner's factory plugins' own test
# runs as their stories' verified health once per factory commit and storytree commit, so nobody runs
# `pnpm check:factory-health` by hand. The voice committer's tick (voice-commit.service) pulls the factory clone to main,
# and the box's refresh moves the storytree checkout the factory's `storytree` link names to storytree's main; this, on
# factory-health.timer, notices either new commit and records it, so a storytree merge that breaks a plugin's tests is
# seen within one tick of landing (increment_171ee3fc5a9e). It runs from its own checkout of storytree's main (factory-health.service
# fetches it), never from a lane's.
#   - An unchanged factory and storytree cost nothing more than the telling: the last pair recorded is kept in
#     factory-health.last, and a tick at the same pair stops before locking anything.
#   - A new one is recorded with --unrecorded, under the machine's heavy-run lock (the factory's own micks-dev-loop
#     plugin's, which plain node starts), so a plugin the library already holds
#     at that commit (a hand run, an earlier tick that recorded part of it) is not run again.
#   - The commit is kept only when the recording succeeds: a run that left no report is tried again on the next tick.
# First, every tick, it tells the owner by FYI each verdict turn CI's role could not (CI may write only health, 3.20):
# `storytree health tell`, as the library's owner, on the answer to question_67e971f31102 (option A). A telling that
# fails is said in the log and tried again on the next tick, which looks back twelve hours; it never stops the recording.
set -euo pipefail
command -v node >/dev/null || PATH="$(ls -d "$HOME"/.nvm/versions/node/*/bin | sort -V | tail -n1):$PATH"

RUNNER=$(cd "$(dirname "$0")/../../.." && pwd)
FACTORY=${STORYTREE_FACTORY:-$HOME/.storytree/your-factory}
LAST=${STORYTREE_FACTORY_HEALTH_LAST:-$HOME/storytree-lanes/factory-health/factory-health.last}

cd "$RUNNER"
pnpm install --frozen-lockfile --prefer-offline >/dev/null
# The telling runs from the box's main checkout, the one the factory's `storytree` link names (contract 7.18): storytree
# approves one checkout of a project per machine (ADR-0942), and this runner, cloned for the service, is not it.
TELL_FROM=${STORYTREE_TELL_FROM:-$FACTORY/storytree}
if [ -d "$TELL_FROM" ]; then
  (cd "$TELL_FROM" && pnpm -s storytree health tell) || echo "factory-health: telling the verdict turns CI could not failed; the next tick tries again"
else
  echo "factory-health: no storytree checkout at $TELL_FROM to tell the verdict turns CI could not from; the next tick tries again"
fi

[ -d "$FACTORY/.git" ] || { echo "factory-health: no factory clone at $FACTORY, so nothing to record"; exit 0; }
commit=$(git -C "$FACTORY" rev-parse HEAD)
# The same pair factory-run.mjs's factoryCommit writes in each note, so a recording at it is not run again.
if [ -e "$FACTORY/storytree/.git" ]; then commit="$commit with storytree $(git -C "$FACTORY/storytree" rev-parse HEAD)"; fi
if [ -f "$LAST" ] && [ "$(cat "$LAST")" = "$commit" ]; then
  echo "factory-health: the factory is still at $commit, already recorded"
  exit 0
fi

echo "factory-health: the factory is at $commit, not yet recorded; recording it from storytree $(git -C "$RUNNER" rev-parse --short HEAD)"
node "$FACTORY/plugins/micks-dev-loop/src/heavy-lock.mjs" -- pnpm -s check:factory-health "$FACTORY" --unrecorded
mkdir -p "$(dirname "$LAST")"
echo "$commit" > "$LAST"
echo "factory-health: $commit is recorded"
