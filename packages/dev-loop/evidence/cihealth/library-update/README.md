# Pending library update — CI records own health

The laptop supervisor applies [changes.patch](changes.patch) after merge. It is an old → new text
patch against the supplied `2026-09-28T21-35-29-644Z.json` snapshot, read straight from the file
(read-only). The lane has not written to either live store. Record paths identify library fields,
not repository files. Read the current records first; keep IDs, other fields, shelf links and any
change made since the snapshot.

- [ ] Append the CI "As built" item to `definition_0c86fce863cf` — `meaning` (The library,
      capability 5 · Health record, the capability ADR-0744 is the front cover of).
- [ ] Append the follow-the-setting note to `definition_35a9bf6d841b` — `meaning` (The app,
      capability 4 · Updates, contract 4.3).
- [ ] Read back both records.
- [ ] Decide, or ask the owner: ADR-0744 D3 says CI's run *replaces* the hand run. The app's own
      4.3 run (laptop, following main) now also writes the shared library, as `storytree test run`.
      Two writers of one column can disagree (a Windows-only failure against Linux CI), and the
      card then shows whichever wrote last. Keep both, or retire 4.3's recording once CI's run is
      live? That is the app lane's contract (`packages/app`), so this lane did not touch it.
- [ ] After the owner has applied `infra/ci-health` (its README, steps 1-4): run the workflow on
      main and confirm entries by `storytree test run on CI` arrive, with the commit in each note.
- [ ] Close `increment_8137094ea0aa` on `arc_48a2bfc7fdbe` using `/tmp/cihealth-close.md`.

No new contract: the recording lives in the repository's `scripts/` and CI, not in a story's
package, so a contract for it would have no package tests to verify it (it would read not checked
for ever). No decision or question is created by this patch.
