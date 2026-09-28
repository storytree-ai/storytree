# winhooks-3 — a disconnected harness gets its hooks back at the next setup check (increment_4e7ec8605d86)

`storytree setup disconnect codex` removed Codex's tool server entry and `~/.codex/hooks.json`, and the
next Claude Code session's setup check wrote the hooks back, because the check registers for every
harness home it finds.

Chosen fix: disconnect records the harness in the storytree home (`disconnected-harnesses.json`);
the setup check registers no hooks for a recorded harness (reported as `disconnected`); Connect
removes the record. Not chosen: registering only for a harness whose settings name storytree's tool
server, because Claude Code can hold that entry in user, local or project scope, or a plugin, and a
missed one would silently stop hooks for a connected user. Also not chosen: letting a session of the
disconnected harness clear the record, since a session still open after Disconnect (which says to
restart the agent) would undo it. A user who reconnects by hand rather than through the app's
Connect gets hooks back with `storytree setup connect --claude|--codex`, which runs the same Connect;
`storytree doctor` names the fix.

- `red.txt`: the new 2.5 test failing (Codex's hooks written back).
- `green.txt`: the full run, every unit PASS.
