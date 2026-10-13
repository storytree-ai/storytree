# Pending library update — Settings panel

The laptop supervisor applies [changes.patch](changes.patch) after merge to **The agent
link**, capability **10 · Settings** (`capability_2902dfd80083`). Record IDs and original
text come from the read-only `2026-09-28T07-26-00-491Z.json` snapshot. Paths identify
library fields, not repository files. App amendments use #179’s gear patch plus #181’s
updates patch as their base, because that wording postdates the snapshot. Apply those first
if still pending. `contract 2.7 (resolve existing ID)` is a title selector, not an invented ID.
Read current records first, preserving intervening
edits, IDs, other fields and shelf links. No live store was accessed by this lane.

- [ ] Append the Settings panel “As built” paragraph to the capability description. Preserve
  the existing library-location paragraph and any later settings additions.
- [ ] Add the three `ADD contract under capability_2902dfd80083` entries, numbered 10.7–10.9
  in this snapshot; check the live numbering first. Existing 10.5–10.6 cover library location.
- [ ] Amend the gear's pending library text from #179: Settings now opens the agent link’s
  panel and returns focus to the gear. Update `capability_3c5ed8b3ca70.description`,
  `definition_b7178be85573.meaning`, and the live contract 2.7 (its ID did not yet exist in
  this snapshot). Change only the Settings reservation; preserve the sibling updates lane.
- [ ] Append this panel’s capture/interaction evidence to `definition_4d85e83c5135.meaning`
  if the supervisor keeps the app’s mounting proof there.
- [ ] Read back all edited fields and new contracts; verify shelf entries remain.
- [ ] Take the four [captures](../README.md) to the owner. This lane has not accepted the look.
- [ ] Close `increment_c9c15aad51b2` on `arc_748792ea3487` using the merged PR and
  `/tmp/settings-panel-close.md`; release the supervisor-held claim as appropriate.

No decision, question or role changed. Decision-log curation had nothing to do.
