# One gate command

ADR-0716 / `increment_bc6346078e4d`, as supplied in the lane brief: `pnpm gate`
runs typecheck, the existing scoped test runner and applicable guidance verification in the
foreground. It continues after ordinary failures and prints every check's outcome using the
test runner's table formatter. An interrupt exits 130 and leaves unfinished checks NOT RUN.

Generated role changes trigger guidance verification. A hand-written CLAUDE.md header edit
alone does not. Library-only role/note changes cannot be discovered through Git: use
`pnpm gate -- --guidance` after those edits. An ordinary code change reports guidance as
NOT RUN with that explanation and can succeed; an unreadable change list checks guidance
conservatively. Guidance failures remain failures, including an unavailable library.

- Red: commit `f001c36`; [red.txt](red.txt) records
  `flock /tmp/storytree-heavy.lock node --test scripts/gate.test.mjs` failing because the gate
  did not exist. The red commit was pushed before implementation.
- Cancellation red: commit `f7b20c9`; [red-cancellation.txt](red-cancellation.txt) shows a real
  compiler descendant surviving cancellation. The fix sends interruption to the whole process
  tree, with a second signal forcing termination; it does not detach a background gate run.
- Focused verification: `node --test scripts/gate.test.mjs scripts/test-scope.test.mjs`.
- Full verification: `pnpm typecheck`, `pnpm test` and a real `pnpm gate`, each under the shared
  heavy-work lock. The root script changes select the full test scope.
- [Library patch and supervisor checklist](library-update/README.md).
- [Role Check step replacement](role-update.md). The supervisor edits the live library and
  regenerates guidance after this PR merges; this lane changes only CLAUDE.md's handwritten head.

Behavioral reference, read only: 0.2's `packages/cli/src/gate-runner.ts` (sequential steps,
continuation after failure, one summary row per step and interruption) and
`packages/cli/src/gate-order.ts` (guidance was unconditional there). The conditional guidance
rule comes from this increment. The background handle and 0.2's broader gate checks are outside
the expressly chosen three-check scope. No 0.2 implementation was copied.

The supplied snapshot predates ADR-0716; the read-only 0.2 lookup did not contain it, and its
linked measurement artifact was inaccessible. The lane uses the verbatim spec rather than
inventing measurement figures or additional omissions.
