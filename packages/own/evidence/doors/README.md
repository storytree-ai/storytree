# Own doors: green scope correction and fenced integration residue

Increment `increment_8d245936227b`, arc `arc_197b9208adfc`. **Partial landing: do not close the whole front-door increment as complete.**

## What lands

- Apply #154's prepared dependency patch to CLI, agent-link and the lockfile.
- Listing refuses self reads with an explicitly unknown agent identity and points to all-session inspection; uncertainty never becomes an empty self reading. Listing shares the stopping API's ownership and conflicting-registration checks. Named subagents cannot see sibling/parent runs as self or receive their stop offers; a session caller retains established multi-hop delegated sessions.
- A behavioral test compares every listing offer against stopOwned's actual per-target verdict for unchanged live fixtures, including conflicting registrations. Existing fixture lifetimes now use distinct PIDs so independent runs do not accidentally claim one native lifetime.
- No CLI family or MCP registration is enabled by this landing. The prepared front-door implementation and its tests are preserved in front-doors.patch.

## Why the doors did not land

The explicit file fence permits CLI, agent-link's tools directory, own scope/exports, manifests and the lockfile. It excludes these required integration surfaces:

1. `packages/agent-link/src/bins/build.ts` builds both the app-installed CLI and MCP. It bundles Koffi JavaScript but does not stage the physical native package. `apps/desktop/tools.mjs` copies that common output into both Windows architecture payloads. A standalone CLI builder fix (inside the fence) is insufficient to ship either installed door. The built CLI red-to-green test reproduced the defect: a live owned child returned incomplete instead of stopped until its standalone native dependency was staged.
2. `packages/agent-link/src/instructions/habits.ts` must teach the three added MCP tools. The full run with the front doors installed passed every unit except agent-link, whose existing contracts 7.1 and 7.3 failed on the unchanged instruction card. See front-doors-preflight.txt. No check was skipped or repinned to hide this.
3. Claude Code's hook-corrected session and named subagent attribution live in the database. The current tools-only fence offers no offline identity handoff. Passing unknown agent as omitted would grant session-wide stopping authority. The prepared MCP door therefore refuses unresolved self/stop calls and retains anonymous all-session inspection. A named Codex agent receives the MCP action only, not a guessed equivalent shell command. The CLI uses its existing shell session identity; any extension to named-agent shell identity needs an established harness signal.

Fence expansions were requested in the lane conversation but not granted before this landing. Both front doors and their tests were withdrawn together, rather than leaving the installed product partially operational. No decision, question, claim or live-library record was written. The supervisor owns the residue and the increment.

## Prepared hand-off

- `front-doors.patch`: thin own family; offline MCP registration; tests exercising the built standalone CLI and in-memory Codex MCP against real native child processes with app/database absent; CLI native staging; and actions that name only the available entry point.
- `instructions.patch`: the required source card addition, outside the fence and **not applied**. Apply alongside front-doors.patch only once ownership is extended. Both patches pass git apply --check against this landing.
- The shared builder/Windows payload staging is still to implement and prove through a built MCP test on Linux/macOS/Windows and both Windows payload architectures. The prepared patch is not a claim of completed installed integration.
- Claude offline identity remains unresolved. Do not recover authority from timing, a synthetic MCP session or a stale server environment. Capability 5’s clearOwned/readClosing API landed in #157 while this PR was starting. No clear door is enabled here; the resumed integration should now wire own clear through that API and preserve removed, retained, failed and gaps separately.
- The standalone CLI patch passes the existing app lifecycle reading into own as explicitly limited/unknown shared work: no invented PID/lifetime, no session stop action, and the app's management command named. Give MCP the same public shared reading when resuming.

## Evidence and library hand-off

- Red commit: `ebe3d2b`, pushed before running the new tests. red.txt records the missing CLI/MCP doors and ownership mismatch. A final review pinned uncertain self identity in pushed red commit `493c346`; red-uncertain-self.txt records the missing refusal before its fix. The PR was held as a draft during this red/green correction.
- front-doors-source-green.txt: eight focused tests passed on Linux after the candidate implementation (before it was withdrawn at the fence). This is source/standalone evidence, not installed-MCP or non-Linux proof.
- front-doors-preflight.txt: full scope and the actual instruction-card failures; passing per-test detail omitted.
- gate.txt and test-ratio.txt: final landed unit's full checks and ratio. Read scope and result tables. Guidance is NOT RUN because no roles or library notes were edited.
- library-update/changes.patch plus its checklist updates the prior hand-offs' capability descriptions while keeping incomplete contracts open. The supplied snapshot predates this story; no contract IDs were invented.

Curation had no decision or durable-guidance change to make. No owner redirection arrived; no re-steer was recorded. The concrete fence failures are retained here for the supervisor, with no store writes.
