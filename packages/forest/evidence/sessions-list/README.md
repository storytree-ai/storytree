# Running sessions: current bottom-strip evidence

Refreshed for `increment_bdcb6eabee69` on 2026-10-02 using the current desktop
renderer and the shared capture lifecycle. This replaces the fixture's obsolete
left-panel, off-plan threshold and `needs you` expectations. Product code and
contracts are unchanged.

The strip starts expanded; **individual rows start collapsed**. That distinction
is pinned by contracts 7.8 and 7.17 (`contract_46cd303512df`). Quiet sessions start
behind `N idle` (7.10). Active unclaimed sessions remain listed even when they have
edited no files or only one; a push is not a membership rule. A parent with an open
question gets no `needs you` prose or special label colour (7.9). Absent context
readings leave empty bar slots, unavailable totals and no guidance marks (7.6).

The seed uses a prior read-only library snapshot with synthetic session activity:
one supervisor holding two stories, one logged child, one observed explorer,
one idle session, three active unclaimed sessions and one ended session. The idle
session is 35 minutes quiet: beyond the default idle threshold and within the
leave threshold. Two explicit window-file readings exercise resident and gone
files in current row detail. The snapshot predates capability status words, so
those fixture words are filled from its recorded verified contract states before
opening a story panel. No live library or transcript is read or written.

## Captures and measurements

- [Default strip](sessions-list.png): four active root rows, collapsed individually, and `1 idle`.
- [Hover links to islands](sessions-list-hover.png): both held islands brighten with neutral rings; the others dim.
- [Idle group opened](sessions-list-idle.png).
- [Row detail and children](sessions-list-expanded.png): explicit child rows and window files, including the muted gone file.
- [Story panel open](sessions-list-panel.png): the strip makes room for the panel.
- [Machine measurements and assertions](capture.json).
- [Observed stale-fixture failure](refresh-red.txt): the old capture times out expecting the idle row to start visible.

At **1440 × 960**, the strip measures **1440 × 185.844px**, ending at the bottom
of the forest pane. With a **480px** story panel open at x=948, the strip becomes
**936px** wide and leaves a **12px** gap before that panel. The default contains
four visible session rows; the idle control exposes the fifth root explicitly.
The expanded view exposes two child rows and the seeded file detail.

The browser checks actual material hover/focus/restoration, one expander per row,
independent strip folding, preservation of row expansion through polling, a child
ending, and batched arc refresh after a question changes. All checks pass with no
browser errors. The only captured warning is Three.js's Clock deprecation.

By **Legible at the resting view** (`principle_1e3418812c33`), the captures show the
session labels, child counts, empty context slots and unavailable totals as
separate readable signals. The gone file is visibly muted. The panel capture
shows the measured separation between surfaces. These observations describe the
seeded captures; they do not record owner acceptance.

## Reproduce

From the checkout root:

```sh
flock /tmp/storytree-heavy.lock node --import tsx packages/forest/evidence/sessions-list/build.mjs
flock /tmp/storytree-heavy.lock node --import tsx packages/forest/evidence/sessions-list/capture.mjs
```

The default writes to `/tmp/storytree-captures/packages/forest/evidence/sessions-list`.
Append `--retake` to replace the committed pictures and measurements explicitly.
`CAPTURE_PLAYWRIGHT` and `CAPTURE_CHROMIUM` provide optional browser overrides.
The shared runner closes the browser and asset server on success or failure.
Generated bundles stay in ignored `dist/`.

`red.txt`, `green.txt` and `library-update/` preserve the original implementation's
historical evidence. They are not current gate results or current product guidance.
