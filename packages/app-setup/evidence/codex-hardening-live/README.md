# Codex hardening, live on a release (#320, #323, #324)

Run 2026-09-30 on the owner's Windows 11 Home x64 laptop (`ssh winlap`), Codex CLI 0.158.0 signed in, no
Git or Node. A **fresh `CODEX_HOME`** (`home-L1`: a copy of the sign-in and sandbox setup, no hooks, no
trust, no AGENTS.md: `0-prep.txt`) and a fresh empty folder `CH Live L1`. Desktop-session steps ran
through the interactive scheduled task (`../codex-first-session/harness/lap.sh`); the elevated step ran
over SSH, which on this laptop is an administrator login (High Mandatory Level).

| Step | What a user sees | Result | Evidence |
|---|---|---|---|
| 1. The real one-liner, choose 2 (Codex), Enter, Enter | Codex connected, the folder set up as project `ch-live-l1`; the fresh Codex home gets storytree's AGENTS.md section and its hooks | **PASS** (#320). The connect line was 0.3.355's; the app updated itself to 0.3.358 at a quiet moment 90 s later | `1-install.txt` |
| 2. `storytree setup connect --codex`, before trust (0.3.358) | "Codex: tools already connected; hooks waiting for you to trust them in Codex." and the one step | **PASS** (#323) | `2-status-before-trust.txt` |
| 3. First Codex session, hooks untrusted: "Make a hello.txt file here that says hi." | check_setup before the first change; the agent relays the step word for word | **PASS** (#320, #323); two rough edges, below | `3-first-session-untrusted.txt` |
| 4. Elevated (administrator) terminal: connect, and a Codex session's check_setup | Both say Codex cannot run commands from an administrator terminal and to open a normal one; check_setup names it instead of asking for the command test | **PASS** (#324) | `4-elevated-ssh.txt` |
| 5. A Codex hook runs (`--dangerously-bypass-hook-trust` stands in for the user's trust) | the note is written | **PASS** | `5-hooks-run.txt` |
| 6. `storytree setup connect --codex` after | "Codex: tools already connected; hooks running." | **PASS** (#323) | `6-status-after-hooks-ran.txt` |
| 7. The app: Help → First-run guide | "Codex: Codex is connected, and runs storytree's hooks." at the top | **PASS** (#323), real app over DevTools | `7-app-guide-codex-running.png` |

`storytree doctor` showed neither new line on 0.3.358 (steps 2 and 6): it picks the setup check's lines
one by one. Fixed on this branch (cli doctor 8.5).

## Found (parked on arc_cfc7db517fae)

- **Codex's auto-review refused the second check_setup call** in step 3. Codex's reviewer judged that the
  check's transcript line ("Each session's transcript streams into the library's shared log…") was sensitive
  egress the user had not approved. The session then ended by asking the user to approve "sharing session
  transcripts". That is not the first run we want.
- **The check file is still left behind** in step 3 (`.storytree-check`), as increment_32b5bb7f381c records.
- **Codex does not seem to pass `CODEX_HOME` to storytree's tool server.** The owner's own
  `~\.codex\hooks.json` was rewritten at 20:46:59, the moment the first trial's Codex session started
  under a fresh `CODEX_HOME`. It gained storytree's newer close-out-reminder Stop hook (ADR-0758). The
  owner's 7 trust entries are untouched, so the owner's next Codex start asks to review that one new hook.
  The inference is that the tool server's setup-check registration used the default home.

## Left on the laptop

storytree 0.3.358 installed and running normally, with the debug port closed. Projects `ch-first-a1…c3` and
`ch-live-l1` stay in its library, because removing a project is not built yet (increment_6bb0564567cb).
Their folders, the fresh Codex homes (which held copies of the Codex sign-in) and
`C:\Users\mickh\st-codexharden` are deleted. The note `~\.storytree\0.3\codex-hooks-ran` stays. Codex is
installed and signed in. The owner's `~\.codex` is as described above. No scheduled tasks are left.
