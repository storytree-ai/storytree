# Chapter 1

Contract 1.8 (`contract_e8338e596fd2`), ADR-0857 D1. The owner's proposal supplies the chatter and finale copy. The website owns the implementation; no mock runtime or drawing code was copied.

Reproduce from the repository root:

```sh
pnpm --filter @storytree/website build
node packages/website/evidence/capture.mjs opening --verify-opening
```

The real Chromium run starts with one touch on Run and reaches the finale at 22 seconds. It checks twelve waiting agents, the three extra agents from the joke exit, silence before sound is enabled, the turn without a URL change, return visits and Replay, Escape, skip, scrolling, denied localStorage, and static no-script/reduced-motion visits. The original red run timed out looking for Run on the old page (commit 276d4de0).

Pictures: [laptop ready](1440-ready.png), [laptop finale](1440-peak.png), [phone finale](390-peak.png), [no script](390-no-script.png), [reduced motion](390-reduced-motion.png). Full-page captures and viewport measurements are alongside them. The browser proof is an explicit acceptance run; the normal gate runs the website's existing automated tests and typechecks.

The scene remains in document flow and labels itself as fiction. Its controls use the page's existing focus treatment, and the finale stays readable above the accumulated windows. The static peak uses the same text and windows as playback. The existing project globe remains lazy-loaded when reached.

An independent read-only reviewer witnessed the four ready/peak/no-script images: laptop composition clear, phone text and actions legible, no harmful overlap. Its keyboard Replay and mid-turn reduced-motion findings were fixed and added to the passing browser proof. Replay now returns focus to Run (or the static primary action), and changing the motion preference cancels the collapse. The globe reveal uses clipping, preserving the renderer's untransformed measurements.

Librarian pass: no durable lesson beyond the existing saved-reading pattern, no guidance or decision changes requiring curation; friction and health worklists empty.
