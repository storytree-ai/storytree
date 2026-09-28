# Quiet claims: supervisor library update

This is a patch for the laptop supervisor to apply to the live 0.3 library, not a file-tree patch or a record that has already been applied. Exact old fields and record ids come from the read-only snapshot `2026-09-27T14-03-38-576Z.json`. No live library was read or written by this lane.

`changes.patch` amends the forest's capability 5 (`capability_efa4328b624c`):

- Description: quiet dots, hookless holders never faded, missing-hook diagnosis owned by the setup check.
- 5.1 (`contract_981ada25d50e`): labelled marker → small dot at the claimed capability's tree, no visible agent name or reason.
- 5.2 (`contract_c21f6ee3bb69`): quiet-time fade explicitly applies only after a holder's hooks have reported; landing removes its dot.
- 5.3 (`contract_ac5d2e1c14df`): map warning → unfaded hookless dot, no map warning.
- Story text (`definition_436891b5b577`, `definition_7c841c6b4298`): retain the missing-hook rule and update the as-built account.

5.4 (`contract_772f3265a55e`) remains unchanged: claims never change how capability state is drawn. No new contract is needed in the agent link: setup check 8.5 (`contract_b6947fd6924d`, capability `capability_199d7af33d32`) already requires every missing hook and its fix. The existing implementation is `packages/agent-link/src/setup/verify.ts` and its answer in `packages/agent-link/src/tools/setup-tools.ts`.

Proof plan authored before implementation: the forest reading test retains one marker per live claim and checks hooked-holder fading, hookless-holder non-fading, and removal after landing. A rendered Claims component check asserts one small dot at each claimed tree and the absence of visible agent/reason/warning text. A reproducible headless Chromium capture witnesses the resulting dots. Evidence of the implementation and actual runs belongs in the surrounding evidence directory; this patch itself makes no claim that those runs passed.

Supervisor checklist:

- [ ] Compare each old field with the live record; reconcile any intervening edits without overwriting them.
- [ ] Apply the six field edits in `changes.patch` using the library API/CLI.
- [ ] Read back all six fields and retain their ids; confirm 5.4 and setup check 8.5 remain intact.
- [ ] Record the owner-directed accepted decision in `../decision.md`, assign its number, and link it as a front cover of forest capability 5.
- [ ] Apply the in-place ADR-0626 annotation from `../decision.md` in the 0.3 library; do not write to 0.2.
- [ ] Confirm the as-built text against the merged implementation and evidence.
- [ ] Close increment `increment_5c4411d39cbf` after the PR merges, with its outcome and PR number; release the supervisor-held claim.

All checklist items are intentionally pending: this build lane cannot reach the laptop library.
