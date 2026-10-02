#!/usr/bin/env bash
# run2.sh <variant> <n>: replay <variant>'s turns as one multi-turn reviewer conversation, n times; print the last answer.
# REPLAY is a working folder holding <variant>.base.md and <variant>.t1.md, t2 ... (split.mjs), a CODEX_HOME at $REPLAY/home with only auth.json, and an empty $REPLAY/empty.
REPLAY=${REPLAY:-/tmp/replay}
v=$1; n=$2; H=$REPLAY/home; C=(-s read-only -m codex-auto-review -c model_reasoning_effort=low -c "model_instructions_file=\"$REPLAY/$v.base.md\"")
cd $REPLAY/empty
for i in $(seq 1 $n); do
  out=$(CODEX_HOME=$H codex exec --skip-git-repo-check --json "${C[@]}" - < $REPLAY/$v.t1.md 2>/dev/null)
  id=$(printf '%s' "$out" | grep -m1 thread.started | sed -E 's/.*"thread_id":"([^"]+)".*/\1/')
  for t in $(ls $REPLAY/$v.t*.md | sort -V | tail -n +2); do
    out=$(CODEX_HOME=$H codex exec --skip-git-repo-check --json "${C[@]}" resume "$id" - < "$t" 2>/dev/null)
  done
  ans=$(printf '%s' "$out" | grep agent_message | tail -1 | sed -E 's/.*"text":"(.*)"\}\}$/\1/')
  echo "$v $i $ans" | tee -a $REPLAY/results2.txt
done
