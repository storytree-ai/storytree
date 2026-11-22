#!/usr/bin/env bash
set -u
command -v node >/dev/null 2>&1 || PATH="$(ls -d "$HOME"/.nvm/versions/node/*/bin | sort -V | tail -n1):$PATH"
D="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")"
R="$D/runner.mjs"
T="$(cd "$D" && node --input-type=module -e 'process.stdout.write(import.meta.resolve("tsx"))')" || exit 1
[ "${1:-}" = status ] && exec env -u STORYTREE_LANE_RUN node --import "$T" "$R" status
[ $# -ge 3 ] || { echo "usage: run-lane.sh <brief-file> <log> <err> [add-dir ...] | status" >&2; exit 2; }
exec env -u STORYTREE_LANE_RUN node --import "$T" "$R" run "$@"
