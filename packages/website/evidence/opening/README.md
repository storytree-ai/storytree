# Chapter 1

Contract 1.8 (`contract_e8338e596fd2`), ADR-0857 D1. The owner's proposal supplies the chatter and finale copy. The website owns the implementation; no mock runtime or drawing code was copied.

Reproduce from the repository root:

```sh
WEBSITE_SHA=$(git rev-parse HEAD) pnpm --filter @storytree/website build
node packages/website/evidence/capture.mjs opening --verify-opening
pnpm record:acceptance packages/website/evidence/opening/opening-observations.json
```

The real Chromium run starts with one touch on Run and reaches the finale at 22 seconds. It checks twelve waiting agents, the three extra agents from the joke exit, silence before sound is enabled, the turn without a URL change, return visits and Replay, Escape, skip, scrolling, denied localStorage, and static no-script/reduced-motion visits. The original red run timed out looking for Run on the old page (commit 276d4de0).

The acceptance recording comes from that same journey: all its assertions passing produces a pass;
an assertion or browser step throwing produces a failure with its error and still exits nonzero. The
observations identify the locally built site by its `version.txt` commit and carry the evidence path.
Record failures too: run `record:acceptance` after inspecting the browser exit, rather than joining the
commands with `&&`. `--dry-run` previews the recorder's verdict without changing the library.
Its `opening-observations.json` file is separate from the website visit's `observations.json`,
so running both proofs in the same evidence folder preserves both results.

Recording red, 2026-10-02: at `eee933c0cf752458d066e3601d4573726cbc9c33`, the real browser
printed `PASS contract 1.8`, but recording `opening/health-red/observations.json` exited 1 with
`ENOENT`. The proof had produced no observations file, and contract 1.8 still read not checked.

Recording green on Mint, 2026-10-02: the unchanged real browser journey passed at
`681be458401110002ac0d1eaad13167524ecb1c0`. Its [observations](health/opening-observations.json) went
through `pnpm record:acceptance`: one passing journey check, no failing checks, and no writes for
the other twenty contracts. The [library readback](health/verified.json) confirms contract 1.8
is verified passing by `acceptance run`, with that commit and evidence path, and Home page is healthy.
The single check covers every assertion in `verifyOpening`; it does not infer success from its log.

Failure recording was also exercised in the real browser: temporarily withholding the built
`assets/main.js` made Run time out, saved a failed observation with that error, and exited nonzero.
The existing recorder's dry run produced `failing, 0/1`; this injected failure was not written to
the library. The built script was restored before the recorded passing run. A separate invalid
`version.txt` check exited before the browser and removed the previous observations, so a stale
pass cannot be recorded as the result of a run that never began.

This recording change reuses the pictures below. The new Mint run's captures and failure logs are
retained in `/home/mickh/storytree-lanes/st03-chapter1-health-evidence`; its passing observations
and library readback are committed here. No page code or appearance changed. Graduation found no
new durable lesson beyond the established acceptance process; curation did not trigger. Friction
was empty. The health drain routed the camera merge's still-unrecorded framing test verdict to
`increment_b758cdd87da7` on its own arc, to check the already-running CI recorder before any fix.

Pictures: [laptop ready](1440-ready.png), [laptop finale](1440-peak.png), [phone finale](390-peak.png), [no script](390-no-script.png), [reduced motion](390-reduced-motion.png). Full-page captures and viewport measurements are alongside them. The browser proof is an explicit acceptance run; the normal gate runs the website's existing automated tests and typechecks.

The scene remains in document flow and labels itself as fiction. Its controls use the page's existing focus treatment, and the finale stays readable above the accumulated windows. The static peak uses the same text and windows as playback. The existing project globe remains lazy-loaded when reached.

An independent read-only reviewer witnessed the four ready/peak/no-script images: laptop composition clear, phone text and actions legible, no harmful overlap. Its keyboard Replay and mid-turn reduced-motion findings were fixed and added to the passing browser proof. Replay now returns focus to Run (or the static primary action), and changing the motion preference cancels the collapse. The globe reveal uses clipping, preserving the renderer's untransformed measurements.

Librarian pass: no durable lesson beyond the existing saved-reading pattern, no guidance or decision changes requiring curation; friction and health worklists empty.
