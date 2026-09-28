# Running sessions, bottom left

Increment `increment_31db1e015047`, arc `arc_895e232031b0`. The forest owns the list because it explains activity on the map and links sessions to their islands; the desktop only mounts the view and stylesheet.

The list shows one row per non-ended session, with claim words, an empty context slot and an available total. Recorded children start folded under `+N`. Only `needs you` has a state colour; a folded child's open owner question remains visible on its parent. Hover and keyboard focus brighten the held islands, including descendants' claims, and dim the other islands; leaving restores their original materials. Selection and health stay independent.

The separate Unclaimed work box is replaced by each session's `off plan` file count and expandable, timestamped edit/command evidence. File counts are distinct paths; claimed edits never enter this evidence. Idle sessions remain plain; ended sessions and their old evidence are hidden, pending the owner's look.

## Evidence

- [Default list](sessions-list.png)
- [Hover linked to islands](sessions-list-hover.png)
- [Expanded children and off-plan evidence](sessions-list-expanded.png)
- [Chromium assertions and renderer](capture.json)
- [Red test run](red.txt), committed and pushed as `8109cb1` before implementation; rerun after the push failed on the same missing sessions reading.
- [Green gate](green.txt): typecheck and full tests passed. Scope is full because the forest manifest exports the stylesheet. Guidance is NOT RUN because no agent roles or their supporting guidance notes changed. Platform-only and live-cloud skips remain visible in the log.

The capture uses the actual desktop renderer, a prior read-only forest snapshot and explicitly synthetic agent activity/arc questions. It checks row deduplication, initial child collapse, expansion retention, off-plan files and commands, empty bar slots, unavailable totals, idle/ended policy, the sole coloured state, real material hover/focus/restore, live question settlement and live child end. It is behavioural evidence, not owner visual acceptance.

```sh
flock /tmp/storytree-heavy.lock node packages/forest/evidence/sessions-list/build.mjs
flock /tmp/storytree-heavy.lock node packages/forest/evidence/sessions-list/capture.mjs
flock /tmp/storytree-heavy.lock pnpm gate
pnpm test-ratio
```

`PLANET_PLAYWRIGHT` and `PLANET_CHROMIUM` override the capture's Mint-local defaults. Generated bundles stay in ignored `dist/`.

Test-ratio all row (test code lines, implementation code lines, ratio):

```text
  all                       41,833           33,586    1.25
```

## Public data seam and supervisor handoff

Current `@storytree/agent-link/readings` supplies sessions, claims, attribution and explicit `subagent-started` parent/child links. A child with no independent session reading is labelled observed in its tooltip; the API has no subagent-end event. Unrecorded supervised-lane relationships are not guessed from task words, folders or timing.

The current public API has no context-total reading or separate supervisor metadata. `mountSessionsList().showDetails()` accepts per-session `{ parentSession?, totalTokens? }` facts for the later integration. Production totals therefore show an unavailable dash today. Tests demonstrate supplied totals, including observed children; there is no second reader, transcript parsing, composition or threshold drawing. Completing those production inputs requires the agent-link work outside this lane's file fence.

[Library field patch and checklist](library-update/README.md) adds forest capability 7 and amends capability 6 and stale as-built references. Story-author authored it before implementation and reviewed it against the result. No live store, claim, decision or question was written; application and increment closure remain with the laptop supervisor. No decision or agent-role curation was needed.

For the owner's later look: confirm the idle/ended policy and the off-plan presentation. The shaping mock was unavailable; this evidence does not settle either. Context composition and per-row bar integration remain the later increments already on the arc, so this lane starts no successor.
