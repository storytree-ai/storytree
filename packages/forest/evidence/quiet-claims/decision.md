# Decision text for the laptop supervisor to record

Status: owner-directed, accepted 2026-09-28; pending recording in the live 0.3 library. Assign the next decision number there. This file is a handoff, not a created decision record.

Title: Quiet capability claims on the forest

Front cover: forest capability 5, Agent capability claims (`capability_efa4328b624c`). Narrows ADR-0626 D4's display clause; retains its missing-hook substance.

## Direction and force

The owner directed this change on 2026-09-28 after the forest showed three identical red banners for one supervisor holding three capabilities. The supplied increment records his direction: “a claim draws a small dot at the capability's tree, no text”; “the hooks-not-running flag leaves the map and is reported by the agent link's setup check”; “a hookless holder is still never faded as idle.” The repeated labels and plumbing warnings obscured the work locations.

## Decision

Each standing capability claim is drawn on the forest as a small dot at that capability's tree. It shows no agent name, claim reason or hooks warning. Claim records still carry the holder and reason; their display is the change.

The setup check owns missing-hook diagnosis. Its existing contract 8.5 (`contract_b6947fd6924d`, capability `capability_199d7af33d32`) requires the missing hooks and their fixes. `verifyHooks` and `check_setup` already report these; no second diagnosis is added to the forest.

A holder whose hooks have reported still fades after the quiet time. A holder with no hook line is never faded as idle. Landing, release and session end still remove claims according to the existing readings. A dot carries no capability health or state and never changes how the tree's state is drawn.

This narrows only ADR-0626 D4's location of the warning. User-level hook registration, Codex's approval, verification before real work, and the rule that absent instrumentation must never imply inactivity remain in force. The running-sessions list and context bars are other increments on the owning arc and are not built by this decision.

## In-place annotation for ADR-0626 in the 0.3 library

Target: `decision_49f698bd6e83`, field `text`, the paragraph below. Exact old text is from the supplied read-only 0.3 snapshot. Compare with live before editing. Do not edit the frozen 0.2 store.

Old:

> Codex gets the same two layers as Claude Code, through user-level hooks and Codex's one-time approval. Until a session's first hook line arrives it is flagged "hooks not running", so a missing hook never looks like an agent doing nothing.

Replace with:

> Codex gets the same two layers as Claude Code, through user-level hooks and Codex's one-time approval. Missing hooks and their fixes are reported by the agent link's setup check. Until a session's first hook line arrives, its forest claim dots are never faded as idle; the map draws no hooks warning. A missing hook never looks like an agent doing nothing.
>
> Annotated 2026-09-28 by the accepted decision “Quiet capability claims on the forest” [supervisor: insert assigned ADR number]: this narrows D4's display clause only. The owner directed small dots without agent names, reasons or hooks warnings on the map. Setup check capability 8 retains the diagnosis; the missing-hook non-idle rule and all hook setup and verification requirements remain in force.

## Full D4 wording, for the supervisor's reference

The frozen 0.2 reference was read with `storytree library artifact adr-0626 --full`. Its D4 currently reads:

> **D4: Codex gets the same two layers as Claude Code (option E1, approved).** The setup check registers USER-level hooks with a fixed command, which avoids both the worktree-skipping bug and repeated re-approval, and walks the user through Codex's one-time approval in the terminal. Until the first hook line arrives, the session is flagged "hooks not running". A missing hook must never read as an agent doing nothing.

If the live 0.3 record has since gained this full wording, replace its last two sentences with:

> Missing hooks and their fixes are reported by the agent link's setup check. Until the first hook line arrives, the session's forest claim dots are never faded as idle; the map draws no hooks warning. A missing hook must never read as an agent doing nothing.

Append the same dated annotation above. This handoff authorizes no write to the frozen reference.
