#!/usr/bin/env bash
# The run's judge (increment_82ef0ee2a9c9): a separate headless Claude Code call on the Mint box, a different model
# from the user's, given criteria.md and only the evidence folder, with read-only tools. The run never grades itself.
# Usage: judge.sh <evidence folder>. Writes judge.json and verdict.txt there; exit 0 only on PASS.
set -uo pipefail
OUT=${1:?usage: judge.sh <evidence folder>}
HERE=$(cd "$(dirname "$0")" && pwd)
MODEL=${STABLE_ACCEPTANCE_JUDGE_MODEL:-claude-sonnet-5-5}
cd "$OUT" || exit 2
claude -p --model "$MODEL" --allowedTools Read Glob Grep --output-format json < "$HERE/criteria.md" > judge.json 2> judge.err
node -e '
  const j = JSON.parse(require("fs").readFileSync("judge.json", "utf8"));
  const text = String(j.result ?? "");
  require("fs").writeFileSync("verdict.txt", text + "\n");
  const line = text.trim().split(/\r?\n/).findLast((l) => l.startsWith("VERDICT:")) ?? "VERDICT: FAIL: the judge gave no verdict";
  console.log(line + `  (judge ${j.modelUsage ? Object.keys(j.modelUsage).join(", ") : "?"}, $${(j.total_cost_usd ?? 0).toFixed(2)}, ${Math.round((j.duration_ms ?? 0) / 1000)} s)`);
  process.exit(line.startsWith("VERDICT: PASS") ? 0 : 1);
' | tee -a run.log
