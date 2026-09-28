# Context guidance also nudges Claude Code to start fresh

The prompt hook now adds advice to hand off and start a fresh session at the next safe boundary
when a Claude Code session's reading is past its current `context-guidance`. It names tokens
used and guidance, exits 0, and emits only `additionalContext`. Advice is **once per session**,
remembered across separate hook processes using the definitions ledger pattern, with its own
ledger. Later prompts do not repeat it, even after crossing the guidance again.

Codex receives no nudge. Under or at guidance, absent readings, unreadable transcripts/settings,
and stopped storytree add none. Definitions still appear alongside advice and keep their own
once-per-session tracking. The hook's existing timeout and harness-notice filter remain.

The hook calls the existing context reader: no second threshold, default, or switch is added.
The initial green capture shows the then-current default of 700,000. The sibling settings lane
owns its change to 600,000; the boundary test reads the setting instead of pinning either number.
Its independent set-value case proves changes are read afresh. Unreadable settings can already
stop routing before a reading is reached; this feature adds no advice in that case and does not
resolve the context command's separate 9.7 routing limitation.

- [red.txt](red.txt): failure after pushed test commit `5e3c9eb`; missing advice is the failure.
- [green.txt](green.txt): all built-hook tests pass, with actual hook output captured as test
  diagnostics. Fixtures are recorded harness inputs; transcript paths, sessions, prompt text
  and usage are controlled for this test. This is a replay, not a new interactive agent run.
- [gate.txt](gate.txt): typecheck and the test runner's scope/result table.
- [test-ratio.txt](test-ratio.txt): increment-boundary report, including its `all` row.
- [library-update/README.md](library-update/README.md): patch and supervisor checklist.

Only `src/hooks/` implementation/tests and this evidence folder were edited. No new setting,
context-reading field, decision, question, or live library write was made. There were no owner
resteers or durable friction items to file, and no decision-log/role curation was needed.
