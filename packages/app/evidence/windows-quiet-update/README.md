# Contract 4.4 on a native Windows install: the quiet-moment update

Increment `increment_341abe802574` (arc `arc_54d42425c91f`), Updates contract 4.4
(`contract_aec036a8b4aa`, capability `capability_6a0c1b26f586`). Run on 2026-10-22 on the owner's
Surface Pro laptop (Windows 11 Home 10.0.26200, arm64), by a Claude Code session, with the laptop's
other agent sessions finished.

## What was installed, and how it was kept apart

- The published release **0.3.1690** (`storytree-0.3-0.3.1690-setup.exe`, SHA-256
  `bf3c4791…a7de3c7`, matching the release's `storytree-delivery.json`), installed silently into
  `%LOCALAPPDATA%\Programs\storytree-0.3-acceptance` (`/S /D=…`), not the default folder: the
  laptop's everyday app follows merged main, and an installed app in the default folder makes it
  refuse to start (contract 4.18).
- Its home is a throwaway `STORYTREE_HOME` (`~/.storytree/acceptance-4.4/home`): its own Postgres,
  local library and Electron profile, so its single-instance lock is its own too. The home holds
  `release-channel.json` set to **development** (stable only moves when the owner pins it) and
  `sign-in.json` off, so nothing registers at sign-in. No `install-choice.json`: the default, any
  quiet moment. `~/.storytree/0.3` was not written; the everyday app kept running and waiting for
  its own quiet hours throughout.
- Nothing was published for this run. Releases are published from every merged main commit, so the
  newer release was already on the channel: **0.3.1691**, and in runs 2b and 3 **0.3.1692**, which
  merged mid-run.

## The runs

| Run | Folder | What it isolates |
|---|---|---|
| 1 | `2026-10-22/` | launch settle, an agent at work, the window in use, then the quiet install |
| 2 | `2026-10-22-gear/` | the gear's Restart to update pressed while the daily snapshot pass writes |
| 2b | `2026-10-22-gear-at-once/` | the gear's Restart to update with nothing holding it |
| 3 | `2026-10-22-seed/` | a library seed alone holding the update, then the install |

Each run folder has `t0.txt` (launch), `steps.tsv` (`harness/watch.ps1`, every 15 s: installed
version, the app's main process, what the app's own `agentActiveAt` and `seedWriting` read, the
newest `releases.log` line), the run's phase or gear log, `pgdata-log.txt` (the home's Postgres log)
and `reopened.txt` (the app the installer reopened). `harness/judge.mjs` mints every check from these
files alone and writes `2026-10-22/observations.json`, which `pnpm record:acceptance` recorded.

- **Agent activity** is written into the app's own library by `harness/probe.mjs agent`, through
  the activity log's writer (`openActivityLog().append`), as an agent's hook writes a line. The
  session running the harness wrote to its own library (the Mint box), not this one.
- **Window use**: the window was shown by a second start, then `SendInput` moved the mouse a pixel
  each minute for ten minutes: real OS input, which the app reads as idle time.
- **Seeds** are real: `pnpm library:restore` of a 444 MB snapshot into the app's library while it
  runs, which holds the seeds' writing lock on a `storytree-seed` connection. In run 1 they ended
  within one updater check of the window's hold, so the seed is judged in run 3, where 14 restores
  start together and queue on that lock.
- **Snapshots** are the app's own: run 2 moves five large projects' snapshots aside and leaves one
  three-byte stand-in each, named a day before launch + 4 min, so the app's daily timer writes a real
  pass (five 466 MB snapshots, a minute) then. `snapshots.tsv` is that pass, from the files.
- **The gear** is pressed in the app's own window, through the Chrome DevTools Protocol of an app
  started with `--remote-debugging-port` (`harness/gear.mjs`): the page's own button, its own IPC.

## What was seen

All checks passed (`observations.json` has the times). In short:

- The release was found, downloaded and verified within a minute of launch (in run 2b a
  differential download failed its SHA-512 check and electron-updater fell back to a full download,
  which verified), and waited.
- Run 1 held it through the settle, then 19 minutes of agent activity, then 17 minutes of window
  use, and installed at the first updater check after the last hold ended: the database shut down,
  the installer ran, and the new version was on disk within a minute.
- Run 2: the click during the snapshot pass left the update pending; it installed at the updater's
  next check, a minute after the pass ended and still inside the ten-minute settle.
- Run 2b: the click stopped the database 0.2 s later and installed at once, a minute after launch.
- Run 3: the seed alone held it past the settle; it installed at the first check after the seed.

## What this run could not show, and two things seen on the way

- **The reopened app in its own home.** The installer reopens the app through Explorer
  (`--updated`, parent `explorer.exe`), which drops the harness's `STORYTREE_HOME`, so the reopened
  app started in the default home, where this laptop's follow-main app is set up, and refused with
  4.18's dialog (`reopened.txt`, closed by the harness). A user's installation has only the default
  home. The new version started by hand in the run's home followed the development channel and read
  itself up to date (`2026-10-22/started-in-home.txt`).
- **A held gear click reads as if nothing happened.** After the snapshot held it, the gear went back
  to Restart to update, saying it installs at the next quiet moment, and the restart waited for the
  next three-minute check instead of following the snapshot's end. Parked as a follow-up on the arc.
- **On a shared library the agent rule is fleet-wide.** The activity log lives on the library's
  server, so on this laptop (library on the Mint box) any machine's agents hold the update. Measured
  on 2026-10-22 over 48 hours, the shared log still had ten-minute quiet stretches most hours. The
  seed rule reads only a local Postgres (`seedWriting` runs where the app owns its database).
