# App setup: basic Windows acceptance (increment_6eb06dd00011)

Run 2026-09-28 to 29 on the owner's old laptop, basics only (question_2c9a366137cf: "we dont need to fully
simulate a new user with fresh accounts and stuff yet, just do the basics"). The owner then chose to
factory-reset the laptop so the run starts from a first-user machine, and approved installing what the test
needs. Releases landed every few minutes that day: the install fetched latest (0.3.217/0.3.218) and the app
updated itself to 0.3.218, 0.3.235 and 0.3.237 during the run.

**Verdict: FAILED, with gaps parked.** The install, repeat install, connection, Codex hooks, disconnect and every
help surface work. A first user on Git-less Windows cannot get Claude Code's command hook verified, a short
first task in either agent can skip the setup question, and a disconnected harness gets its hooks back.

## Machine and method

- `micksoldlaptop`, Acer, reset from its factory recovery image; Windows 11 Home 10.0.26200; **x64**
  (`PROCESSOR_ARCHITECTURE=AMD64`), so **arm64 is not proven here**. Local user; Windows PowerShell 5.1;
  Norton Security Ultra and Defender active; 174 GB free.
- Before storytree: no Git, Node, npm, Claude Code or Codex (`python.exe` only as the Store stub).
- Driven over SSH (Tailscale). Anything that needs the desktop ran in the owner's logged-on session through a
  one-shot interactive scheduled task (`harness/run-interactive.ps1`); the installer's `Read-Host` answer was fed
  on stdin with a transcript. The owner did only the two browser sign-ins. The app's screens were driven with
  real mouse and keyboard input over Chrome DevTools (`harness/cdp.mjs`; the app was restarted with
  `--remote-debugging-port` for this and restarted normally afterwards).
- Agents: Claude Code 2.1.283 (official `irm https://claude.ai/install.ps1 | iex`; its installer left
  `~\.local\bin` off PATH and told the user to add it by hand, which was done as instructed); Codex CLI 0.158.0
  (`winget install OpenAI.Codex --scope user`), signed out and uninstalled at the end.
- **Caveat:** midway, Codex (told to "do what check_setup says" with auto-approval) installed Git 2.55, Node
  24.19 and GitHub CLI via winget. Everything before that ran Git-less; the PowerShell hook bug was reproduced
  before it and confirmed fixed-by-Git after it.

## Results by contract

| Contract | Result | Evidence |
|---|---|---|
| 1.1 one-liner delivers app, bundled Node, tool bundle (x64 and arm64) | **PROVEN for x64**, arm64 NOT PROVEN (x64 laptop) | `output/install-1.stdout.txt`: installed from `C:\Users\mickh\My First Project`; `resources\agent-tools` holds node.exe, storytree-mcp/hook/setup/deliver .mjs and chunks. Download + NSIS took ~12 min. No SmartScreen or Norton prompt appeared (the download carries no mark of the web). |
| 1.2 first run shows the app and reaches its database without a manual open | **PROVEN, with a gap (F1)** | Delivery said "its app is open and its database is ready"; `screenshots/desktop-app-window.png` shows the window. 17 s later the app self-updated and was gone ~2 min (increment_aca4e6853237). Hidden-in-tray relaunch not tested. |
| 1.3 repeat in same or second folder reuses the install, no project, no settings replaced | **PROVEN** (0.2 part NOT APPLICABLE: no 0.2 on the machine) | `output/install-2.stdout.txt`: from `Second Folder With Spaces`, 4 s, no download, exe untouched, both folders empty, PATH entry not duplicated. |
| 1.4 interrupted or refused install reports the step and retry | NOT PROVEN (not attempted) | The missing-agent path does report "Agent connection needs attention … Retry …" with exit 1 and leaves the app installed. |
| 1.5 after an update, the next session starts compatible tools | **PROVEN in passing** | The app updated 0.3.218 → 0.3.235 → 0.3.237 during the run; sessions after each still reached storytree through the same `resources\agent-tools` paths. |
| 1.6 command runs from a fresh terminal; existing command preserved | **PROVEN** (conflict part NOT APPLICABLE) | `storytree` resolves to `~\.storytree\0.3\bin\storytree.cmd` in new PowerShell and cmd sessions and prints its families. |
| 2.1 choosing harnesses registers the tool server per user, preserving others | **PROVEN** | `output/connect.txt`: both "tools connected"; `claude mcp list` keeps its three claude.ai servers beside storytree; Codex `config.toml` keeps its `[tui]` table. |
| 2.2 a new session in the folder reaches its setup check | **PROVEN, with a gap** | The tool server starts and registers hooks in every session. But on a plain first task neither agent called `check_setup` (`output/claude-1.txt`, `output/codex-1.txt`), so the user was never asked (increment_4da0889b672f). |
| 2.3 repeating registration leaves one entry | **PROVEN** | `output/connect.txt`: second run "tools already connected"; one storytree entry in each list. |
| 2.4 missing harness gets a specific recovery action, no success claim | **PROVEN** | `output/install-1.stdout.txt`: choice 3 with neither agent installed: "Claude Code: tools not connected; hooks not verified. Install Claude Code, sign in, and check that claude --version works …", same for Codex. |
| 2.5 disconnecting one keeps the other and the command | **PROVEN, with a gap** | `output/disconnect.txt`: Codex entry and hooks removed; Claude Code, the command and a new Claude session (`verified: true`) kept. The next Claude session re-wrote `~\.codex\hooks.json` (increment_4e7ec8605d86). |
| 2.6 "tools connected" is told apart from "hooks verified"; a missing hook stays named | **PROVEN for Codex, NOT PROVEN for Claude Code on Git-less Windows** | Connect always says "hooks not verified". Codex: untrusted hooks named with the `/hooks` trust step (`output/codex-3.txt`), then with trust all four verified (`output/codex-4.txt`). Claude Code Git-less: session start and file edit verified, command never, because Claude Code ran it with its PowerShell tool and storytree's hooks only match `Bash` (increment_0699737b141d). With Git present all four verified. |
| 3.1 install offers the guide without a project; entry point reopens it | **PROVEN (reopen)**, offer NOT PROVEN | Gear → Help → First-run guide opens (`screenshots/app-6-help-guide.png`); the installer's text does not mention the guide. |
| 3.2 guide reaches setup diagnostics and recovery | PARTLY: the guide shows "Check a folder…" and "Copy request for your agent" (`screenshots/app-6-help-guide.png`); not clicked. |
| 3.3 two empty folders, two explicit yeses, two selectable forests | **PROVEN** | `claude trial 2` and `codex trial` each became a project only after "Yes, set it up as …"; the app's Projects picker lists both and switches between them (`screenshots/app-3-projects.png`, `app-4…`, `app-5…`). The window title follows the chosen project. |
| 4.1 license opens offline, no checkout | **PROVEN** | With a Windows Firewall outbound block on `storytree-0.3.exe`, Help → License showed the full PolyForm Shield 1.0.0 text (5,748 chars), "This copy travels with the app and is available offline" (`screenshots/app-7-license-offline.png`). |
| 4.2 every path carries the license; opens after an update | **PROVEN (after update)** | License opened on 0.3.235, after two updates. |
| 5.1 feedback available with and without a project, opens a prefilled draft | **PROVEN with a project** (no-project state not tested) | Help → Send feedback → Open GitHub draft opened Edge at `github.com/storytree-ai/storytree/issues/new?title=Acceptance test draft …` behind GitHub's sign-in (`screenshots/desktop-github-draft-url.png`). Not submitted. |
| 5.2 review and edit before submission; no project contents sent | **PROVEN** | The form is editable in the app; the draft URL carries only the typed title and message (`screenshots/app-8…`). |
| 5.3 failed browser open offers retry or copy | NOT PROVEN (not provoked) | A "Copy prepared text" button is present. |
| 5.4 says it opened a draft, never that feedback was received | **PROVEN** | "Opened a draft in your browser. Review it on GitHub and submit it yourself." (`screenshots/app-9-feedback-opened.png`). |

`storytree own --all` afterwards: "No recorded runs in this scope", with the shared app and database listed as
app-managed; it also says "Reading incomplete: some work could not be observed."

## Findings parked on arc_cfc7db517fae

- **increment_0699737b141d**: Claude Code on Git-less Windows: hooks miss the PowerShell tool (blocks 2.6 for a first Windows user).
- **increment_4da0889b672f**: First session skips `check_setup` on a short task (both harnesses).
- **increment_4e7ec8605d86**: Disconnected harness gets its hooks back at the next setup check.
- **increment_aca4e6853237** (F1): App self-updates seconds after a first install says ready.
- **increment_f3fe62dc7b6f** (F2): Install command missing from the repository front page and release notes.

Smaller observations, not parked: the first `storytree setup connect` printed "The system cannot find the path
specified." twice before its results (not repeated on the second run); the delivery's missing-agent path ends
in a red PowerShell error block that repeats the whole script source in a stdin-fed host (likely an artefact of
this harness, not seen in a normal console); Codex needs its user to trust hooks in `/hooks` before any event
arrives, which storytree names correctly.

## What was left on the laptop

storytree installed (0.3.237, `%LOCALAPPDATA%\Programs\storytree-0.3`, home `~\.storytree\0.3` with the two
test projects), connected to Claude Code; Claude Code installed and signed in; Git, Node 24 and GitHub CLI
(installed by Codex, not signed in); the test folders under `C:\Users\mickh`; the evidence working folder
`C:\Users\mickh\st-evidence`. Codex CLI uninstalled and signed out (its `~\.codex` folder of local state
remains, including the re-added hooks.json). Reolink app restored with the owner's camera settings. No
scheduled tasks or debugging ports left.

`harness/` holds the scripts that drove the run, for repeating it.
