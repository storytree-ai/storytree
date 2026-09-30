# Clean uninstall and install time on a real Windows machine (increment_1411e204cc7d, increment_fc5f719206d5)

Run 2026-10-01 00:05–00:30 (AEST) on the owner's reset laptop (Windows 11 Home x64, Windows PowerShell 5.1,
Claude Code and Codex CLI signed in), over SSH from the owner's other laptop. Nobody was at the keyboard;
the desktop steps ran in the owner's session through one-shot scheduled tasks
(`harness/run-interactive.ps1`, the method in process_81a7122f6849). The Codex-hardening session that had
used the laptop was idle and had nothing running there.

**Verdict.** Uninstalling from Apps & features asks about the library and removes everything storytree added;
removing the library too leaves the machine exactly as it was before storytree, apart from the user's own
project folder, which is untouched. Both agents still work, and no storytree hook fires. An automatic app
update in the middle of the run removed nothing. A silent install takes about 32 s on a clean machine.
Two defects were found and fixed in the same pull request (below).

## What ran

`harness/state.ps1` records everything storytree can add (command, PATH entry, install folder, Apps & features
entry, shortcuts, home, update cache, processes, Claude Code's `.claude.json` and `settings.json`, Codex's
`config.toml`, `hooks.json` and AGENTS.md section) and the watched project folders. Each step's snapshot is in `run/`.

| Step | What | Result | Evidence |
|---|---|---|---|
| S0 | The laptop as found: 0.3.368 installed, both agents connected, two projects | baseline | `run/s0-before.txt` |
| — | The app updated itself to 0.3.369 at a quiet moment (not started by this run) | **PASS**: home, both connections and all hooks unchanged | `run/s0b-after-auto-update.txt` |
| A | The Apps & features uninstall command (`"…\Uninstall storytree-0.3.exe" /currentuser`), answered as a user: OK, OK (app running), **Yes** keep the library | **PASS**: three dialogs, the library question worded as designed, 22 s; app, command, PATH entry, entry in Apps & features, Start menu shortcut, update cache and every Claude Code and Codex registration, hook and status line gone; project folders untouched; home kept | `run/roundA/`, `run/s1-after-uninstall-keep.txt` |
| — | The kept home also held the app's own leftovers (`electron` 12 MB, `releases.log` 18 MB, logs, launch record) | **defect, fixed**: keeping the library now keeps only the library | `run/s1-after-uninstall-keep.txt` |
| B | The kept home moved aside (backed up) to reach a clean machine, then the one-line install from a new folder: both agents, the folder as a project | **PASS**: downloaded 353.6 MB in 33 s, **installed in 32 s**, 110 s from start to a connected project | `run/s1b-clean.txt`, `run/roundB/install.transcript.txt`, `run/s2-installed.txt` |
| C1 | `storytree setup uninstall --remove-library` from a terminal in the project | **defect, fixed**: it printed that it was uninstalling and exited 0, but nothing happened | `run/s2-installed.txt` (unchanged state) |
| C2 | The fixed launch (the uninstaller started directly, detached), run with the installation's own Node | **PASS**: returned in 324 ms, uninstalled in 15 s; the state matches the clean machine exactly except the project folder, which still holds its marker and the user's `notes.md` | `run/roundC-remove.txt`, `run/s3-after-uninstall-remove.txt` |
| D | A Claude Code and a Codex session in the project folder | **PASS**: both answered; Claude Code started no MCP server and no hook, nothing names storytree | `run/agents-after-uninstall.txt` |
| R | Restore: the home copied back, the one-line install again, both agents reconnected, no new project | **PASS**: 31 s download, **33 s install**, 120 s in all; the state matches S0 except the newer version (0.3.371) and Codex's AGENTS.md section, which connecting now writes (#330) | `run/restore/install.transcript.txt`, `run/s4-restored.txt` |

## Defects found and fixed

1. **`storytree setup uninstall` did nothing.** It started the uninstaller through a detached Windows
   PowerShell (a 2-second delay, so the command could return before the uninstaller stops every process in
   the installation). A detached Windows PowerShell has no console and exits without running its script: reproduced on
   this laptop and on the owner's other machine (`harness/launcher-probe.mjs`: `detached: true` gives an empty
   output, the same call without it prints). The command now starts the uninstaller itself, detached; the
   uninstaller only stops processes after its PowerShell check (over a second), by when the command has printed
   and returned (324 ms here). CI's packaging check now reaches the uninstaller through this same command
   instead of calling it directly, so this cannot pass unnoticed again.
2. **"Keep your library" kept more than the library.** It removed only the command and the delivery record, so
   the app's browser data and logs (about 30 MB here) stayed. It now keeps only the database, its backups, the
   library location setting, this machine's identity (projects' folders are recorded under it), the chosen
   project and queued hook lines. Unit test: `src/deliver/uninstall.test.ts`, "keeping the library leaves only
   the library behind" (red, then green).

## Install time (increment_fc5f719206d5)

On a clean machine the one-line install's time is now mostly download: 353.6 MB in 31–33 s here, then the silent NSIS
install in 32–33 s, then about 45 s to start the app and its database, connect both agents and set up the
project. The old "about 12 minutes" was Windows PowerShell 5.1's own download progress bar, fixed before this
run (`../progress/README.md`). A 32-second install needs no NSIS progress display; shrinking the installer
(it carries both x64 and arm64) would cut download and install alike, but at about two minutes in all there is no
pressing reason.

## Left on the laptop

storytree 0.3.371 installed and running with the owner's original home (library and projects) restored,
connected to Claude Code and Codex exactly as before (`settings.json` and Codex's `hooks.json` byte-identical to
the start; Codex's `config.toml` identical apart from its storytree table now being last). The test folder
`Uninstall Proof Project`, both backups and this run's working folder were deleted, except one log,
`C:\Users\mickh\st-uninstall\restore.stdout.txt`: the app started by the restore install holds it open, and it can be
deleted once the app restarts. No scheduled tasks are left.
