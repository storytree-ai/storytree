# Pending library update — two top bars and settings overlay

The laptop supervisor applies [changes.patch](changes.patch) after merge. It updates
**The app**, capability **2 · Storytree projects** (`capability_3c5ed8b3ca70`), and
**The arc surface**, capability **3 · Arc surface** (`capability_d077e76e50d7`), and
reconciles the existing Settings panel's shared-overlay wording.

The app and arc old text and record IDs come from the supplied
`2026-09-28T09-15-09-235Z.json` snapshot. It was restored into a throwaway
`STORYTREE_HOME` and read using the 0.3 CLI from a scratch directory whose
`.storytree.json` contained `{"project":"storytree"}`. The first decision query was
`adr list --load-bearing`. No live store was read or written, and no claim, decision,
question or increment closure was made by this lane.

Paths in the patch identify library fields, not repository files. Read the current
records before applying; preserve IDs, other fields, shelf links and intervening changes.
Replace the superseded menu/no-app-bar/project-label wording in place so the current
description and “As built” text do not contradict the revised contracts. Earlier proof
is explicitly historical where its geometry has been superseded.

## Reconcile the Settings landing first

The snapshot predates application of the [Settings panel patch](../../../../agent-link/evidence/settings-panel/library-update/changes.patch)
from PR #182. Its app updates may already be applied on the laptop. The new app text
here preserves the live Settings entry and owning-story mount; it must not restore a
disabled entry.

Settings contracts 10.7–10.9 from #182 have no record IDs in this snapshot. This patch
does **not** add them again or invent an ID. Its path
`contract 10.9 under capability_2902dfd80083 (resolve ID from applied settings-panel patch)`
means: find the existing 10.9 under **The agent link**, capability **10 · Settings**;
if #182's library patch is still pending, apply that patch first, then amend its newly
created 10.9. The final Settings description hunk amends #182's “As built” paragraph,
preserving the existing settings description above it. Contracts 10.7 and 10.8 and all
reader/writer semantics remain as landed in #182.

## Supervisor checklist

- [ ] Resolve any unapplied #182 library changes; locate Settings 10.9's existing ID.
- [ ] Replace `capability_3c5ed8b3ca70` — `description`.
- [ ] Replace the app contract titles: `contract_8bb3b4cd424d` (2.1),
  `contract_7fe3a26af563` (2.6), `contract_896cc49b26c7` (2.7), and
  `contract_fcc253dba4c2` (2.8).
- [ ] Amend the app's “As built” and proof meanings:
  `definition_b7178be85573` and `definition_4d85e83c5135`.
- [ ] Replace `capability_d077e76e50d7` — `description`, and
  `contract_f64050164f89` — `title` (3.1).
- [ ] Amend the arc surface's “As built” and proof meanings:
  `definition_d40b09a10211` and `definition_d7bec65ac642`.
- [ ] Amend existing Settings 10.9 and the “As built” paragraph in
  `capability_2902dfd80083` — `description`, as reconciled above.
- [ ] Read back every edited record and verify its shelf entries remain. Confirm no
  current statement says no app bar, a dropdown, disabled Settings, a project-labeled
  arc bar, dismissal passing through to the forest, or a Settings-only focus loop.
- [ ] Take the complete top-of-window captures below to the owner for acceptance.
  The lane has not accepted their appearance, including the settings and updates looks.
- [ ] Close `increment_ab7dfdce93bc` on `arc_2ae8d2ebe1f6` after merge using
  `/tmp/top-bars-close.md`; the supervisor releases the held claim.

## Captures for the owner

- [Closed bars](../bars-closed.png)
- [Arc drawer open below both bars](../arcs-open.png)
- [Projects](../overlay-projects.png)
- [Settings](../overlay-settings.png)
- [Updates](../overlay-updates.png)
- [Help](../overlay-help.png)
- [Settings in a narrow window](../narrow-settings.png)

The evidence route is [capture.mjs](../capture.mjs) and
[electron-capture.mjs](../electron-capture.mjs), using the supplied real snapshot and
`pnpm desktop:smoke`. No decision or question is created by this patch; no decision-log
or agent-role curation was needed. The app frame remounts each story's existing surface.
