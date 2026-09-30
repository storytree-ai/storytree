Capability 1 delivers the existing NSIS app and agent-link tool bundle. `install.ps1` is the
published one-command entry point; the desktop packages it alongside the release feed.

The installed payload is `<installation>/resources/agent-tools/`: native Node 24, all four
`buildBins` entry points, `chunks/**`, a delivery helper, Node's license and `payload.json`
(architecture and SHA-256 inventory). The installation defaults to
`%LOCALAPPDATA%\Programs\storytree-0.3`. Its paths do not contain the release version.

After verifying the payload, delivery starts the app executable **even if its database is
already running**. The existing desktop second-instance handler restores a hidden window.
Delivery waits for the app-owned database; it never starts another database or creates a
project. The app records its own launch at successful startup. The bootstrap reuses an
intact installation and refuses to replace an incomplete existing app without a named
repair/update action. Ordinary updates remain the app's responsibility.

Connection-lane seam: `<STORYTREE_HOME>/delivery.json` (default `~/.storytree/0.3`) is written
only after startup succeeds. Schema 1 holds `installDir` and `tools` with absolute paths:
`{ dir, app, node, mcp, hook, setup, cli, deliver }`. `toolPaths(installDir)` constructs these;
`verifyPayload(installDir, arch)` validates the installed inventory. A harness runs
`tools.node` with `[tools.mcp]`; hooks/setup/CLI use their corresponding `.mjs` entry.
Connection and harness consent belong to capability 2. After successful delivery the
one-liner prompts for Claude Code, Codex, both, or skip, then invokes the installed
`tools.node tools.cli setup connect` with the chosen switches. The CLI delegates to the
bundled app-setup helper, which reads `delivery.json` (or, before `finish` has written it,
the tools beside the helper itself) and reuses `connectAgents`.
Registration reports tools connected separately from hooks not verified and directs the
user to start a session in their folder.

Then the one-liner asks for the project folder (ADR-0752 D1): Enter takes the folder it ran
from, a typed path is resolved against it and created if missing, S skips. Run from the home
folder or a drive root, Enter skips instead, since every folder below would join that project.
The suggested name is the setup check's `suggestedName`; Enter accepts it and a refused name is
asked again. The bundled helper's `project <folder>` says what the folder is, and
`add-project <folder> <name>` sets it up through `../project` exactly as the setup check's yes
does (marker, library project, the app's project choice); a folder already in a project is
said and nothing is created. `finish` itself still never creates a project. `setup install` retains its hook/command meaning;
delivery's own `inspect` and `finish` operations do not write harness settings.

Delivery owns `~/.storytree/0.3/bin/storytree.cmd`, recognizes the agent-link's 0.3 launcher
marker, and adds its directory to the per-user Windows PATH. Unrelated commands anywhere on
the supplied PATH cause a named conflict; the user can run the bundled Node/CLI explicitly.
A marked launcher elsewhere on PATH (a source build's, say) would shadow this one, so it is
repointed at this installation and named in the result's `replaced`, which the one-liner prints.
PowerShell owns registry PATH persistence and Explorer notification; no global Node or tool
installation occurs. Node patch versions and both hashes are pinned in `runtime.ts`.

The launcher uses the existing agent-link format so capability 2's exact-match disconnect
recognises it. The delivery tests exercise that public disconnect seam after both lanes merge.

See `../../evidence/deliver/README.md` for observed proofs and the outstanding real Windows
first-run, update and harness acceptance. The fixed payload paths are the update interface;
this Linux lane does not attest a real Windows release update with live agent processes.

Leaving (app setup 1.8): the NSIS uninstaller (Windows Apps & features, or `storytree setup
uninstall [--keep-library|--remove-library]`, which opens it) runs the bundled helper before it
deletes the app's files. `uninstall-asks <installDir>` says whether to ask about the library;
`uninstall <installDir> keep|remove` removes this installation's agent registrations, hooks and
status line (anything else's stays), and, only when `delivery.json` names this installation, the
per-user PATH entry, the updater cache named in `app-update.yml` and the home (all of it, or all but
the library). Project folders are never touched. An update runs the uninstaller with `--updated`,
and then nothing is removed. `apps/desktop/check-install.mjs` proves both through the real installer.
