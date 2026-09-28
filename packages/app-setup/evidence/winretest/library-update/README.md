# Pending library update: connect registers the chosen agent's hooks

The laptop supervisor applies [changes.patch](changes.patch) after merge. Paths address library fields,
not repository files. Read the current record first: winhooks-3's patch
(`packages/app-setup/evidence/winhooks-3/library-update/`) edits the same description.

- [ ] Capability 2 · Connect an agent (`capability_01dc27eec57f`) `description`: append the paragraph in the patch.
- [ ] Contract 2.2 (a new session in the folder reaches its setup check) keeps its meaning; it is now also
      proven for the first session after install by `packages/app-setup/src/connect/connect.test.ts`
      "2.2: connecting registers the chosen harness's hooks, so its first session's start hook already runs".
      Agent link contract 8.12 (the first session is asked) now holds from the very first session.
- [ ] Found by the Windows retest, round 1: `packages/app-setup/evidence/acceptance-retest/round-1/claude-1.txt`
      (on the retest evidence PR): the first session after a fresh install created the file without asking,
      and `claude-2.txt`, the next one, asked.
