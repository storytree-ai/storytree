# Hold automatic updates for an acceptance run

Increment `increment_c3e1441890f9`, Updates contract 4.12
(`contract_23e0e160bc87`). No owner/laptop acceptance run was performed here.

The installed app must first have a release containing this change. The updater
reads holds from its storytree home immediately before each automatic install,
so the app may already be running when the trial starts. Downloads still proceed.

Run a foreground command under the standalone wrapper:

```text
node packages/app/src/updates/hold-run.mjs <storytree-home> <run-name> <minutes> <executable> [args...]
```

The wrapper needs only Node built-ins and can be copied as one file alongside an
acceptance runner. Pass the same storytree home the installed app uses; for the
normal Windows install it is `%USERPROFILE%\.storytree\0.3`. For example, from
PowerShell in a checkout (replace the final script with the actual foreground run):

```powershell
node packages/app/src/updates/hold-run.mjs "$env:USERPROFILE\.storytree\0.3" "Codex trial F4" 60 powershell.exe -NoProfile -File C:\trials\run-trial.ps1
$trialExit = $LASTEXITCODE
```

The supplied executable must wait for the entire trial. A launcher that detaches
a session and exits releases the hold too soon; wrap the supervising command that
waits for that session to finish. `.cmd` and `.bat` launchers need their command
interpreter explicitly; the wrapper launches an executable without a shell.

Choose a positive duration of at most 360 minutes that covers the intended run.
The wrapper creates a unique hold before starting the command and removes only
that hold when the command ends, even after a nonzero exit or a failure to launch.
It returns the command's exit code (1 for a launch error or signal termination).
Other concurrent runs' holds remain. A killed wrapper or restarted computer can
leave its file, but the hold expires at its fixed deadline. The wrapper does not
extend its deadline or terminate the trial when it expires.

While held, the gear's existing update status and release log name the run. The
user's **Restart to update** action deliberately overrides the run hold, while
still waiting for any seed writing the library. Releasing/expiring a hold permits
the next normal update check; the ten-minute quiet rule still applies. A hold
cannot undo an installation already started before the wrapper acquired it.

## File protocol

Each run publishes a unique `update-holds/<id>.json` beneath the app's storytree
home, by writing a temporary file then renaming it. Contents are a nonempty `run`
name and numeric Unix-millisecond `startedAt` and `expiresAt` values. Only holds
whose start is at or before now, expiry is after now, and total duration is at most
six hours count. Expired, invalid and partial JSON files cannot disable updates
indefinitely. An unreadable directory or hold fails the update check and leaves the
running app alone. The updater does not delete stale files; a runner may remove its
own leftover file after confirming its run has ended.

## Evidence

- Red commit: `f9a2f639`. Both release-hold cases returned `restarting` instead
  of `waiting`; the run-wrapper cases failed because the wrapper did not exist.
- Green: `pnpm run test packages/app/src/updates/releases.test.ts packages/app/src/updates/hold-run.test.ts`
  passed all nine tests on Mint, using the real release feed/download/checksum
  path and harmless installer bytes. No installer is executed.
- The tests cover release after a run, independent overlapping holds, expiry,
  invalid ceilings, downloads continuing, the explicit-install override with a
  seed still writing, and a real child observing its hold before returning exit 7.
- Local transcripts: `/tmp/st03-appsetup-red.log`,
  `/tmp/st03-appsetup-wrapper-red.log`, `/tmp/st03-appsetup-green.log`.
  CI runs these same contract tests on Linux, macOS and Windows.
