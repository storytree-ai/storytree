# Windows releases

From Windows PowerShell (5.1+) or PowerShell 7:

```powershell
& ([scriptblock]::Create((Invoke-RestMethod 'https://github.com/storytree-ai/storytree/releases/latest/download/install-storytree.ps1')))
```

The command downloads the existing combined x64/arm64 NSIS installer, checks its release
checksum, and installs the app plus its own Node 24 runtime and complete agent-tool bundle.
No npm, source checkout or global Node installation is needed. Once the script is loaded, a
verified installation is reused without querying the feed or downloading an installer; the
published one-liner itself still needs network access to fetch the script. Delivery always
launches the executable to show the app and waits
for its database. It creates no project and changes no agent configuration. An incomplete
existing app is preserved with repair/update instructions, rather than silently overwritten.

The command appends its own `~/.storytree/0.3/bin` directory to the user's Windows PATH for
fresh terminals. A conflicting `storytree` executable or script is preserved and named, with
the explicit bundled command printed instead. The tools' durable paths are recorded in
`~/.storytree/0.3/delivery.json`; their files live in the installation's `resources/agent-tools`.
Ordinary NSIS updates replace this complete payload at the same location. The bootstrap is
not an updater. An already installed and signed-in agent is still required; Help → First-run
guide explains connection, project consent and the received-hook check.

`pnpm desktop:dist` bundles and packages the app locally, without publishing, even when a GitHub
token is present. It produces a combined x64/arm64 NSIS installer, its update metadata and
blockmap, plus the existing arm64 portable executable and unpacked app. NSIS installs per user.
The ARM64 archive uses the BCJ filter because NSIS's bundled extractor cannot decode the newer
ARM64 filter. Keep this workaround for both targets.

The installed app follows the public GitHub release feed. Only NSIS writes
`resources/storytree-installed`; unpacked and portable copies keep their existing behaviour.
Downloads and checks are handled by electron-updater. Its NSIS launch is passed to the same
`background().restart` used by the development updater, which stops the database before the
installer runs. The app waits while a seed writes. Failures are logged in
`~/.storytree/0.3/releases.log` and tried again at the next three-minute check.

`.github/workflows/release.yml` listens for completed CI runs because CI's own token merges do
not trigger a push workflow. It selects a merged commit, checks that it is still on main, and
verifies that exact commit on Linux, macOS and Windows before packaging. Release versions use
the desktop's major/minor and main's first-parent commit count as the patch number. Only the
workflow creates release tags. A rerun skips published versions and can finish an interrupted
draft; an older run cannot replace a newer release. The installer, blockmap and `latest.yml`
and the delivery script, one-liner and checksum manifest are uploaded before the draft is published. Changing the release numbering or major/minor is
a deliberate release change, not a hand-edited patch bump.

Local tests use an HTTP fixture and real electron-updater downloads; they never execute an
installer. CI's `node apps/desktop/check-install.mjs` silently installs the packaged NSIS app
on a Windows runner, exercises its Electron, Postgres, bundled Node and all agent tools from a
path with spaces, checks its feed configuration,
then uninstalls it. This proves x64 installation. An arm64 installation and an actual update
from one installed release to a second, including its reopened window, still need a Windows
acceptance run. No code-signing identity is configured; releases retain the existing unsigned
Windows distribution status.

## Forest mode smoke screenshots

The smoke check can click either Forest / Library button before taking its screenshot:

```sh
pnpm desktop:smoke --forest-mode forest --screenshot smoke-forest.png
pnpm desktop:smoke --forest-mode library --screenshot smoke-library.png
```

`--forest-mode` is used only by the smoke check. Normal launches always start in Forest.
The smoke inventory checks the loaded project; the mode assertion checks the actual control.
The forest's headless capture evidence separately counts the renderer's submitted meshes.
