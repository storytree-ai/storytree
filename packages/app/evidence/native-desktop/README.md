# Native Desktop execution

`prove.mjs` runs the real Linux Electron entry in a disposable home, with its own
Postgres. It witnesses App contracts 1.7 (close, reopen, quit) and 4.10 (a checkout
does not update itself). It starts normally, including tray creation and
`followReleases`; it does not use the smoke shortcut.

The proof starts main-process precise V8 coverage before the entry runs, then
measures the sandboxed preload through Chromium CDP. Runtime bundle text must
match the generated source accompanying its source map. Only successful native
assertions are recorded by the existing `recordBrowserCoverage` function. Failed
recaptures invalidate both saved proofs. No renderer bundle or foreign story is
submitted as App evidence.

Run on Linux with Electron's system libraries and a disposable X display:

```sh
pnpm install
# The desktop manifest ships Windows binaries. For this Linux development run,
# expose the Linux binary already installed by the local-postgres workspace.
ln -s ../../../../packages/local-postgres/node_modules/@embedded-postgres/linux-x64 apps/desktop/node_modules/@embedded-postgres/linux-x64
node apps/desktop/build.mjs
DISPLAY=:179 node packages/app/evidence/native-desktop/prove.mjs
pnpm survey:coverage app
```

Use an unused display number and run Xvfb there first; stop it after the proof.
On Mint this run used a user-local extraction of Ubuntu's Xvfb package, with no
system configuration change. The dependency link is inside ignored node_modules;
skip that command if the native package already resolves. The proof takes the
machine heavy-run lock, stops the application and its database, and removes its
throwaway home. It never reads the owner's library.

Observed red: changing the preload's update channel to a nonexistent handler
failed at the actual renderer IPC request (`43c12336`). Green restores the
existing channel while moving its unchanged bridge object into `createBridge`
and the unchanged icon decoding into `createTrayIcon` (`bb28625f`).

`observations.json` records the green source commit, hashes of the seven source
files, database lifecycle observations and measured allocation weights.
`functions.json` retains positive V8 function records and bundle/source-map
hashes. The original runtime offsets are retained; module-only functions do not
contribute allocation. `survey-browser-coverage.json` holds recorder output;
`survey-coverage.json` combines it with the measured App Node proofs.

The run checks a live SQL query before and after closing, the same database PID
after reopening, native second-instance handling, checkout refusal with no
runtime directory created, graceful zero exit, and database termination. Normal
startup executes the real tray/icon path. This is Linux development execution;
it does not attest a visible system tray menu, installed Windows updating, or
every branch of these files. Main coverage is captured before quit; graceful
shutdown is established by process/database assertions.

Same-plan `readCodeSurvey` before → after:

| Scope | Unclaimed / total nonblank source lines |
| --- | --- |
| Project | 2,595 / 67,827 → 1,801 / 67,836 |
| App including Desktop | 1,770 / 4,112 → 976 / 4,121 |
| Seven assigned files | 794 / 794 → 0 / 803 |

Only these seven files change ownership. The frame gains nine nonblank lines;
no story-specific behavior or appearance changes. Remaining App allocation is
the coordinator's separate mounted-surfaces increment.
