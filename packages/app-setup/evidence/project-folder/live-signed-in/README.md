# Live check with real signed-in agents: project folder (ADR-0752) and Codex

Run 2026-09-29 on the owner's reset Windows 11 Home x64 laptop (`ssh winlap`), storytree **0.3.272** installed,
no Git, Node or gh on the machine. The owner signed Claude Code back in and signed in to Codex
(`codex login --device-auth` over SSH), trusted storytree's seven Codex hooks in `codex` (the one-time
"Hooks need review" prompt, "Trust all") and chose Codex's default Windows sandbox. Closes the residue of
increment_03faf35c540d (increment_9366158ba46e) and the live Codex session (increment_695d5ec7646e).

| Check | Result | Evidence |
|---|---|---|
| Claude Code, short task inside the project `pf-project-folder` | **PASS**: file created normally | `claude-1-project.txt` |
| Claude Code, check_setup in the project: all four hooks on Git-less Windows | **PASS**: `verified: true`; the command ran through the **PowerShell** tool | `claude-2-project-hooks.txt` |
| Claude Code, short task in a non-project folder | **PASS**: file created, storytree never mentioned, no `.storytree.json`; its transcript has 1 tool call and 0 storytree calls, and no setup text reached the agent | `claude-3-non-project.txt`, `claude-3-non-project-transcript-check.txt` |
| Codex connect | **PASS**: tools connected, hooks not verified, seven storytree hooks written | `codex-0-connect.txt` |
| Codex, check_setup in the project, hooks trusted, run from the owner's desktop session | **PASS**: session start, tool call, file edit and command received, `verified: true`, `missing: []` | `codex-2-project.txt` |
| Codex, short task in a non-project folder | **PASS**: file created, no storytree call, never mentioned, nothing set up | `codex-3-non-project.txt`, `codex-3-non-project-folder.txt` |

## Notes

- **Codex from an elevated SSH login cannot run commands.** Codex refuses to start its background server
  from an elevated terminal (`codex` needs `--no-daemon` there), and in `codex exec` its Windows sandbox then
  fails every shell command ("timed out after 15000ms connecting runner pipe-in"): `codex-1-project.txt`
  shows session start, tool call and file edit received and the command missing for that reason alone. Run
  from the owner's own (non-elevated) desktop session, the same session verified all four. A Codex
  limitation of the test method, not a storytree one.
- The agents still see the optional-tool notes (git, Node, gh) in check_setup's structured data, although
  its spoken text leaves them out (ADR-0751). Claude Code repeated them in its answer and installed nothing.
- Left on the laptop: Codex installed and signed in (the owner: "keep codex installed"), with storytree's
  hooks trusted and its tool server registered; Claude Code signed in; the folders `PF Project Folder`
  (now with `hello.txt`, `codex.txt` if made, `.storytree-check`), `Not A Project`, `Codex Not A Project`
  and `st-live` (the run's scripts and raw output) under `C:\Users\mickh`. No scheduled tasks left.
