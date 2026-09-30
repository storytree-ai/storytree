#!/usr/bin/env bash
# One line per trial: whether check_setup ran before the first change, whether the user was told the
# trust step, and whether the agent's own words named storytree (run from the evidence folder).
for f in "$@"; do
  check=$(grep -n -m1 'mcp: storytree/check_setup' "$f" | cut -d: -f1); check=${check:-0}
  write=$(grep -n -m1 -E '^apply patch|Set-Content|New-Item|Out-File' "$f" | cut -d: -f1); write=${write:-0}
  calls=$(grep -c 'mcp: storytree/' "$f")
  said=$(awk '/^codex$/{f=1;next} /^(exec|apply patch|mcp:|tokens used|diff |hook:)/{f=0} f' "$f")
  trust=$(printf '%s' "$said" | grep -ciE '/hooks|trust|approv')
  named=$(printf '%s' "$said" | grep -ci storytree)
  first=$([ "$check" -gt 0 ] && { [ "$write" -eq 0 ] || [ "$check" -lt "$write" ]; } && echo yes || echo no)
  echo "$(basename "$f" .txt): storytree_calls=$calls check_setup_before_first_change=$first told_trust_step=$([ "$trust" -gt 0 ] && echo yes || echo no) agent_words_name_storytree=$([ "$named" -gt 0 ] && echo yes || echo no) files_after=$(sed -n '/^--- folder after:/,$p' "$f" | tail -n +2 | tr '\n' ' ')"
done
