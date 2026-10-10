# winhooks-2 — first session skips check_setup on a short task (increment_4da0889b672f)

A first session in a folder that isn't a storytree project, given a short task, made the file and
never called check_setup, so the user was never asked (acceptance: `packages/app-setup/evidence/acceptance/output/claude-1.txt`, `codex-1.txt`).

Now the session-start hook puts the setup question in the agent's context before its first turn,
the way 0.2 put its SessionStart heads-up there (`hookSpecificOutput.additionalContext`, e.g. 0.2's
`packages/cli/provision-worktree.mjs`). Claude Code's existing start hook runs in the background,
whose output would arrive a turn late, so Claude Code gets a second, foreground start hook
(`--ask-setup`) that only reads the folders above for a marker and prints; it writes nothing.
Codex waits for all its hooks, so its existing start hook prints the question; its registered line
is unchanged, so a user who already trusted Codex's hooks is not asked again.

- `red.txt`: 8.12 failing (no start hook the harness waits for says anything).
- `hook-output.txt`: the built hook's actual output in an empty folder, and why no live `claude -p`
  run was possible on this box (standalone `claude` is not signed in here).

Retest must check (live, on the laptop): Claude Code `claude -p "Create a file named hello.txt containing the word hi."`
in an empty folder asks whether to set storytree up; Codex the same, after its hooks are trusted
(Codex runs a new hook only once the user approves it, so a Codex session whose hooks are not yet
trusted still depends on the model calling check_setup).
