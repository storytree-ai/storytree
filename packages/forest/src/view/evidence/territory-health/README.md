# Territories show health; claims on the border (ADR-0825 D3)

Increment "Territories show health: green, yellow, red; claims on the border", arc "Health you can
maintain". Each capability's territory is filled by its word (ADR-0744): healthy green, unhealthy red,
yellow while proposed or untested. No territory is filled grey (grey is kept for mapped). A session's
claim draws a band just inside the claimed territory's border in the session's colour, fainter once the
session is quiet, and leaves the fill to the word. The rim marker for a failing story now reads
storytree's verified word. This is a picture for the owner to judge; nothing here is recorded as
accepted (ADR-0794).

| View | Picture |
| --- | --- |
| Resting front view: all three words on the globe | [front.png](front.png) |
| Close-up (camera zoom x2.6) on The agent link: two live claims (blue, magenta) beside unclaimed territories, and a red one | [close-up-agent-link.png](close-up-agent-link.png) |
| Close-up (x2.6) on The forest: a quiet session's faded claim on the yellow Story node render; proposed Story nodes in yellow | [close-up-forest.png](close-up-forest.png) |
| Close-up (x2.6) on The library: the red Cloud connection beside a live claim on Library transactions | [close-up-library.png](close-up-library.png) |
| The globe turned half round from The library: the two failing islands behind it show rim markers | [rim-markers.png](rim-markers.png) |

Renderer: headless Chromium 148, ANGLE / Vulkan SwiftShader, 1440 x 960, dark theme, device scale 1.
Seed: the eight-story, 58-capability snapshot of `../knowledge-under-islands`, with the code survey and
the 13-line agent log of `../session-tints` (sessions A and B live, C quiet), at the fixed clock
`2026-10-01T12:00:00Z`. The snapshot predates the word, so `capture.mjs` gives each capability one: its
verified column's (passing reads healthy, anything else untested), with four seeded so every word shows:
Cloud connection and Hooks unhealthy, Storytree projects and Story nodes proposed. Run `node build.mjs`,
then `node capture.mjs`, under `flock /tmp/storytree-heavy.lock`. Full numbers: [measurements.json](measurements.json).

## Measured before looking

- Fills drawn (word, colour, opacity), every island: healthy `#97c459` 0.8, unhealthy `#e24b4a` 0.85,
  proposed and untested `#f2d16b` 0.8. **Grey fills: 0.** Unclaimed code's territory has opacity 0.
- Claim outlines: The agent link, Claims (session B, magenta) and Agent tools (session A, blue), 0.95;
  The library, Library transactions (A, blue), 0.95; The forest, Story node render (C, quiet), 0.6, faded.
  No territory's fill changes with its claim (contract 5.6, in `session-tints.test.ts`).
- Rim markers, turned away: two, "The agent link · unhealthy (storytree verified)" and "The library ·
  unhealthy (storytree verified)"; each labelled "Show unhealthy story: …".
- Page errors: 9, all from panels newer than the capture's stand-in bridge reading an answer it does not
  give (sign-in and the like); none from the land. Recorded in the measurements, not asserted.

## Tuned from the mock, and why

The owner's mock put green `#97C459` and yellow `#F2D16B` at about 0.5 and red `#E24B4A` at about 0.6 on
the dark globe. On the real render each island has a grey ground under its territories, and at 0.5 the
yellow mixed with it to tan and the green to olive: neither read as its word (principle: meaning outranks
appearance). The fills are now 0.8 (red 0.85), where yellow reads yellow and the white borders and file
circles still show. The claim band is 0.3 ground units deep; at 0.22 a quiet session's band (0.45) could
not be told from the coast, so the quiet band is now 0.6 (legible at the resting view).

## Concerns

- **Unclaimed code reads grey.** It has no fill, so it shows the island's own grey ground, and on The
  agent link and The command line it is the largest territory. That is the ground, not a fill, but it is
  the grey the owner reserved for mapped. Raised as its own increment on the arc.
- The coast side of a claimed territory's band lies on the session's coast arc (ADR-0804 D9), in the
  same colour, so the two read as one there; inland, the band alone marks the claim.
