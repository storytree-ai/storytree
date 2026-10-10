# Pending library update — the setup question at a first session's start

The laptop supervisor applies [changes.patch](changes.patch) after merge. Paths address library
fields, not repository files. Ids and text come from the read-only snapshot `2026-09-28T13-42-19-911Z`;
read the current records before applying.

- [ ] Amend capability 3 · Hooks (`capability_10e1dea84e5b`) `description`: the session-start hook the harness waits for, in a folder that isn't a project.
- [ ] Add contract 8.12 to capability 8 · Setup check (`capability_199d7af33d32`), title as in the patch; proven by `packages/agent-link/src/setup/setup-check.test.ts` "8.12 …".
- [ ] No existing contract's meaning changes: 8.4 (the agent is told to ask; nothing created without a yes) now also holds for a session whose agent never calls check_setup.
- [ ] After merge, close `increment_4da0889b672f` using `/tmp/winhooks-close-increment_4da0889b672f.md`.
