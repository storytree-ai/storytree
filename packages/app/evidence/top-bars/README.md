# Two top bars and the app overlay — increment_ab7dfdce93bc

The app has a full-width 48 px bar holding only its gear. The separate 48 px arc bar
below it says Arcs, with no project name. The forest starts at 96 px and the arc drawer
opens below both bars. The gear opens a large centred overlay with Projects, Settings,
Updates and Help; gear, Escape, Close and backdrop dismiss it. The background is inert
while it is open, and a backdrop click does not become a forest gesture.

The app owns the frame, switcher and existing updates surface. The agent link mounts
its existing settings panel; app-setup mounts its existing Help, including the first-run
offer. The desktop only supplies the mount and bridge. The settings writers, update
service, drawer behavior and forest code are unchanged.

## Captures for the owner

These are unedited CDP screenshots of the actual **`pnpm desktop:smoke` Electron window**,
using the supplied `2026-09-28T09-15-09-235Z.json` snapshot restored into an isolated home:
**1,677 records, 10 stories and 71 capabilities**. Each command also runs the forest census
and all-scope arc smoke verification and exits successfully. CDP captures the current
composited viewport; Electron's own `capturePage()` sometimes retained an earlier frame.

- [Closed bars](bars-closed.png)
- [Arc drawer open](arcs-open.png)
- [Projects](overlay-projects.png)
- [Settings](overlay-settings.png)
- [Updates](overlay-updates.png)
- [Help](overlay-help.png)
- [Narrow Settings](narrow-settings.png)
- [Native capture state and geometry](electron-capture.json)

The six wide captures are 1120 × 860. The narrow capture uses a 360 × 640 CSS viewport
in that same Electron route; the desktop's existing native window minimum remains
640 px. CDP captures that CSS viewport directly, with no image post-processing. The development
build cannot update itself, so Updates honestly shows its existing unavailable state.
Settings reads the actual defaults from the isolated home; no production settings change.

**Appearance remains for the owner to accept.** Under *Legible at the resting view*,
the gear is 20 px inside a 36 px target, section labels and controls are 14 px, and section
headings are 22 px. Under *The resting view is designed, not fitted*, the wide overlay
has 32 px outer margins and the narrow one 12 px; navigation becomes a row at narrow
widths, and Settings scrolls without horizontal overflow. The measured 1440 × 960
browser overlay is 1376 × 848, or 84.4% of the frame. Under *Meaning outranks appearance*,
the bars keep their separate purposes, the active section has one selected state,
and settings retain value/source/meaning beside their controls. The palette reuses
`#101418`, `#485159`, `#eceae3`, `#a9b0ba`, and `#262a2f` from existing forest controls.
These are observations for review, not visual acceptance.

## Verification

- [Red proof](red.txt), [red geometry](geometry-red.txt), and [green unit tests](green-unit.txt).
- [Project error regression red](project-error-red.txt): its reason must remain visible
  inside Projects after a failed choice.
- [Browser behavior and geometry](capture.json): both bars, drawer placement, all four
  closing routes, focus return/containment, native picker Escape, inert background,
  forest input below bars and drawer, Settings save, Help license, update action,
  project switch/retry, narrow fit, first-run Help without a project, and zero page errors.
- [Typecheck](typecheck.txt) and [test suite](green.txt): the scope is full because
  agent-link is used by the harness. Every package and scripts passed. The Cloud SQL
  identity-dependent live proof retains its existing explicit skip.
- [Repository gate](gate.txt): typecheck and tests pass; guidance is not required.
- [Test ratio](test-ratio.txt): a report, not a gate.
- Guidance: **NOT RUN** — no generated roles or supporting guidance notes changed.
- [Library patch and supervisor checklist](library-update/README.md).

Reproduce browser checks after building, using installed Playwright/Chromium (optional
`STORYTREE_PLAYWRIGHT` and `STORYTREE_CHROMIUM` override the Mint paths):

```sh
flock /tmp/storytree-heavy.lock node apps/desktop/build.mjs
TOP_BARS_NO_IMAGES=1 flock /tmp/storytree-heavy.lock \
  node --import tsx packages/app/evidence/top-bars/capture.mjs
```

For native captures, restore the supplied snapshot into a fresh `STORYTREE_HOME`, then
run with a working X display. On Mint, the gear lane's extracted Xvfb was reused and
the installed Linux Postgres package was linked temporarily into desktop's ignored
node_modules. Both the display and temporary link are removed after the command.
The driver observes smoke's final scope sweep before setting its requested section,
so it does not interrupt the drawer's verification. Through the child Electron inspector,
it extends only smoke's one 800 ms screenshot delay to six seconds, then restores the timer.
This gives the software GPU and CDP time to capture; every smoke assertion still runs.

```sh
export STORYTREE_HOME=$(mktemp -d)
node --import tsx scripts/restore-library.mjs \
  /home/mickh/storytree-lanes/snapshots/2026-09-28T09-15-09-235Z.json --project storytree
DISPLAY=:97 STORYTREE_EMBEDDER=off flock /tmp/storytree-heavy.lock \
  node packages/app/evidence/top-bars/electron-capture.mjs
```

The scripts stop their browsers, servers and temporary databases. No live store,
claim, decision or question was read or written. The supervisor applies the library
patch and closes the increment after merge; the snapshot predates the Settings
contract IDs from #182, so the checklist explicitly reconciles that landing first.

**Existing lifecycle follow-up.** Some native smoke logs still print “the library is
not open” from IPC polling after the successful census, during shutdown. The gear
lane already recorded this in its README. Desktop main-process lifecycle is outside
this lane's fence; the running browser checks report zero page errors.
