# Pending library update — full-width arc bar

The laptop supervisor applies [changes.patch](changes.patch) after merge to **The arc surface**
(`story_7722ddb5461e`), capability **3 · Arc surface** (`capability_d077e76e50d7`).
The supplied `2026-09-28T07-26-00-491Z.json` snapshot was restored into a throwaway
`STORYTREE_HOME` and these records read using the 0.3 CLI from a scratch project folder.
The patch identifies library fields, not repository files. It normalizes CRLF in the displayed
diffs only; preserve the current records’ IDs, other fields, shelf links, and newer edits.
No live store was read or written by the lane. No new contract is needed: 3.1 owns this control.

- [ ] Update `capability_d077e76e50d7` — `description`.
- [ ] Replace `contract_f64050164f89` — `title` (3.1).
- [ ] Update `definition_d40b09a10211` — `meaning` (as built).
- [ ] Update `definition_d7bec65ac642` — `meaning` (historical and current proof).
- [ ] Read back every edit; preserve existing shelf entries.
- [ ] Record the in-place ADR-0660 note below through the supervisor’s authorized route.
- [ ] Take the two captures to the owner; the lane has not accepted the appearance.
- [ ] Close `increment_fa17cbd8b666` on `arc_4461095a1ab3` after merge using `/tmp/arc-bar-close.md`.

No decision or question record is created by this patch. Agent-role curation had nothing to do.

## ADR-0660 note for the supervisor

Owner-directed 2026-09-28: ADR-0660 D1’s centred top-edge handle clause is narrowed to a
full-width bar spanning the top of the window from its left edge up to the app’s top-right
gear. Clicking the bar opens and closes the same drawer; Escape also closes it. The bar
reserves one top strip, with the forest and its controls below it, and the drawer opens below
that strip. Drawer contents, work states, persistence, live-reading rules and read-only
behaviour remain as built; pointer input reaches the forest below the closed bar or open
drawer. Appearance remains subject to the owner’s review of the captured closed and open
states. This note changes the handle clause in place; it does not supersede ADR-0660.
