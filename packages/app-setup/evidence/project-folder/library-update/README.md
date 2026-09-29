# Pending library update — the installer asks for the project folder (increment_03faf35c540d)

The laptop supervisor applies [changes.md](changes.md) after this PR merges. The snapshot this lane
could read (2026-09-28T13-42) predates contract 8.12 and ADR-0752, so the current text of each
record is authoritative: read it first and apply the meaning below, keeping ids, health and links.

- [ ] Re-pin agent link 8.12 (`contract_4235a285f886`) to the new title in changes.md: silence, not a question.
- [ ] Re-pin agent link 8.4 (`contract_9b9f96ef9ac4`): check_setup names the folder as not a project and the three ways to add it, and does not tell the agent to offer setup.
- [ ] Re-pin app setup 1.3 (`contract_d6bc20be3fdd`): a repeat in a folder already a project says so and creates nothing.
- [ ] Add app setup 1.7 on capability 1 · Get storytree (`capability_790ee7f22546`): the installer's project folder step. Its test is `packages/app-setup/src/deliver/bootstrap.test.ps1` (via `bootstrap.test.ts`) and `packages/app-setup/src/project/project.test.ts`.
- [ ] Read agent link 8.6 (`contract_d4824c7d28c5`, the live check "set storytree up when answered yes"): its setting-up step now happens in the installer or on the user's own request; reword it as in changes.md or raise it with the owner if its meaning is his call.
- [ ] Leave app setup 3.1 and 3.3 to increment_14f177725450 (Add project from the app), which re-pins 3.3.
- [ ] Decision log: ADR-0752 records the owner's "go with D". Where ADR-0626 D5 or the decision behind PR #211 says the session-start hook has the agent ask, leave an in-place note pointing at ADR-0752 D3.
- [ ] Close increment_03faf35c540d from `/tmp/projfolder-close-increment_03faf35c540d.md`.

No library, plan, decision, question or claim was written by this lane.
