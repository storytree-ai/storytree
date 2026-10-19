# Chapter 1 ends on the pain line

Chapter 1's last frame (ADR-1091 D1): after the CRT turn collapses the swarm to a point, the owner's two lines are said on
the dark screen it leaves, a line at a time at the tour's old pace, then the page hands over to the globe. The lines left the
tour, which now opens on storytree's growth.

Reproduce from the repository root with Node 24 and the Playwright Chromium build:

```sh
WEBSITE_SHA=$(git rev-parse HEAD) pnpm --filter @storytree/website build
node --import tsx packages/website/evidence/capture.mjs pain-line --verify-opening --retake
```

The contract 1.8 journey takes `390-pain.png` once both lines are on screen at 390 × 844, then `1440-pain.png` at
1440 × 900 in the same frame. In the run that made these, the turn reached the pain line 1.1 s after the exit and handed over
9.4 s after it; reduced motion shows both lines at once, with no animation, then hands over.
