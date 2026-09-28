# Pending library update — a disconnected harness stays disconnected

The laptop supervisor applies [changes.patch](changes.patch) after merge. Paths address library
fields, not repository files. The app setup story (`story_b91056a06337`) was authored after the
supplied snapshot, so the old text is the connect lane's pending patch
(`packages/app-setup/evidence/connect/library-update/changes.patch`); read the current record first.

- [ ] Capability 2 · Connect an agent (`capability_01dc27eec57f`) `description`: replace "Existing setup behavior is unchanged: subsequent setup checks still register hooks for detected harness homes." with the sentence in the patch.
- [ ] Agent link capability 8 · Setup check (`capability_199d7af33d32`) `description`: append the sentence in the patch.
- [ ] Contract 2.5 (disconnecting one keeps the other and the shared command) keeps its meaning; it is now also proven against the next setup check by `packages/app-setup/src/connect/connect.test.ts` "2.5: a disconnected harness stays disconnected …". If 2.5's title does not already say a disconnect lasts, consider adding: "…and a disconnected harness gets no hooks back from the other's setup check until it is connected again."
- [ ] After merge, close `increment_4e7ec8605d86` using `/tmp/winhooks-close-increment_4e7ec8605d86.md`.
