# Project folder: live check on the Windows laptop (ADR-0752)

Run 2026-09-29 (18:25–19:30 AEST) on the owner's old laptop (Windows 11 Home x64, Windows PowerShell 5.1), from
the Linux box over SSH, with the retest's harness (`../../acceptance-retest/README.md`): desktop steps as
one-shot interactive scheduled tasks, deleted when they finish; app screens over DevTools. Release **v0.3.271**,
built from `746f2a9`, which carries #234 (installer folder step, silence outside a project) and #236 (Add project).

**Verdict: the installer's folder step, silence outside a project and Add project with the real Windows folder
dialog all PASSED. The two real Claude Code sessions (steps 2 and 3) could not run: Claude Code on the laptop is
signed out** ("Failed to authenticate: OAuth session expired and could not be refreshed", `claude-1.txt`;
`claude auth status` says `loggedIn: false`). Signing it in needs the owner's browser. In their place, the
installed hooks and tool server were run exactly as Claude Code runs them (`harness/as-claude.mjs`).

| Step | What happened | Evidence |
|---|---|---|
| 0. Reset | App quit and uninstalled, `~\.storytree\0.3`, updater cache and PATH entry removed, storytree taken out of Claude Code (settings back to `theme`, `autoUpdatesChannel`), the retest's `Retest 3 …` folders removed. No Git, Node, gh or Codex. | `state-before.txt`, `reset.txt` |
| 1. One-liner from `C:\Users\mickh\PF Project Folder`, answers `1`, Enter, Enter on stdin | **PASS**, 462 s. It asked for the project folder (default: the folder it ran from) and the name (default `pf-project-folder`), then: "C:\Users\mickh\PF Project Folder is now storytree project 'pf-project-folder', and the app shows it." The folder holds only `.storytree.json`; the project choice is `pf-project-folder`. | `install-1.txt`, `install-1.transcript.txt` |
| 1. The app shows it | **PASS**: the window title is "pf-project-folder · storytree 0.3 · version 0.3.271"; the first-run guide opened with the new "Add a project" section. | `shots/app-after-install.png` |
| 2. Claude Code in the project | **NOT RUN** (signed out). Substitute: the one Claude Code start hook registered (the background one; no `--ask-setup` hook any more) prints nothing; check_setup says "This folder is storytree project "pf-project-folder"" and names the hooks still to verify. | `claude-1.txt`, `as-claude.txt` |
| 3. Claude Code in a non-project folder (`PF Other Folder`) | **NOT RUN** (signed out). Substitute: the start hook prints nothing; check_setup says "This folder is not a storytree project, so storytree records nothing here; carry on with the user's request. The user can add it as a project: …" and does not tell the agent to ask. Nothing was set up there (the folder stayed empty and was removed afterwards). | `as-claude.txt` |
| 4. Add project from the app, the real folder dialog | **PASS**: a real mouse click on Add project… opened Windows' "Select Folder" dialog; `harness/dialog2.ps1` put `C:\Users\mickh\PF Second Project` in its Folder box (read back before pressing) and pressed Select Folder. The app said "C:\Users\mickh\PF Second Project is now project "pf-second-project"" and switched to it; both projects are selectable and each forest shows. | `dialog.txt`, `cdp-add.txt`, `cdp-switch.txt`, `shots/app-1…4` |

## A mistake of the harness's, and what it left

The first dialog attempt wrote the path into the wrong box (the hidden address-bar edit), so Select Folder took the
folder the dialog was showing, `Downloads`, and the app set it up as project `downloads`, exactly as a user
choosing Downloads would. The marker `Downloads\.storytree.json` was removed at once (checked to be storytree's,
written minutes before); the empty project `downloads` stays in this test installation's library and shows in its
picker, since storytree has no command that deletes a project. The script now reads the Folder box back and
cancels the dialog unless it holds the intended path (the second attempt was cancelled that way, adding nothing).

## Found by the check

The connect step's output said "It asks before creating a project", which ADR-0752 made untrue; this PR rewords it ("Start a new agent session in the folder of your project and call check_setup; it names each missing hook …").

## What was left on the laptop

storytree 0.3.271 installed and running normally (no debugging port), home `~\.storytree\0.3` with projects
`pf-project-folder`, `pf-second-project` and the empty `downloads`; connected to Claude Code (tool server, one
start hook set and status line). Claude Code installed but **signed out**. Folders `C:\Users\mickh\PF Project
Folder` and `C:\Users\mickh\PF Second Project` (each holding only `.storytree.json`); harness outputs in
`C:\Users\mickh\st-retest\rpf`. No Git, Node, gh or Codex; no scheduled tasks, firewall rules or debugging ports
(`state-after.txt`). The earlier retest's `Retest 3 …` folders were removed by the reset. Reolink untouched.
