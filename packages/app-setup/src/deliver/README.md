Capability 1 delivers the existing NSIS app and app setup tool bundle. `install.ps1` is the
published one-command entry point; the desktop packages it alongside the release feed.

On an Apple Silicon Mac the one command is `install.sh` (contract 1.12), run as
`curl -fsSL …/install-storytree.sh | sh`: POSIX sh, also run under bash and zsh, laid out by system
and chip so the parked Linux arc adds a branch. It refuses an Intel Mac, Linux and Windows in plain
words, chooses the channel as `install.ps1` does, reads the release's `storytree-delivery.json`
(its `macos.arm64` entry: the zip's name, SHA-256 and size), refuses a checksum mismatch, unpacks the
`.app` into `~/Applications/storytree-0.3.app` (or the folder `delivery.json` names), runs the same
`finish`, and puts `~/.storytree/0.3/bin` on PATH through one line in `~/.zprofile`, marked so
`storytree setup uninstall` can take it out: on a Mac it uninstalls in place (no app running, a
library kept or removed only on `--keep-library`/`--remove-library`), removing the `.app` and that
line from `${ZDOTDIR:-~}/.zprofile`. Every step is a function and the last line runs them, so a download cut short runs nothing.

The installed payload is `<installation>/resources/agent-tools/`: native Node 24, all four
`buildBins` entry points, `chunks/**`, a delivery helper, Node's license and `payload.json`
(architecture and SHA-256 inventory). The installation defaults to
`%LOCALAPPDATA%\Programs\storytree-0.3`. Its paths do not contain the release version.

After verifying the payload, delivery starts the app executable **even if its database is
already running**. The existing desktop second-instance handler restores a hidden window.
Delivery waits for the app-owned database; it never starts another database or creates a
project. The app records its own launch at successful startup. The bootstrap reuses an
intact installation and refuses to replace an incomplete existing app without a named
repair/update action. Ordinary updates remain the app's responsibility. On a Mac, until the app
updates itself, running `install.sh` again over an app older than the channel's release (read from
its `Info.plist`) says "Updating storytree A to B", quits the open app with its own `--quit`,
and puts the new bundle in the old one's place; the data under `~/.storytree` is untouched. Over
the channel's own version, or when the release cannot be read, it opens the installed app.

Connection-lane seam: `<STORYTREE_HOME>/delivery.json` (default `~/.storytree/0.3`) is written
only after startup succeeds. Schema 1 holds `installDir` and `tools` with absolute paths:
`{ dir, app, node, mcp, hook, setup, cli, deliver }`. `toolPaths(installDir)` constructs these;
`verifyPayload(installDir, arch)` validates the installed inventory. A harness runs
`tools.node` with `[tools.mcp]`; hooks/setup/CLI use their corresponding `.mjs` entry.
Connection and harness consent belong to capability 2, and adding a project to capability 6.
Once delivery is ready the one-liner asks nothing (ADR-1162 D1, contract 1.15): no agent
connection, no project folder. Its first line after the install says the app is open and gives
the command that opens it again (`& '…\storytree-0.3.exe'` on Windows, `open '…/storytree-0.3.app'`
on a Mac, the AppImage on Linux, with `--no-sandbox` where the kernel blocks Chromium's sandbox),
then that the app connects agents and adds a project. The app's first-run guide offers both
(capability 3, contract 3.13). `storytree setup connect --claude` and the rest still connect from
a terminal: the CLI delegates to the bundled app-setup helper, which reads `delivery.json` (or,
before `finish` has written it, the tools beside the helper itself) and reuses `connectAgents`.
`finish` itself never creates a project. `setup install` retains its hook/command meaning;
delivery's own `inspect` and `finish` operations do not write harness settings.

Delivery owns `~/.storytree/0.3/bin/storytree.exe`, recognizes the app setup's 0.3 launcher
marker, and adds its directory to the per-user Windows PATH. The launcher is a small program of
its own, made from the payload's `storytree-launcher.exe`, so no shell reads its words (ADR-0854);
the batch file it was before, `storytree.cmd`, is replaced by it in its folder. Unrelated commands anywhere on
the supplied PATH cause a named conflict; the user can run the bundled Node/CLI explicitly.
A marked launcher elsewhere on PATH (a source build's, say) would shadow this one, so it is
repointed at this installation and named in the result's `replaced`, which the one-liner prints.
PowerShell owns registry PATH persistence and Explorer notification; no global Node or tool
installation occurs. Node patch versions and both hashes are pinned in `runtime.ts`.

The launcher is the app setup's own (`launcherFor` in its setup), so capability 2's disconnect
recognises it by what it runs. The delivery tests exercise that public disconnect seam.

See `../../evidence/deliver/README.md` for observed proofs and the outstanding real Windows
first-run, update and harness acceptance. The fixed payload paths are the update interface;
this Linux lane does not attest a real Windows release update with live agent processes.

Leaving (app setup 1.8): the NSIS uninstaller (Windows Apps & features, or `storytree setup
uninstall [--keep-library|--remove-library]`, which opens it) runs the bundled helper before it
deletes the app's files. `uninstall-asks <installDir>` says whether to ask about the library;
`uninstall <installDir> keep|remove` removes this installation's agent registrations, hooks and
status line (anything else's stays), and, only when `delivery.json` names this installation, the
per-user PATH entry, the updater cache named in `app-update.yml` and the home (all of it, or all but
the library: its database, backups, location setting, machine identity, chosen project and queued
hook lines). Project folders are never touched. An update runs the uninstaller with `--updated`,
and then nothing is removed. `storytree setup uninstall` starts the uninstaller itself, detached
(a detached Windows PowerShell has no console and runs nothing). `apps/desktop/check-install.mjs`
proves both through the real installer, reaching the uninstaller the way that command does. Live
proof on a clean Windows machine: `../../evidence/uninstall/README.md`.
