#!/usr/bin/env bash
# Which of the habits card's habits each trial followed, from its ordered actions (calls-<label>.txt):
# the setup check, a planned story and a claim before its first file change; a red report, then a change,
# then a green one (test first); the capability landed; the session closed out. Run from the evidence folder.
for f in "$@"; do
  label=$(basename "$f" .txt | sed 's/^calls-//')
  mapfile -t acts < <(tr -d '\r' < "$f")
  first_edit=${#acts[@]}; red=-1; green=-1; edit_after_red=0
  for i in "${!acts[@]}"; do
    a=${acts[$i]}
    # The setup check's own test edit (.storytree-check) is not the user's work.
    [[ $a == "EDIT .storytree-check" ]] && continue
    [[ $a == EDIT* && $first_edit -eq ${#acts[@]} ]] && first_edit=$i
    [[ $a == *"st:report [completed] result=red"* && $red -lt 0 ]] && red=$i
    [[ $a == *"st:report [completed] result=green"* && $green -lt 0 ]] && green=$i
    [[ $a == EDIT* && $red -ge 0 && $green -lt 0 ]] && edit_after_red=1
  done
  before() { for ((i = 0; i < first_edit; i++)); do [[ ${acts[$i]} == *"st:$1 [completed]"* ]] && return 0; done; return 1; }
  has() { grep -q "st:$1 \[completed\]" "$f"; }
  yes() { "$@" && echo yes || echo no; }
  score=0
  row=""
  for h in "check_setup first:$(yes before check_setup)" "story planned first:$(yes before plan_story)" "claimed first:$(yes before claim)" \
           "red, change, green:$([[ $red -ge 0 && $green -gt $red && $edit_after_red -eq 1 ]] && echo yes || echo no)" \
           "landed:$(yes has land)" "closed out:$(yes has close_out)"; do
    row="$row | ${h#*:}"; [[ ${h#*:} == yes ]] && score=$((score + 1))
  done
  echo "| $label${row} | $score/6 | $(grep -c 'st:' "$f") |"
done
