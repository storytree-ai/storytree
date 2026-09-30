# Project-map copy review · 2026-09-30

The home page now names the app's current project map rather than capability trees.
ADR-0804's flat story islands landed in PR #333; file circles on capability territories
followed in the app in PR #337. The website follows the shared engine and promises only
what its own saved snapshot and renderer actually draw. The hero
states that health is reported by agents. The install heading names the action plainly.

Site-b has not rendered a snapshot yet. The future-tense message is inside
`#website-forest`, ready for that mount to replace; no surrounding caption claims
that saved data is already on screen. The blank map is unfinished sibling work,
not a new visual design for the map.

## Captures and browser proof

Run after the static build:

```sh
node packages/website/evidence/capture.mjs map-copy --verify-controls
```

- [Desktop, 1440 px](1440.png)
- [Phone, 390 px](390.png)
- [Narrow phone, 320 px](320.png)
- [Phone command focus](390-focus-command.png)
- [Phone copy focus](390-focus-copy.png)
- [Measurements](measurements.json)

All three widths have no horizontal overflow or browser errors. JavaScript-disabled
reading, exact clipboard success and denial, pending focus, duplicate prevention,
Tab-away, touch activation and the 404 home link pass. The nine measured standalone
controls remain 44 px high; command/copy focus remains fully inside the panel at
10.45:1 contrast.

## Independent review

The frontend-builder reviewed all three captures against the library principles:

- **Legible at the resting view:** hero text is 22 px on desktop and 16 px on phones.
  The extra phone line moves the map down 28 px without crowding the action; the
  legend wraps cleanly at 320 px.
- **The resting view is designed, not fitted:** desktop keeps separate introduction
  and action columns; phones retain a single column and 20 px gutters.
- **Meaning outranks appearance:** agent-reported health is explicit before the
  install action.

No new typography or layout defect was found. This review records evidence and
judgment, not the owner's acceptance of the look.

## Build weight

Local emitted byte counts (raw / locally gzipped): HTML 6,046 / 1,975; CSS
8,068 / 2,535; main script 800 / 442. These three total 4,952 gzipped bytes.
No external fonts or images are loaded by the home page.

The renderer stub still requests 1,252,134 raw bytes plus a 638-byte shared chunk.
Lazy loading, the real map and its still belong to site-b's pending contracts;
this copy change makes no performance claim for the completed scene. Local gzip
sizes are comparisons, not observed here.now transfer sizes.

The full local gate passes on the PR #337 base: typecheck and all package tests.
Guidance was not run because no agent role or its underpinning notes changed.
Copy is reviewed against the product; no tests pin its wording (ADR-0623).
