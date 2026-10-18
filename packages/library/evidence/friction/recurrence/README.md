# Recurrence ranking evidence

Increment: `increment_01aa9291b333`. New behavior chosen by the owner in ADR-0716 F3; no 0.2 measurement is claimed.

`red.txt` records pushed red `2070df6`, where the drain still returned the oldest three. The amended contract 5.2 test proves recurrence ranking before the three-item limit, oldest-first ties, zero for missing recurrences, anonymous reports remaining eligible, and exclusion of own-branch and already-routed reports even with larger counts. Routing the highest-ranked item reveals the next eligible item.

Library update: `../library-update/recurrence.patch` and its checklist, including the supervisor's in-place curation of the founding decision's older ordering clause.
