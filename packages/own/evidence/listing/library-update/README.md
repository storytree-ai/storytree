# Supervisor application checklist

Story: `story_9abd84ab493f`; capability: `capability_611029207d9a`; increment:
`increment_5df7e7b316ab`; arc: `arc_197b9208adfc`.

- [ ] Apply `changes.patch` to capability 3's description in the laptop's 0.3 library.
- [ ] Preserve the six approved contracts; their record IDs were not supplied and the snapshot
      predates them, so this patch neither duplicates nor changes those contracts.
- [ ] Keep capability 3 partly built. Installed CLI/MCP front doors, default shared-app acquisition
      and an installed stop action remain integration work; this landing is the inventory API.
- [ ] Record the remaining integration on the increment/arc using `../README.md`'s bounded hand-off.
      Do not close the whole increment as landed on this API-only PR.
- [ ] Native source-level inventory is verified by the platform CI matrix. Installed native
      bundles and Windows arm64 are not proven by this PR.

The patch adds as-built and remaining-work paragraphs to the verbatim capability description
from the lane brief. No live store, snapshot restore, claim, decision or question was touched.
The supervisor owns application and increment closure.
