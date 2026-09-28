# Idle setting — HELD, not landed

Increment `increment_d083c638c3ec`, arc `arc_748792ea3487`.

The branch has the 600,000 context default, duration storage/validation, the gear's duration
control, and the status line's settings-based window. It is **not green**: the session and claim
consumers still need changes outside the lane's file fence. No PR has been opened.

- `red.txt`: observed failures after pushing red commit `283cd42`.
- `partial-green.txt`: 61 selected settings, panel, context, tools, hooks and CLI tests pass.
- `held-liveness.txt`: contract 10.10 still fails (`live` instead of `idle` after setting `10m`).
- `typecheck.txt`: workspace typecheck passed before the final status-line edit.
- `typecheck-final-agent-link.txt`: affected package typecheck after that edit.
- `test-ratio.txt`: informational report, not a gate.
- `capture.mjs` / `capture.txt`: headless browser checks of real gear/settings components in a
  preview page, using the real settings writer and a throwaway home. No live library is involved.
- `settings-default.png`, `settings-saved.png`, `settings-refused.png`: component captures for
  review, not whole-desktop smoke or owner acceptance.
- `library-update/`: partial-progress patch/checklist, explicitly held; do not apply as a landing.

The exact boundary is documented in `/tmp/idle-setting-report.md`. Required consumer edits include
`claims/claims.ts` (read and locked takeover), `tools/server.ts` (per-call quiet time), and
`packages/cli/src/families/settings.ts` (hard-coded settings-show list). The pure browser readings
also need to remain free of Node file I/O: `readings.ts` reexports the same sessions/claims code used
by the forest. Changing shared pure readers to import settings.ts directly would cross that seam.
The supervisor must settle the scope of that plumbing before completion.
