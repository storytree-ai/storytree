# Gate library handoff

Apply after the gate PR merges, in the laptop's live 0.3 library. These are proposals against the read-only snapshot `2026-09-27T14-03-38-576Z.json`, not live-library writes. The patch follows the field-diff format used by `packages/arc-surface/evidence/drawer-shape/library-update/changes.patch`. Its path labels identify the existing process note; they do not assign it to a product story.

`changes.patch` updates the existing **Merge ceremony** (`process_0967b1a1d3cb`) trigger and first step to name `pnpm gate`. The rest of that process stays as found in the snapshot. `../role-update.md` supplies the separate session-orchestrator Check step replacement.

The supplied snapshot has eight product stories and no development/gate story or capability. No product contract IDs or story ownership were invented. ADR-0716 and the supplied increment (`increment_bc6346078e4d`) specify the gate behavior protected by the script tests. No new decision or question is proposed.

Curation result: reviewed **Pre-merge librarian pass** (`process_529c2dd67bbf`), **Merge ceremony**, and the generated session-orchestrator Check step. The CLAUDE.md header edit triggers that pass's curation rule, although a header-only edit does not require the gate's guidance check. The durable change belongs in the existing Merge ceremony and role text, so no new note or memory was created. The live decision log and post-snapshot ADR-0716 are unavailable to this lane; their final consistency check belongs to the supervisor applying this handoff.

- [ ] Compare the two patched process fields with the current live values and preserve intervening edits.
- [ ] Apply `changes.patch` to the named fields of `process_0967b1a1d3cb`.
- [ ] Apply `../role-update.md` to the live session-orchestrator role.
- [ ] Check that the live ADR-0716 and standing guidance remain accurate; this handoff proposes no decision changes.
- [ ] Run `pnpm build:guidance` after all live note and role edits, then run `pnpm gate -- --guidance` and land the generated guidance through the normal PR ceremony.
- [ ] Close `increment_bc6346078e4d` on `arc_197b9208adfc` with the gate PR and the supervisor's guidance follow-up recorded. The lane holds no claims and does not close the increment.

As built: the gate runs typecheck, the existing scoped test runner and applicable guidance verification, then reports their outcomes with the shared table. It continues after a failed check; interruption leaves remaining checks NOT RUN and exits unsuccessfully. `--guidance` covers role/note edits visible only in the live library. An unreadable change scope checks guidance conservatively. No background-run handle is included.
