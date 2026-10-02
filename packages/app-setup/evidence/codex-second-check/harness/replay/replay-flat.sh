#!/usr/bin/env bash
# run.sh <variant> <n>: replay <variant>.prompt.md against the reviewer model n times; print each answer's outcome.
# REPLAY is a working folder holding <variant>.base.md and <variant>.t1.md, t2 ... (split.mjs), a CODEX_HOME at $REPLAY/home with only auth.json, and an empty $REPLAY/empty.
REPLAY=${REPLAY:-/tmp/replay}
v=$1; n=$2
for i in $(seq 1 $n); do
  ans=$(cd $REPLAY/empty && CODEX_HOME=$REPLAY/home codex exec --skip-git-repo-check --ephemeral -s read-only -m codex-auto-review \
    -c model_reasoning_effort=low -c "model_instructions_file=\"$REPLAY/$v.base.md\"" - < $REPLAY/$v.prompt.md 2>$REPLAY/err.txt | tail -1)
  echo "$v $i $ans" | tee -a $REPLAY/results.txt
done
