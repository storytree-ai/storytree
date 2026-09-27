# Looking inside the globe

The knowledge core's capability 4 (`stories/knowledge-core.md`), following the owner's
ADR-0647 picks E1, V1, S1 and T1. "Look inside" sits between Globe and Forest. It hides the
sea and islands, keeps the globe's turn, its failure markers and the selection, and draws the
project's notes at @storytree/knowledge-core's positions. Globe brings the islands, sea and
selection back as they were.

## Pictures

Renderer: headless Chromium 148 (SwiftShader), 1440 × 900, dark theme, driven by
`playwright-core`. It loaded the real desktop renderer, HTML and styles, with only Electron's
bridge replaced by reads captured through the library's public API on the test Postgres. Every
picture was taken after the same pointer drag, so the core is seen from an angle rather than end-on.

- [The real seed](core-seeded-turned.png): this repo's stories and decisions synced into a
  scratch project. Its 74 notes are all at depth 1 under their shelves, the five whole-project
  decisions orbit outside, and every story's entrance is named. There are no links, ghosts or
  reads yet, so the panel says "no recorded reads" and every note is grey.
- A labelled example project, "Checkout" and "Search", written through the library's API. It
  has two covers sharing a note, a chain of links, one decision superseding another, a decision
  on no shelf, and eight made-up reads by an orchestrator, an explorer subagent (with its task)
  and an unknown agent across two sessions. **The loop is diagnostic**: the library refuses
  loops (#87), so it was added only to the page's input and never written.
  - [A session selected](core-example-session.png): the legend, and the orchestrator's jump,
    dashed and bowed, from the Cart cover to the replaced Search decision.
  - [A note pinned](core-example-pinned.png): its card and its two stored links out, drawn as
    white arrows.
  - [Replay paused at step 2 of 6, sized by Links in](core-example-replay-paused.png): only the
    first two reads are lit.
  - [Back to the globe](core-example-back-to-globe.png): the islands, sea and turn return.

## Checks

There were no page errors. The smoke readout (`data-drew`) is unchanged in every view. React's
development build still emits the existing drei `Html` nested-root warning noted for the globe.
The behaviour is proven by `packages/knowledge-core/src/look-inside`'s tests (contracts 4.1–4.5).
The drawing is for the owner's eye.
