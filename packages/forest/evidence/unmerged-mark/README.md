# Sessions list: the unmerged-work mark and the leave-after setting (ADR-0754 D4, ADR-0758 D5; forest 7.12)

The real desktop page (built by `../sessions-list/build.mjs`) with synthetic activity, the user's leave-after setting
read as 3 hours. `capture.mjs` renders it; run both through `flock /tmp/storytree-heavy.lock`.

- `marked-list.png`: the header says 2, both at work, each marked "Holding unmerged work" with its branches (the
  builder's own branch; a waiting session's two). Three quiet sessions fold into "3 idle".
- `marked-idle-open.png`: "3 idle" opened: a session quiet three hours that never closed out, its branch unmerged
  and marked; a session quiet two hours with nothing unmerged, listed because the setting is 3 hours (the 1-hour
  default would drop it); and a desktop window finished four hours ago and not archived, counted as idle.
