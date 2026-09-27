# storytree 0.3: guidance for its own development

This file is for agents developing storytree 0.3 itself; users' projects get the agent link's habits
card instead. Everything below the generated region's first marker comes from the agent roles in
this project's library (ADR-0636 D1); edit those, not this file, then run `pnpm build:guidance`.
The text above that marker is written by hand, and it counts toward the file's 40,000-byte budget.

- A fresh or stale worktree is installed at session start (`scripts/provision-worktree.mjs`).
- `pnpm test` runs every test against a throwaway local Postgres; `pnpm typecheck` checks types.
- `pnpm check:guidance` says whether this file, AGENTS.md and the role files match the library.

<!-- storytree:guidance START: generated from the library's `session-orchestrator` agent role; do not edit by hand. Regenerate with `pnpm build:guidance`; `pnpm check:guidance` fails when this file has drifted from the library. -->

The library holds no `session-orchestrator` agent role yet, so there is no guidance to generate here. What 0.3's own agents are told is the owner's call (ADR-0633 D1): it is written into the library as agent roles and principles, then generated into this file.

<!-- storytree:guidance END -->
