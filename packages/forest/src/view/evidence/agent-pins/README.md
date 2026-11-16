# Agents' pins drawn on the map, near and far (contract 3.119)

Mick, by voice 2026-11-15 (voice.note_8e6d9afde11a): "when you zoom out, you can still see that inside that package there is a
caching layer. It's just pinned." And on noise (question_82b15d496b5b): preset icons, not free text, carry the signal.

What this draws: each place the map draws (a capability's territory, a part of the capability opened at the parts level, a
shared store's slab) carries a small mark, just above its name, of the pins it holds: its own, and those of its parts while
they are not drawn. Near, each pin's icon and label; zoomed out, each icon once and how many pins. A pin whose anchor no longer
resolves in the code (map 9.2) is greyed, its icon dashed, and says "stale"; it is never moved. A pin on a capability an
imported island groups into a top part stands on the top part, and on the capability once the top part opens.

The library's island alone, from a fresh seed and survey (as nested-parts'), with a stand-in store beside it. Five pins: on
13 · Decision log, a cache on its part `src/commands`, a setting on the capability, a job on a part gone from the code (stale);
an api on another capability; one on the store's table.

Counted from the page (`after-measurements.json`):

| view | Decision log | its part `src/commands` | the other capability | the store |
|---|---|---|---|---|
| far (0.7 × near zoom) | cache config job, 3, 1 stale | rolled up | api, 1 | store, 1 |
| near (2 × near zoom) | Search results cached · Library settings · Nightly reindex (stale) | rolled up | Public read routes | Every record |
| opened (parts level) | Library settings · Nightly reindex (stale) | Search results cached | Public read routes | Every record |

Taken by `node --import tsx packages/forest/testing/view/agent-pins/capture.mjs after` (append `--retake` to write here).
