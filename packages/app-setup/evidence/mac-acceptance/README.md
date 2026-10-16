# App setup: Mac acceptance, check (b), on a GitHub Apple Silicon runner (increment_dcaf0f58fcf0)

Check (b) of decision_b0a98e971a05 D4. Its first half, first open and a project build, is `harness/run.sh`; its
second half, the signed first open and one self-update, is `harness/self-update.sh` (runs of 2026-10-16, below).
`harness/run.sh` runs on a fresh `macos-latest` runner, started by
`.github/workflows/mac-acceptance.yml` (dispatch it, or push to a `mac-acceptance/` branch; its `hold` input keeps
the runner open afterwards for a remote session only the dispatcher's GitHub keys can open). It runs the release
page's one-liner in a pseudo-terminal (`expect`), answering as a person would: 1 (connect Claude Code, installed
from npm and never signed in), Enter for the folder, Enter for the suggested name. Then it records Gatekeeper,
the app's window, local Postgres, the setup check, hooks, and a project grown with no agent, one file per step,
with exit codes and times in `steps.tsv`. No secret is used, and no agent is signed in: the logs are public.

Check (a) (increment_4bc9955ff232): the release workflow calls the same run after every publish, on the
development channel, and `harness/judge.sh` fails it unless the install exits 0, the app is in `~/Applications` at
the version just published (the pipe hides a 404), the app and its Postgres are running, and the setup check exits
0. Its verdicts are in `verdict.tsv`, in the run's `mac-acceptance` artifact; those runs are not committed here.
Hooks and `spctl --assess` are recorded, not judged, until increment_9e50c19dfefe and the Developer ID
(increment_9d05fb8a164b) land.

## Runs of 2026-10-10

Runner: macOS 26.6.2 (25G83), image macos-26-arm64 20260907.0351.1, Apple M1 (Virtual); Claude Code 2.1.296.

- `2026-10-10-stable/` (run 38021045354): **FAIL.** The stable one-liner
  (`…/release-channel-stable/install-storytree.sh`) returns 404, so nothing installs. Stable is pinned at 0.3.711
  (2026-10-06), from before Mac support; the stable branch holds only `install-storytree.ps1`. The pipe hides it:
  curl fails, `sh` reads nothing and exits 0. It works once the owner pins a Mac-capable release as stable.
- `2026-10-10-development/` (run 38021125639): **PASS**, with one gap. The development one-liner installed 0.3.1045:
  - Install took 24 s end to end: download, install to `~/Applications`, verify, open the app and start its
    database, add the command to `~/.zprofile`; then the agent and project questions.
  - First open (`first-open.png`): the app's window opened on its first-run guide, titled with the project. No
    Gatekeeper dialog and no folder-permission prompt (`windows.txt`; `tcc-log.txt` holds only WindowServer's
    checks, no prompt).
  - Gatekeeper: the app has no quarantine attribute (`xattr-app.txt` empty), because curl sets none, so macOS
    never assesses it at open. `spctl --assess` says `rejected`, as it must for an ad-hoc signature
    (`codesign.txt`: `Signature=adhoc`, hardened runtime); it would only matter for a download that carries the
    attribute, such as the `.dmg` from a browser.
  - Local Postgres up from the app's bundle (`processes.txt`); the setup check from a new login shell finds the
    command on PATH, storytree running, the folder a project, git and Node (`doctor.txt`).
  - Project grown with no agent: an arc and a story written and read back (`grow-*.txt`, `tree.txt`, `arcs.txt`).
  - **Gap: hooks not written.** Connect said "Claude Code: tools connected; hooks not verified", but Claude Code
    had never run, so `~/.claude` did not exist and no hooks were registered; the setup check says "Hooks for
    Claude Code: not installed on this machine" (`hooks.txt`). Not Mac-specific; parked as its own increment on
    arc_5b467265f126. A user who has used Claude Code before has that folder, so registration goes ahead there (not observed in this run).
- `2026-10-10-update-by-hand/` (run 38021743142): the same development install, then the steps a user takes to
  update while the app cannot update itself. **Running the one-liner again over an installed app downloads
  nothing**: it reopens the app and asks the questions again (`rerun-installed.txt`), so it updates no one. Quitting
  the app, moving `~/Applications/storytree-0.3.app` to the Bin and running the one-liner again reinstalls it in
  14 s, keeping the project and its story (`reinstall.txt`, `tree-after.txt`). Both runs installed 0.3.1045, so
  this proves that the reinstall keeps the project, not a move from one version to the next.

## Runs of 2026-10-16: the signed app passes Gatekeeper and updates itself (increment_e9ed21b673a3)

`harness/self-update.sh`, started by `.github/workflows/mac-self-update.yml` (dispatch it with the release to
start from, or push to a `mac-self-update/` branch), and judged by `harness/judge-self-update.sh`. Runner: macOS
26.6.2 (25G83), Apple M1 (Virtual). No agent connected, no secret used.

- `2026-10-16-self-update/` (run 38914897950): **PASS** on all eleven checks (`verdict.tsv`).
  - Release N is 0.3.1482, the first Developer ID release, installed by its own release's one-liner
    (`STORYTREE_ACCEPTANCE_VERSION`, as `run.sh` installs a named build). A named build installs as stable, whose
    pin (0.3.1453) is older than any Developer ID build, so the run quits the app and records the installation as
    development (`channel.txt`), the channel N and N+1 were both published on. That is setup only; no user does it.
  - **Signed first open, quarantined.** The release's zip, downloaded into `~/Downloads` with the quarantine
    attribute a browser and Archive Utility put on every file (`quarantine.txt`): `spctl --assess` says
    `accepted, source=Notarized Developer ID` (`spctl.txt`). Opened as Finder opens it, macOS asks once whether to
    open "an app downloaded from the Internet", adding "Apple checked it for malicious software and none was
    detected" (`first-open-quarantined.png`). Answering Open brings the window up on 0.3.1482 (`dialog-after.txt`,
    `first-open.png`), and the attribute is marked approved (`00c1`, `xattr-after-open.txt`). No ticket is stapled
    (`stapler.txt`), so this first open fetches notarisation from Apple online.
  - **One self-update.** The one-liner's install, opened and left untouched, found 0.3.1485 at its first check
    and downloaded it in 2 s, then waited at each three-minute check for a quiet moment (contract 4.4) until ten
    minutes after its launch, installed it and reopened by itself 12 minutes after launch, with no re-run of the
    one-liner (`releases-log.txt`, `update-wait.txt`). It reopened at the same path on 0.3.1485
    (`version-after.txt`, `processes-after.txt`, `after-update.png`), still `Notarized Developer ID`
    (`spctl-after.txt`), with its local Postgres up and the story grown before the update still in the project
    (`tree-before.txt`, `tree-after.txt`, contract 1.5). The setup check passes from a new login shell
    (`doctor.txt`).
- `2026-10-16-translocated/` (run 38909094131): the same, but with the quarantine put on the app the one-liner had
  installed in `~/Applications`. Gatekeeper accepts it, and macOS runs it through App Translocation, from a
  read-only copy at a random path (`processes-open.txt`). That copy is not the bundle the delivery record names,
  so the app rightly does not count itself installed and never starts its updater: `releases-log.txt` has only
  the first, stable check from before the quarantine, and the 40-minute wait saw 0.3.1482 throughout. The
  one-liner never meets this (curl sets no quarantine attribute), which is why the passing run opens the
  quarantined copy from `~/Downloads` and updates the one-liner's install.
