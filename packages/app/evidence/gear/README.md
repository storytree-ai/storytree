# Gear menu — increment_733585dbef10

One 36 × 36 px gear replaces the app bar. Its 256 × 210 px menu holds the project
switcher, Help, and disabled places for Check for updates and Settings. The app story owns
the controls and their stylesheet through `@storytree/app/view`; desktop only mounts them.
App-setup's help accepts a mount-time return-focus target. Project selection still uses the
existing service, including its failure recovery and saved-choice rules.

The owner accepts the appearance. These are unedited **Electron `pnpm desktop:smoke`**
window captures of the supplied real snapshot: 1,628 records, 10 stories and 71 capabilities.
The independent arc drawer is open because the existing smoke check exercises it.

- [Menu closed](menu-closed.png)
- [Menu open](menu-open.png)
- [Project switcher open inside the menu](project-switcher-open.png)
- [Electron state and drawing readings](electron-capture.json)
- [Behaviour and geometry measurements](capture.json)
- [Red proof](red.txt)
- [Library text patch and supervisor checklist](library-update/README.md)

**Appearance observations for the owner.** Under *Legible at the resting view*, the gear is
20 px within its 36 px target, and menu action text is 14 px. Under *The resting view is
designed, not fitted*, the menu has a fixed compact width, stays 12 px from the right edge,
and fits the tested 360 px narrow viewport. At the headless check's 1440 × 960 viewport,
the open menu covers 3.9% of the frame. Under *Meaning outranks appearance*, the future
actions are visibly disabled and the existing project choice is identified in its list.
The palette reuses the forest controls' `#101418`, `#485159`, `#eceae3`, `#a9b0ba` and the
existing hover `#262a2f`. These observations are evidence for review, not visual acceptance.

**Checks.** `pnpm gate` runs typecheck and the full suite because the app's new `/view`
export changes its manifest. Guidance is NOT RUN: no role or supporting guidance note
changed. The app's portable rendering tests pin the accessible native popover and switcher;
the reused browser route asserts actual geometry, click/Escape/outside dismissal, focus,
forest pointer input, successful switching, failed-choice recovery, help and the smoke census.
It uses a temporary second project only after all real-snapshot captures. The pre-existing
project-switch smoke also passes after opening the gear before choosing projects.

Reproduce the renderer acceptance (installed Playwright and Chromium can be supplied with
`STORYTREE_PLAYWRIGHT` and `STORYTREE_CHROMIUM`):

```sh
flock /tmp/storytree-heavy.lock node apps/desktop/build.mjs
flock /tmp/storytree-heavy.lock node --import tsx packages/app/evidence/gear/capture.mjs
```

For the three final Electron captures, restore into an empty temporary home and supply a
working X display. On this Mint box, Xvfb was extracted under `/tmp/gear-xvfb` without
changing system packages; the already-installed Linux Postgres package was temporarily
linked into desktop's ignored node_modules because desktop declares Windows binaries only.
`electron-capture.mjs` drives the real command through CDP and leaves capture/verification to
that command. For the open project picker, it saves a CDP screenshot of the same smoke
window: Electron's `capturePage()` omits that popup, even while the native `:open` state is
true. Both paths capture the actual window without editing pixels. It waits for the smoke window to become visible before opening either popup.

```sh
export STORYTREE_HOME=$(mktemp -d)
node --import tsx scripts/restore-library.mjs \
  /home/mickh/storytree-lanes/snapshots/2026-09-28T07-26-00-491Z.json --project storytree
DISPLAY=:97 STORYTREE_EMBEDDER=off flock /tmp/storytree-heavy.lock \
  node packages/app/evidence/gear/electron-capture.mjs
```

Run Electron capture last: the headless renderer route uses the same three image paths.
The scripts close their browsers, temporary servers and databases. No live store, claim,
question or decision was written, and no forest or arc-surface file was changed.

**Follow-up for the supervisor.** The native smoke logs record successful census verification
and exit 0, followed by existing IPC polling during shutdown that reports “the library is not
open” (for example `menu-closed-smoke.txt`, after its `smoke: project` line). The browser
interaction run records zero page errors while running. The shutdown race is in desktop's
main-process lifecycle, outside this lane's fence; retain it as a separate lifecycle follow-up.
