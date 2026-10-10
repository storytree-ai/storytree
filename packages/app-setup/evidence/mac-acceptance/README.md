# App setup: Mac acceptance, check (b), on a GitHub Apple Silicon runner (increment_dcaf0f58fcf0)

Check (b) of decision_b0a98e971a05 D4, without the self-update step (that waits for Apple's approval of the
Developer ID, increment_4dcfabc58d92). `harness/run.sh` runs on a fresh `macos-latest` runner, started by
`.github/workflows/mac-acceptance.yml` (dispatch it, or push to a `mac-acceptance/` branch; its `hold` input keeps
the runner open afterwards for a remote session only the dispatcher's GitHub keys can open). It runs the release
page's one-liner in a pseudo-terminal (`expect`), answering as a person would: 1 (connect Claude Code, installed
from npm and never signed in), Enter for the folder, Enter for the suggested name. Then it records Gatekeeper,
the app's window, local Postgres, the setup check, hooks, and a project grown with no agent, one file per step,
with exit codes and times in `steps.tsv`. No secret is used, and no agent is signed in: the logs are public.

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
