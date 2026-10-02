# Waitlist browser evidence

The waitlist replaces both install entry links and the install section. The blank form, its native optional choices, the one-email promise and the adjacent AI disclosure are pictured at 1440 px and 390 px; “How we keep this” is expanded in the section pictures. These are evidence of the built appearance, not an owner acceptance.

- [Laptop, 1440 px](1440-waitlist.png)
- [Phone, 390 px](390-waitlist.png)
- [Full laptop page](1440.png) and [full phone page](390.png)
- [Measurements](measurements.json), [200% text measurements](enlarged-measurements.json), and [browser observations](observations.json)

The reproducible capture uses the existing `storytree-opening-seen=yes` return-visitor setting before navigation and reduced motion. This removes the opening's scroll-to-exit reflow from the waitlist pictures. The separate existing Chapter 1 proof runs without that setting. The forms in the appearance pictures are blank; synthetic offline success evidence is separately named `visit/offline-synthetic-joined-390.png`.

## Observed behaviour

The original browser check failed before the markup existed: the no-JavaScript visit had no waitlist LinkedIn fallback. The completed browser run checks the fallback and preserved repository/license/contact links; keyboard and touch navigation from both waitlist links; native disclosure opening; invalid email without a request; one pending request despite a second activation; HTTP 429, 403 and 500 with email and both choices retained; focus retained on submission and not reclaimed after Tab; and an unchanged retry reusing one idempotency key. Success appears only after the intercepted host response accepts it. The waitlist works while the scene code is held, and stays available without WebGL or when the scene fails.

All four synthetic submission attempts were intercepted inside the browser on the locally served build. No live sign-up, deletion, invitation, owner credential or private data was used. The harness's `--url` path does not submit: it records the live insertion proof as not observed and awaiting the owner's approval and address.

## Appearance against the named principles

**Legible at the resting view** (`principle_1e3418812c33`): the page has one email input and six clearly labelled radio choices, grouped into two optional questions. The content occupies 1180 of 1440 px (81.9%) on laptop and 350 of 390 px (89.7%) on phone. The email is 16 px; the choice labels are 14 px. All 16 measured standalone targets are at least 44 px high. Email and submit keyboard focus are 3 px wide with 6.89:1 contrast against the paper background and fit inside the form. Labels, the promise, AI disclosure and expanded retention/deletion copy remain readable in the captured composition. Normal 320/390/1440 px layouts and text enlarged to 200% at 320/390/1280 px have no horizontal overflow.

**The resting view is designed, not fitted** (`principle_43ea5d4f68c4`) and **ADR-0841 D3**: the existing paper/ink palette and section rhythm stay. The laptop composition keeps the invitation heading beside the form; the phone stacks them so email and choices keep their width. The secondary storage details take one native disclosure action. The phone section scrolls vertically to hold the full disclosure instead of shrinking its type or controls.

## Reproduce

Run from the worktree root after the website build:

```sh
WEBSITE_SHA=$(git rev-parse HEAD) pnpm --filter @storytree/website build
node packages/website/evidence/capture.mjs waitlist --verify-enlarged --verify-opening
node packages/website/evidence/acceptance-run/harness/visit.mjs packages/website/evidence/waitlist/visit --commit <built-commit> --evidence packages/website/evidence/waitlist/visit > packages/website/evidence/waitlist/observations.json
```

The Chapter 1 proof passed playback, joke, turn, exits, sound, storage and static fallbacks. The capture checks passed normal layout, minimum target heights, keyboard focus and enlarged text on home and 404 pages. The browser observations contain the individual machine results. `local-worktree` in the saved observations means captured before the enclosing green commit; the session records the final commit through the existing acceptance flow.

## Storage and publication references

Implementation sources read on 2026-10-02: [here.now Site Data reference](https://here.now/docs#sitedata) and [here.now agent pack](https://here.now/llms-full.txt). The manifest uses documented email validation and string length limits. Allowed computer/agent choices are checked by the client; the documentation does not provide a server enum schema. Public insertion and explicit owner-only read/update/delete are in the build's `.herenow/data.json`.

Finalize warnings make the publisher fail loudly. A warning can be returned after publication has occurred; failure does not imply an atomic rollback. Live manifest/finalize evidence and anonymous-read refusal are checked after CI publishes. A stored live row and subsequent deletion require the owner's explicit approval and a supplied address; this evidence makes no such claim.

The final pre-merge browser run retains an external failure: GitHub returned HTTP 503 for the unchanged license link (a repeat also saw HTTP 504 for the repository). The local waitlist, fallback, navigation, focus, enlarged text and 3D-fallback observations passed. The repository API resolves the license to the same URL and its existing blob; this does not turn the failed browser delivery observation into a pass. The session report records any later recheck.
