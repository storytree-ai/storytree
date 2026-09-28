# Check for updates in the gear — increment_520384015d37

Check for updates is enabled in the existing top-right gear. It asks the same updater as the
three-minute background check, and shows progress inside the menu. The app story now owns the
check/build/restart controller. Desktop supplies the runtime, lifecycle and seed-write guard,
carries one IPC request/status call, and mounts the view.

Concurrent checks share one operation. A ready build waits for library seeds without rebuilding;
the initial own-health write also finishes before updates can restart the app. The restart status
gets 750 ms to paint, then the seed guard is checked again. Failures show their reason and allow
retry while leaving the running app alone. A checkout explains that it does not update itself.

The owner accepts the appearance. The lane has **not** accepted it. These are unedited
`pnpm desktop:smoke` Electron window captures using the supplied real library snapshot:

- [Enabled menu entry](menu-enabled.png)
- [Up to date, with the running build](up-to-date.png)
- [Checking](checking.png)
- [Building the update](building.png)
- [Ready, waiting for a library writer](ready.png)
- [Restarting](restarting.png)
- [Failed, with the reason](failed.png)
- [Not running from a runtime slot](unavailable.png)
- [Electron capture provenance and smoke readings](electron-capture.json)
- [Browser interaction and geometry readings](capture.json)

**What is real and what is simulated.** The snapshot contains 1,628 records, 10 stories and
71 capabilities. Project reads, the forest and the smoke census use that data. Enabled-menu
and unavailable captures use the unmodified production view and real IPC. Other outcomes use
the production `mountUpdates` view mounted by the capture harness with simulated responses;
only the two update controls are cloned to detach their original listeners. The surrounding
Electron window stays real. No update is triggered by pushing a fixture to main, and no image
pixels are edited. The existing smoke command opens the arc surface before capturing.

**Appearance observations for the owner.** Under *Legible at the resting view*, the action keeps
the existing 14 px menu text; the status uses a 12 px heading and explanation directly beneath
it. Under *Meaning outranks appearance*, busy states disable duplicate clicks, a ready update
explains the library-write wait, and failure text remains selectable plain text. Under *The
resting view is designed, not fitted*, the original 256 × 210 px resting menu is preserved.
A long failure wraps at a 360 px viewport within 256 × 419 px, without horizontal scrolling.
The status uses only the forest controls' existing
`#eceae3` and `#a9b0ba`, on the existing `#101418` menu background. These are observations,
not visual acceptance.

**Verification.** [red.txt](red.txt) records the missing controller and disabled-entry failures
before implementation. [green.txt](green.txt) records typecheck, the affected-package test
table and the focused controller/menu tests. [test-ratio.txt](test-ratio.txt) holds the ratio
report. [focus-red.txt](focus-red.txt) records the browser finding that disabling the active
update button lost keyboard focus; dismissal now restores the gear when focus fell to the page.
The browser rerun verifies both Escape focus and outside pointer input after that repair.
Real-git tests still verify that only merged main is built in the other runtime slot
and that a broken build leaves the running slot unchanged. Controller tests pin manual checks,
deduplication, progress, seed waits, periodic checks, initial health preparation and shutdown.
The browser route checks real DOM interaction, polling while closed, reopening, retry, IPC
failure, safe plain-text errors, narrow fit, keyboard focus and the real-snapshot census.
Guidance is NOT RUN: no agent role or supporting guidance note changed.

Reproduce browser evidence after building (both commands take the shared heavy-work lock):

```sh
flock /tmp/storytree-heavy.lock node apps/desktop/build.mjs
flock /tmp/storytree-heavy.lock node --import tsx packages/app/evidence/gear-updates/capture.mjs
```

For Electron, restore the supplied snapshot into a new throwaway home and use a working X
display. The Mint route reuses the gear lane's extracted Xvfb and ignored Linux Postgres
binary link; it does not change system packages. `STORYTREE_PLAYWRIGHT` and
`STORYTREE_CHROMIUM` can override the browser paths used by the evidence scripts.

```sh
export STORYTREE_HOME=$(mktemp -d)
flock /tmp/storytree-heavy.lock node --import tsx scripts/restore-library.mjs \
  /home/mickh/storytree-lanes/snapshots/2026-09-28T07-26-00-491Z.json --project storytree
DISPLAY=:97 STORYTREE_EMBEDDER=off flock /tmp/storytree-heavy.lock \
  node packages/app/evidence/gear-updates/electron-capture.mjs
```

The supervisor applies the [library patch and checklist](library-update/README.md), takes
the captures to the owner, and closes the increment. The lane does not access either live
store or create claims, decisions or questions. No decision-log or agent-role curation was
needed; the new durable behaviour and proof are included in the proposed library patch.
