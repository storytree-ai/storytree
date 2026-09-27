# Windows releases

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
are uploaded before the draft is published. Changing the release numbering or major/minor is
a deliberate release change, not a hand-edited patch bump.

Local tests use an HTTP fixture and real electron-updater downloads; they never execute an
installer. CI's `node apps/desktop/check-install.mjs` silently installs the packaged NSIS app
on a Windows runner, exercises its Electron and Postgres binaries, checks its feed configuration,
then uninstalls it. This proves x64 installation. An arm64 installation and an actual update
from one installed release to a second, including its reopened window, still need a Windows
acceptance run. No code-signing identity is configured; releases retain the existing unsigned
Windows distribution status.
