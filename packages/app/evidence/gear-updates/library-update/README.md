# Pending library update — check for updates in the gear

The laptop supervisor applies [changes.patch](changes.patch) after merge to **The app**
(`story_a93c6fb1a257`), chiefly capability **4 · Updates** (`capability_6a0c1b26f586`).
The update records were read with the 0.3 CLI from the supplied
`2026-09-28T07-26-00-491Z.json` snapshot (taken at `2026-09-28T07:26:01.685Z`), restored
into a throwaway `STORYTREE_HOME` and accessed from a scratch project directory.
The lane has not read or written either live store and makes no claims or closures there.

Record paths identify library fields, not repository files. Read the current records first;
preserve IDs, other fields, shelf links and changes made since the snapshot. Contracts 4.1–4.6
already exist; the four new contracts start at 4.7. In particular, 4.4–4.6 cover published
release updates and must not be replaced or renumbered.

The gear follow-up hunks use the text in [the gear patch](../../gear/library-update/changes.patch)
from PR #179 as their old side, because that landing postdates the supplied snapshot. Apply that
patch first if still pending. Resolve the ID of its new contract 2.7 from the current library by
the full old title: `contract 2.7 (resolve existing ID)` is a selector, not an invented record ID.
The Settings lane may have changed the same lines; apply only the Check for updates change and
retain whatever the current library says about Settings. Do not turn a landed Settings entry
back into a reserved one.

- [ ] Replace `capability_6a0c1b26f586` — `description`.
- [ ] Append the gear-updates “As built” text to `definition_7ac5d849c326` — `meaning`.
- [ ] Append the new proof to `definition_a6887ae27c30` — `meaning`, after checking the merged
      evidence README, test results and captures support it.
- [ ] Add each of the four `ADD contract under capability_6a0c1b26f586` entries (4.7–4.10).
- [ ] Update only the Check for updates wording in `capability_3c5ed8b3ca70` — `description`,
      `definition_b7178be85573` — `meaning`, and the existing gear contract 2.7 — `title`.
- [ ] Read back every edited record and new contract; verify shelf entries remain.
- [ ] Take the enabled menu and each result capture to the owner for visual acceptance.
      The lane has not accepted the look; record his response separately when it arrives.
- [ ] Close `increment_520384015d37` on `arc_2ae8d2ebe1f6` after merge using
      `/tmp/gear-updates-close.md`, with visual acceptance still explicitly pending if necessary.

No decision or question is created by this patch. No decision-log or agent-role curation is
needed. The existing published-release updater remains separate from this merged-main control.
