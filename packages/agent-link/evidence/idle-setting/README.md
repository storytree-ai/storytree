# Idle setting

Increment `increment_d083c638c3ec`, arc `arc_748792ea3487`.

Context guidance defaults to 600,000. `idle-after` defaults to `30m` and controls Node session and
claim readings, locked takeover, the MCP server on each call, and the status line's shared-file
window. The CLI and gear save positive durations and refuse invalid values without changing the
file. Settings show lists every reading returned by readSettings.

The shared algorithms now live in browser-safe readings.ts, with an optional quietMs and a
30-minute default. Node wrappers supply the current setting. **Known limit:** the forest display
keeps the 30-minute default; its bridge is outside this lane and the supervisor will park that step.

- `red.txt`: original observed failures after pushing red commit `283cd42`.
- `red-relaunch.txt`: observed session, live-MCP and settings-show failures before the remaining fixes.
- `green.txt`: contract 10.10 and the offline CLI checks pass, including live-server setting changes.
- `verification.txt`: complete local verification summary and test scope/table.
- `typecheck.txt`: full workspace typecheck.
- `test-ratio.txt`: informational report, not a gate.
- `capture.mjs` / `capture.txt`: headless checks of real gear/settings components with real writers
  and a throwaway home. No live library is involved.
- `settings-default.png`, `settings-saved.png`, `settings-refused.png`: component captures for review.
- `library-update/`: supervisor-applied patch and checklist matching this implementation.

`partial-green.txt`, `held-liveness.txt` and `typecheck-final-agent-link.txt` retain the previous
run's evidence. They are historical, superseded by the green and verification logs above.
Component captures are not native desktop smoke or owner appearance acceptance; those remain
with the laptop supervisor. No live-store query, claim, decision or question was made by this lane.
