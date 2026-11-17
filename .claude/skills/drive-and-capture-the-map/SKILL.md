---
name: drive-and-capture-the-map
description: "Drive and capture storytree's 3D map for evidence: which seed shows what (five-story row and chain for 1.10, the full code survey for gates, never a one-island seed for a forest contract), waiting for the layout to settle, clearing dialogs and the Help tab, turning, tilting and zooming in code (window.__globe, storytreeGlobe.face, zoomGlobe, captureSequence frame sequences and contact sheets), taking the angle a contract needs (side on for plate and glass thickness), and what never to raise (name labels, taste). Use when building, driving or reading a change drawn on the map or its panels."
---

<!-- GENERATED from the library's "Drive and capture the map" process; do not edit by hand. Regenerate with `pnpm build:guidance`; `pnpm check:guidance` fails when this file has drifted from the library. -->

# Drive and capture the map

The map is a 3D view that turns, tilts and zooms, so a picture of it is evidence only when it was taken on the right seed, after the layout settled, with nothing covering it, at a pose set in code and at the angle the contract needs. Most map drives that failed since 2026-11-01 never reached the state they judged, or judged name labels, which are not a finding (research_9acaae780a1d). This is the know-how for driving and capturing the map, for whoever builds a look, drives a check or reads the pictures.


## When to use

You build, drive or read a change drawn on the map or its panels: a frontend-builder's look, a change-reviewer's drive of a map contract, or a reader judging map pictures. Not for flat screens with no map in them, though steps 3 and 6 hold there too.


## Steps

### 1. Pick the seed that shows the thing

A drive that never reaches the state it judges is the commonest failed map reading (35 of 114 since 2026-11-01, research_9acaae780a1d). Choose the seed from what the contract is about, never from what is quickest to load, and never submit the generic smoke launch (one seeded "Smoke story", window open and closed, exit 0) as a drive.

- **A forest contract** (how islands sit together, roads between them, the opening view): a seed with several stories. Never trim a seed to one island or to The library for it (friction_9d179edf33e0): one island shows nothing about a forest.
- **1.10** (a five-story forest opens with every island in view and facing the eye at least half on, in a row and in a chain): the five-story row and chain fixtures (`forest(chain)` in packages/forest/src/view/five-stories.test.ts), both shapes, never storytree's own map.
- **Gates, roads and anything the code survey draws:** the full survey. `captureSeed('code-rows')` returns storytree's own library with its survey; when it lacks an island you name, `seedHolding(islands)` from fresh-seed.ts builds a fresh pair read-only. The eight-story `captureSeed('forest')` seed has no survey, so it draws no gates.
- **A real library instead of a snapshot:** `liveAnswers` from live.ts, as apps/desktop/src/capture/README.md says.

The capture kit (`apps/desktop/src/capture`, its README the reference) builds the page (`buildCapture`), serves it with a stand-in bridge, and runs views (`runCapture`, or `withCapture` for a script of its own). Copy the nearest capture under packages/forest/testing/view rather than writing a harness. Run a capture in the foreground behind the heavy-run lock: `node ~/.storytree/your-factory/plugins/micks-dev-loop/src/heavy-lock.mjs -- node --import tsx <capture.mjs>`.

### 2. Wait for the layout before any picture

The map lays its islands out after it opens, and says so: a pill reading "laying out …" and the mark `data-layout="laying-out"`, which becomes `data-layout="settled"` when every island is placed. Never take a picture while the pill reads "laying out".

- `settle(page)` renders 12 frames and, while the map says it is laying out, waits until it says it has settled; `runCapture` runs it before each view, and a `withCapture` script calls it before its pictures.
- `settledMap(page)` in a `prepare` waits until `data-layout="settled"` holds for 12 frames running, and fails after 180 s naming the map's progress. A shared seed opens with its kept layouts, so it settles in seconds; a seed without them searches each island, minutes each.
- After a turn, a zoom or a camera stop, wait for stillness (`window.storytreeGlobe.still()`) and settle again before the next picture.

### 3. Clear what covers the map

Before a picture, nothing may sit between the eye and what the contract is about: a consent or sharing dialog, the first-run guide, a teaching card, the Help tab, or an opened panel the view does not judge. The stand-in bridge opens with the guide seen and every teaching card hidden (pass `guide: 'unseen'` or `teaching: 'shown'` only to picture those); anything else is dismissed in the view's `prepare`, and the picture is checked for it before it is judged. `visibleGlobeTargets` returns scene coordinates only, so a panel can still cover a target it names.

### 4. Turn, tilt and zoom in code, never by hand

A hand-panned view is not evidence: the same call must take the same frames.

- `window.storytreeGlobe.face({ kind: 'story', story })` turns the camera to a story at once, no glide; `window.storytreeGlobe.islands()` lists what is drawn and `still()` says when the globe is at rest.
- `window.__globe` holds the scene, `camera`, `controls` and `invalidate()`, for reading the scene and for a pose no helper sets.
- `zoomGlobe(page, target)` wheels the eye to a zoom (CSS pixels per unit at the middle of the view) within 3% and returns what it reached; `visibleGlobeTargets(page)` returns the opening zoom to scale from.
- `captureSequence(page, { kind: 'turn' | 'tilt' | 'zoom', from, to, frames, out, view })` poses the map at each evenly spaced step, settles each, writes `<view>-01.png` … and one captioned contact sheet `<view>-sheet.png` 2576 px wide, and puts the map back as it was (contracts 2.65, 2.66). Claude takes no video: a contract that says "as the globe turns", "side on" or "at every angle" is driven with a sequence, not a still. Read the sheet with the Read tool first, then any one frame it needs.

### 5. Take the angle the contract needs

A camera looking straight down cannot show a thickness. Plate and glass thickness (4.23, every island a raised plate standing on the glass; 4.27, the glass a lit slab with a rim round both faces) are judged side on: a `tilt` sequence running towards edge-on (90 degrees), or a still posed near it, never the resting top-down view. A contract about the resting view (1.10, the opening) is judged at the resting view, untouched. Name in the drive's trace the pose each picture was taken at.

### 6. What never to raise

Judge a picture only for what it shows against the contract or a named principle (ADR-1328 D1); taste is not a finding.

- **Name labels.** A nameplate or a capability's name shown cut off, clipped, faded, overlapping, wrapped or truncated is never a finding, a failed drive, an "on main" answer, a parked increment or a question to the owner (ADR-1346 D1), even where contract 3.4 or 1.10 once described how names show. In Mick's words: "When we talk about the labels, I don't really care about that much, it's not really impacting me, it's being nitpicky." A false name, or a name whose click opens nothing, stays a fault.
- **Taste.** Spacing, colour, placement or size where nothing shown is wrong, and anything Mick has not complained of, is never raised and never written into an end state (ADR-1326, ADR-1328).
- **"Does it look right?"** A built look lands with its pictures; he raises what looks wrong (ADR-0794).

### 7. Hand the pictures on

Upload the frames and sheets with `pnpm evidence:upload --pr <n> --readme <the evidence folder's README> <file…>`, never commit them (ADR-1234 D1), and give each picture's pose, seed and settle in the trace a reader or the pull request reads.


## Surfaces

The capture kit, apps/desktop/src/capture (its README is the reference): `buildCapture`, `runCapture`, `withCapture`, `settle`, `settledMap`, `captureSeed`, `seedHolding` (fresh-seed.ts), `liveAnswers` (live.ts), `visibleGlobeTargets`, `zoomGlobe`, `captureSequence`. In the page: `window.storytreeGlobe` (`face`, `islands`, `still`) and `window.__globe` (scene, camera, controls, `invalidate`). Captures to copy: packages/forest/testing/view/*/capture.mjs. Evidence: `pnpm evidence:upload`.


## Failure modes

What the 114 map and panel drive readings that did not pass since 2026-11-01 failed on (research_9acaae780a1d, approximate): name labels, now never a finding (32); a drive that never reached the state it judged: the smoke launch submitted as the drive, a dialog or the Help tab over the map, a picture taken while the pill read "laying out", a seed trimmed to one island, a capture that threw before saving, or a top-down camera on a thickness contract (35); an angle or motion a still could not show (6).


## Verification

Every picture handed on names its seed and pose, was taken after the map said `data-layout="settled"` with nothing covering what it judges, and a contract about motion or thickness was shown by a sequence or a side-on pose; no finding is about a name label or taste.


## Stands on

Notes in the library; find one by its title with the MCP server's `search_notes`.

- Map UI work: a skill plus the existing frontend-builder, no new judging reviewer, and seeded frame sequences with contact sheets (research, 2026-11-17)
- Name labels on the map (nameplates, capability names) cut off, clipped, overlapping or truncated are never flagged unless the owner has complained of them (narrows ADR-1328 D1)
- Every reviewer of the app raises only faults, dead ends and unmet contracts, judges from a picture only what it shows, and never writes taste into an end state (extends ADR-1326, narrows ADR-1295 D2)
- Read a screen: can you tell it, and where do you look
