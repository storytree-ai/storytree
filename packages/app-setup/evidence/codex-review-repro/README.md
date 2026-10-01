# Codex's auto-review and check_setup's transcript line, retried on the Mint box (2026-10-01)

The recorded refusal (`../codex-hardening-live`, step 3: Codex 0.158.0 on Windows, `--approve-for-me`)
was tried again here on Linux, with a throwaway rig: its own Postgres and storytree home, and a fresh
HOME and `CODEX_HOME` per run (a copy of the sign-in, storytree's tool server, hooks and AGENTS.md
section written as `storytree setup connect --codex` writes them). Nothing touched the owner's library
or `~/.codex`. Every run: a fresh folder set up as a project, then
`codex exec --skip-git-repo-check --approve-for-me "Make a hello.txt file here that says hi."`
(`approval: on-request`, model gpt-6-astra, as in the recorded run).

| Build | Codex | Hooks | Runs | check_setup calls | Refused by the reviewer | Session finished the task |
|---|---|---|---|---|---|---|
| main (e2003c47), before | 0.153.4 | untrusted | 3 | 3 | 0 | 3 |
| main, before | 0.153.4 | trusted (`--dangerously-bypass-hook-trust`) | 3 | 6 | 0 | 3 |
| main, before | 0.158.0 | untrusted | 3 | 3 | 0 | 3 |
| main, before | 0.158.0 | trusted | 3 | 6 | 0 | 3 |
| this branch, after | 0.158.0 | untrusted | 3 | 3 | 0 | 3 |
| this branch, after | 0.158.0 | trusted | 3 | 6 | 0 | 3 |

The refusal did not come back in 12 runs before the change, so it is rare here or depends on something
the Windows run had. The 6 runs after show the reworded line stops nothing. `run-d1.txt` (before) and
`run-f1.txt` (after) are one trusted run each.

The change is the line's wording. It used to read "Each session's transcript streams into the library's
shared log…", which the reviewer took to mean the check itself streams the session ("the check may stream
this session's raw transcript"). It now says the check sends nothing of the session, that storytree's
hooks send transcripts, and, while Codex's hooks wait for the user's trust, that in Codex they send nothing
until then. The disclosure ADR-0749 D4 asks for (best-effort scrub, 180 days) is unchanged.

The hand-built rig these runs used (a throwaway Postgres, the built commands, a fresh user and what connect
writes into a Codex home) is retired: a dev build now makes the same throwaway home with one command,
`pnpm --filter @storytree/app-setup dev-home <dir> --codex` (see `../dev-home`).
