# The install one-liner shows progress (increment_a1785015b4cc)

Owner, 2026-09-30: "for 2 can we add a progress bar on the commandline on install?" The first acceptance
(`../acceptance/README.md` row 1.1) recorded "Download + NSIS took ~12 min" with almost nothing on screen.

## What changed

- The installer download is copied by hand (`Copy-StorytreeStream`, `Save-StorytreeFile`) and drawn with
  `Write-Progress`, updated at most four times a second: `203.9 MB of 353.6 MB, 47.8 MB/s, about 4 s left`.
  The estimate waits for a full second of data, so the first reading doesn't show a wild guess.
- Before each step the user is told what is happening: finding the release, installing, checking the app,
  opening it and starting its database, adding the command to PATH. The silent NSIS install shows a
  `Still installing: 01:23 so far. This may take a few minutes.` timer, updated every second, until the
  installer exits (`Wait-StorytreeProcess`).
- The download and install each report how long they took (`Downloaded … in … s`, `Installed in … s`), so the
  next acceptance run records the split without extra tooling.

## Measure first: why not Invoke-WebRequest's own bar

Same 370,813,957-byte installer (v0.3.337), Windows PowerShell 5.1, this machine (Snapdragon X Elite, arm64):

| method | seconds | file |
|---|---|---|
| `Invoke-WebRequest`, default progress (what the one-liner did) | **259.1** | `download-methods-ps5.txt` |
| `Invoke-WebRequest`, progress silenced | 8.0 / 11.1 / 9.7 | `download-methods-ps5.txt`, `download-new-vs-silent-ps5.txt` |
| new `Save-StorytreeFile`, its progress bar on | 24.3 / 11.3 (live proof: 7, 10) | `download-new-vs-silent-ps5.txt`, `transcript-ps5.txt` |

5.1's own bar made the download about 25 to 30 times slower. The new bar costs about the same as no bar at all
(the 24.3 s first round was a cold network; it was 11.3 s next to silent's 9.7 s), and both runs matched the
release manifest's SHA-256.

## Where the ~12 minutes went

With the old code, the download was most of the wait: 259 s here against about 10 s without 5.1's bar. On the
slower x64 laptop that ran the first acceptance, the redraw cost would be larger still. This change removes that
cost. The NSIS install time was **not measured on this machine**. A one-click NSIS install would uninstall and
replace the storytree-0.3 (0.3.309) already installed here under the same uninstall key, and this machine has no
Windows Sandbox, so the install share stays unmeasured. The retest's total (`../acceptance-retest/round-1/install-1.txt`,
470 s for download, install and first start) is an upper bound. Follow-up: the next clean acceptance run reads the
two new timing lines.

## Proofs

- `red-ps5.txt`: the new `bootstrap.test.ps1` against the old `install.ps1` fails at "clean install names each stage
  before it runs".
- `green-ps5.txt`: the same test passes under Windows PowerShell 5.1. PowerShell 7 isn't installed on this machine;
  `bootstrap.test.ts` runs the same file under pwsh on Windows CI, where pwsh is required.
- `harness/live-proof.ps1` → `screen-ps5.txt`, `transcript-ps5.txt`: the real release download, checksum and
  stage messages, run into a throwaway temp folder in its own 5.1 console window, with the top of the window
  copied every two seconds. A 15-second stand-in process takes the NSIS installer's place (same wait and timer
  code) for the reason above, so the dev app's home (`~/.storytree/0.3`) and the installed app are untouched.
