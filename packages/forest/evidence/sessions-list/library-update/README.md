# Library update for running sessions

This is a patch for the laptop supervisor to apply to the **0.3 library**, after checking the landed implementation. Nothing here has been written into a live plan store. The old sides come from the read-only snapshot `2026-09-27T14-03-38-576Z.json`; reconcile any later laptop edits before applying.

The forest owns this capability (`story_deee4230348c`, package `packages/forest`). Its journey is seeing who is working on the forest’s islands and identifying work outside claims. Hovering a session addresses those islands directly. The app and desktop remain thin mounts. The new capability depends on forest rendering, claim-to-island readings and off-plan attribution; existing capability 6 does not depend back on capability 7.

`changes.patch` follows the field-by-field unified-diff convention. Its `+++ new/The forest/...` paths are library field addresses, not repository paths. Repeated `ADD capability under story_deee4230348c` entries are fields of **one** new capability. Each repeated `ADD contract under NEW_RUNNING_SESSIONS_CAPABILITY/title` hunk creates one distinct contract; substitute the capability id obtained on creation. Do not treat this file as a filesystem patch.

## Supervisor checklist

- [ ] Compare snapshot old text against the current library; preserve unrelated later edits.
- [ ] Create capability **7 · Running sessions** under `story_deee4230348c`, using the three ADD capability field hunks. Confirm that 7 remains the available number.
- [ ] Link the capability to the existing owner direction for arc `arc_895e232031b0` / increment `increment_31db1e015047`. This lane creates no decision record. The supervisor must provide the founding decision association if the plan writer requires it.
- [ ] Substitute the created id for `NEW_RUNNING_SESSIONS_CAPABILITY`; add contracts 7.1–7.5 in order.
- [ ] Amend capability 6 and its three existing contracts, retaining their ids.
- [ ] Apply the amended capability-6 as-built text only after verifying the implementation and evidence. Update the four placement/naming definition records included in the patch so the old separate-box text does not remain authoritative.
- [ ] Apply the capability-3 as-built correction (`definition_5126fe37ac57`): the desktop now imports `mountSessionsList` in place of `renderUnclaimed`; retain unrelated current-library changes.
- [ ] Read back every changed field and record the created capability and contract ids on the increment.
- [ ] Close the increment only after the PR merges; this lane does not close it.

## Proof walkthrough

Start with two claimed sessions, one idle session, an ended session, a parent with a recorded child, and a session whose hooks recorded two unclaimed files and a command. The list excludes the ended session and retains the idle one plainly. Expand `+N` to inspect the child. Open owner questions mark only the linked rows and any collapsed parent containing one. Hover and keyboard focus reveal their claimed islands. Expand off-plan evidence to inspect distinct files and the command with their times; a later claimed edit does not join that evidence. The context slots remain empty, display supplied totals, and mark absent totals unavailable. The parent lane supplies red/green tests and headless Chromium evidence; those artifacts, not this prose, establish the result.

## Data gaps and owner look

The current public `@storytree/agent-link/readings` API provides sessions, claims, attribution and `subagent-started` lines. That event explicitly associates its `session` parent with its `subagent` child and optional task. It provides no subagent-ended event; a child without its own session reading cannot truthfully be labelled live or ended. A supervised lane can fold only when an explicit relationship is supplied; matching claim text, labels or timing must not create one.

The current public API exposes **no context-total reading**. The forest accepts an optional per-session total seam for the later agent-link reading and renders an unavailable dash today. It does not parse transcripts, collect context independently, invent zero totals or draw composition segments. Production totals remain unavailable until the agent-link context increment is connected. Demonstrating a supplied total proves the rendering seam, not a production context reader.

For the owner’s later look: confirm whether idle sessions should stay visible and plain, whether ended sessions need a history affordance, and whether the off-plan file count and expandable command evidence explain the former “Unclaimed work” surface. Hiding ended sessions also hides their historical off-plan rows; the underlying activity remains recorded. The v2 mock was unavailable to this lane, and these choices are not a visual acceptance on the owner’s behalf.
