# Library update preserved when main removed its source files

While PR #120 was in CI, main merged #118 (`2717808`): the owner's live 0.3 library
became the one copy of stories and decisions, and `stories/`, `decisions/` and
`pnpm seed:library` were deleted. This landing keeps those deletions.

These files are **read-only landing evidence**, exported from this lane's reviewed
`6460b9c` commit, not new repository sources or a replacement library. The exact
[changes.patch](changes.patch) records its changes against the last file-backed main.
The completed isolated seed and browser evidence remain valid at that commit.

The supervisor must apply the corresponding blocks to the authoritative 0.3 library:

1. File ADR-0658 uniquely as a front cover of knowledge-core capability 1, with the
   text in `decisions/knowledge-under-islands.md`; retain the founding book already on
   that shelf (the retired seed's front-cover bug is described in #118).
2. Apply the narrowed ADR-0647 / ADR-0655 prose to their existing library artifacts.
3. Update knowledge-core capability 1's as-built text and contracts 1.5/1.6, and
   forest capability 3's composition/evidence lines. Correct the stale Look-inside
   mounting clauses and preserve the clearly labelled historical measurements.

The live 0.2 plan's arc intent and ADR-0647 page-entry annotation were already
corrected and read back by the librarian. These 0.3 updates need the app library
that #118 migrated; this Mint lane's default app home has no `storytree` project.
No fresh library was invented at that path and no owner's snapshot was replaced.
