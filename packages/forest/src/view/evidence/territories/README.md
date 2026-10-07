# Territories on the flat islands (ADR-0804 D2, D3)

Increment `increment_d2967947582d`, arc "Code islands". Each island is cut into one faintly tinted,
bordered territory per capability (plus "unclaimed" for code no contract claims), sized by lines of
code, and a click on a territory opens its story's panel on that capability. This is a picture for
the owner to judge; nothing here is recorded as accepted (ADR-0794).

| View | Picture |
| --- | --- |
| Resting view | [front.png](front.png) (the densest island, The agent link, is already near the centre: [densest-resting.png](densest-resting.png) is the same view after facing it) |
| Close-up (camera zoom x2.6) on the densest island | [close-up.png](close-up.png) |
| After clicking a territory: the panel open on that capability | [click-territory.png](click-territory.png) (close-up), [click-territory-resting.png](click-territory-resting.png) (resting zoom) |
| Diagnostic: the island whose territories reach furthest past its coast | [worst-outside-close-up.png](worst-outside-close-up.png) |

Renderer: headless Chromium 148, ANGLE / Vulkan SwiftShader, 1440 x 960, dark theme, device scale 1.
Seed: the eight-story, 58-capability snapshot of `../knowledge-under-islands` (same as
`../flat-islands`). The stand-in bridge also answers `codeSurvey` with `survey.json`, which
`survey.mjs` precomputes (`tsx survey.mjs`) as `readCodeSurvey(<this checkout>, seed.tree)`: the
seed's stories are named after real packages, and its capability titles carry their "N · " numbers,
so real files land on real capabilities (every claimed capability id in the survey is one of the
seed's). `readCodeSurvey` reads the repository's **main** checkout, not this worktree, so the code
surveyed is main's. Run `build.mjs`, then `capture.mjs`, under `node "<checkout>/packages/dev-loop/src/heavy-lock.mjs" --`.
Full numbers are in [measurements.json](measurements.json).

## Measured before looking

| Island (story) | Territories (claimed + unclaimed) | Border segments | Furthest territory vertex outside the coast (ground units) |
| --- | --- | --- | --- |
| The agent link | 8 (7 + 1) | 47 | 0 |
| The app | 5 (4 + 1) | 53 | 0 |
| The arc surface | 6 (5 + 1) | 54 | 0 |
| The command line | 3 (2 + 1) | 12 | 0 |
| The forest | 6 (5 + 1) | 54 | 0 |
| The knowledge core | 2 (1 + 1) | 9 | 0 |
| The librarian | 7 (6 + 1) | 69 | 0 |
| The library | 5 (4 + 1) | 44 | 0 |

- Surveyed code (lines in `src`): agent link 8,724 (3,236 unclaimed), library 6,395 (1,464), forest
  2,366, command line 2,299 (1,849), knowledge core 2,090, app 1,624, arc surface 895, librarian 729.
- Every territory is one mesh (opacity 0.22, `depthWrite` off); each island has one border line-segment set.
- **Border vertices: all 8 islands inside the coast (worst 0).**
- **Territory vertices: all 8 islands inside the coast (worst 0)**, checked against the ground's
  triangles in plate-local x/z, tolerance 0.05. The first capture found fills spilling past concave
  coasts on 7 of 8 islands (worst 3.76 ground units, The library); the clip now cuts the coast's own
  triangles by each cell, and this capture is after that fix.
- Click: the largest claimed territory of The agent link (`territory:capability_4da153322012`,
  capability 6 "Agent tools (the MCP server)"), clicked at screen (697, 553), selected the story
  (`data-selected = story_05e45963ca9f`) and the panel's diagram marks exactly that capability and
  shows its detail section. The story's own selection ring also shows.
- No page errors; one Three.Clock deprecation warning, as before.

## What the pictures show, and what to judge

- **Legible at the resting view.** Each island reads as a patchwork of muted tints separated by a
  thin, light border, inside the existing bright coast. At rest the borders are about a pixel and
  the tints are low contrast against each other (greys, sage, slate, mauve): the territory count per
  island is countable, the identity of one territory is not. Judge tint strength and border
  visibility at rest: 0.22 opacity and one-pixel borders are constants in `territory-land.ts`.
- **Meaning outranks appearance.** Territory area follows lines of code: the big grey patch on The
  agent link and The command line is the unclaimed code (3,236 and 1,849 lines), the largest
  territory on each. Knowledge points beneath still show through the tinted land.
- **Close-up.** Borders and territories are clear at 2.6x; the labels ("The agent link") sit over the
  land without fighting the tint.
- **Click.** After the click the panel opens on the story with capability 6 selected in its diagram
  and its detail below. The "undefined" after the capability title is the seed's missing work state
  in the panel, not from this work.

## Problems seen

- The first capture's spill past concave coasts is fixed (see above);
  [worst-outside-close-up.png](worst-outside-close-up.png) is The library's west coast again, after
  the fix. Nothing else seen: no z-fighting (territories sit 0.05 above the ground with `depthWrite`
  off), and clicks select correctly.
