# Territories show health; claims on the border (ADR-0825 D3)

Increment "Territories show health: green, yellow, red; claims on the border", arc "Health you can
maintain". Each capability's territory is filled by its word (ADR-0744): healthy green, unhealthy red,
yellow while proposed or untested. No territory is filled grey (grey is kept for mapped), and Unclaimed code,
land no contract has surveyed, is drawn as uncharted land: a night-dark fill with thin diagonal hatching. A session's
claim draws a band just inside the claimed territory's border in the session's colour, fainter once the
session is quiet, and leaves the fill to the word. The rim marker for a failing story now reads
storytree's verified word. This is a picture for the owner to judge; nothing here is recorded as
accepted (ADR-0794).

| View | Picture |
| --- | --- |
| Resting front view: all three words on the globe | [front.png](front.png) |
| Close-up (camera zoom x2.6) on The agent link: two live claims (blue, magenta) beside unclaimed territories, and a red one | [close-up-agent-link.png](close-up-agent-link.png) |
| Close-up (x2.6) on The command line: its largest territory, Unclaimed code, as uncharted land | [close-up-command-line.png](close-up-command-line.png) |
| Close-up (x2.6) on The forest: a quiet session's faded claim on the yellow Story node render; proposed Story nodes in yellow | [close-up-forest.png](close-up-forest.png) |
| Close-up (x2.6) on The library: the red Cloud connection beside a live claim on Library transactions | [close-up-library.png](close-up-library.png) |
| The globe turned half round from The library: the two failing islands behind it show rim markers | [rim-markers.png](rim-markers.png) |

Renderer: headless Chromium 148, ANGLE / Vulkan SwiftShader, 1440 x 960, dark theme, device scale 1.
Seed: the eight-story, 58-capability snapshot of `../knowledge-under-islands`, with the code survey and
the 13-line agent log of `../session-tints` (sessions A and B live, C quiet), at the fixed clock
`2026-10-01T12:00:00Z`. The snapshot predates the word, so `capture.mjs` gives each capability one: its
verified column's (passing reads healthy, anything else untested), with four seeded so every word shows:
Cloud connection and Hooks unhealthy, Storytree projects and Story nodes proposed. Run `node build.mjs`,
then `node --import tsx capture.mjs`, under `node "<checkout>/packages/dev-loop/src/heavy-lock.mjs" --`. Full numbers: [measurements.json](measurements.json).
`../../desktop-renderer-smoke.test.ts` builds this page as `smoke` and runs `capture.mjs --smoke` in installed Chrome
(`CAPTURE_CHANNEL`, default `chrome`): no pictures, so a scene target one of these waits names that the globe no longer
draws fails that test on the changing branch. Measured on the Mint box, 2026-10-07: about 22 s green; with
`territory-claim:` renamed it fails at the claim outlines' wait after its 30 s bound.
These pictures were taken while each claiming session also tinted its island's coast. ADR-0923 removed
that tint (2026-10-05), so the capture now waits for the claim outlines instead, and answers the page
through the shared stand-in bridge (`fakeBridge`), as `../session-tints` does: its own stand-in had fallen
behind the page, which then listed no sessions. Re-run that day into the scratch folder, not re-taken: the
same four outlines as below, no page errors.

## Readiness timeout investigation (2026-10-08)

[PR #834's Windows job](https://github.com/storytree-ai/storytree/actions/runs/37632040647/job/112828583187)
timed out waiting for seeded island ground while the page reported `ready`, without page errors. Its
unchanged retry passed. [PR #833](https://github.com/storytree-ai/storytree/pull/833) subsequently put
both desktop browser proofs in one file so they run sequentially; Windows CI also passed on current
main ([PR #843](https://github.com/storytree-ai/storytree/pull/843)). These observations do not establish
the original cause or prove that the intermittent failure cannot recur. The unmodified territory
proof passed on Mint in 13.5 seconds in this investigation; this is one run, not a performance bound.

If the seeded-island or claim/file wait fails, `capture.mjs` now prints the failing stage, missing
planet IDs separately from planets missing ground, each seed's actual children, scene object counts,
globe/navigation hook presence, canvas dimensions, WebGL context-loss state, and the renderer's
active/pending-frame state. The last readiness-poll time can be compared with the passive diagnostic
read. That read has its own three-second bound and rethrows the original timeout even if the read
fails. It neither redraws the scene nor retries the proof; the 60-second island wait, 30-second
claim/file wait, word-fill assertions, claim-band assertions and rim-marker assertions remain.

Controlled check: rename `ground.name = "island-ground"` only in the ignored smoke bundle, then run
the existing capture. Before the diagnostic change, it failed after 60 seconds with only `ready`.
Afterward, the same failure named all eight seeded stories as missing ground, none as missing a
planet, both hooks present, 258 file marks, four claim bands, no pending frames, and no lost context.
This deliberately broken observation target tests the diagnostic; it does not reproduce or diagnose
the original Windows incident. Rebuild `node build.mjs smoke` to restore the generated bundle before
running the normal proof.

## Measured before looking

- Fills drawn (word, colour, opacity), every island: healthy `#97c459` 0.8, unhealthy `#e24b4a` 0.85,
  proposed and untested `#f2d16b` 0.8. **Grey fills: 0.** Unclaimed code's fill is counted apart, below.
- Uncharted land (Unclaimed code, all 8 islands, `measurements.json` `uncharted`): fill `#101418` at 0.92,
  the globe's own background (`PlanetWorldCanvas`), so the island's grey ground no longer reads through;
  one hatch per island, `#8fa8b8` at 0.35, render order 1.2 (fill 1, borders 2), spacing 0.35 ground units
  at 45 degrees, 325 to 4,221 segments per island (The command line 4,221, The agent link 2,544). Borders
  stay `#f4f7f8` at 0.85, so the hatch is under half their strength. Measured from `close-up-agent-link.png`,
  on the land between file circles: the bare fill is about (34, 40, 45), lightness 0.17, and the land
  averages (51, 60, 67), lightness 0.23, saturation 0.13, hatch included: below the 0.3 to 0.75 band of a
  mid grey. The fill mesh keeps its name `territory:unclaimed` and `{ territory: true }`
  and is picked; the hatch's raycast is off. **Grey fills: 0**, health or uncharted.
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

## Unclaimed code as uncharted land

Before, Unclaimed code had no fill and showed the island's own grey ground, the largest grey area on The
agent link and The command line: the grey the owner reserved for mapped. It is now uncharted land, a
night-dark fill (the globe's background colour, 0.92) with a thin diagonal hatch in a faint cool light
(`#8fa8b8`, 0.35).

Principle: the cartographic no-data convention. A region with no data gets no hue and is hatched, because
every hue on a choropleth claims a meaning (here green, yellow and red are health words, grey is reserved for
mapped, and a session's colour means a claim). Absence is shown by texture and value, never by a new colour.

Judged against it: no hue (the land is a dark cool neutral, lightness 0.17 to 0.23, and it is not the
mid-lightness grey the owner reserved) and the hatch is what says "not surveyed" at the resting view
(`front.png`, where The command line's and The agent link's hatched land is told from the three health fills
at a glance). It does not read as water or a hole: water is the bare night background, this is a little
lighter than it, textured, inside the white coast border, with its file circles on it
(`close-up-command-line.png`). Tuned from the first capture (0.9 fill, 0.4 hatch), where the hatch averaged the
land up toward a slate grey: 0.92 and 0.35 keep the land dark. A cost: at the resting view the hatch lines
are 1 px and alias slightly (visible as a faint moire on the small islands); the texture still reads.

## Concerns

- The hatch is a 1 px line, so at a higher device scale it would be thinner; spacing is in ground units
  (`HATCH_SPACING`), so it scales with the zoom, the line weight does not.
- The coast side of a claimed territory's band lies on the session's coast arc (ADR-0804 D9), in the
  same colour, so the two read as one there; inland, the band alone marks the claim. (Overtaken: ADR-0923
  removed the coast arc, and the band is now the only claim mark.)
