# Act 2 arrives (ADR-0889, contract 2.11)

2026-10-04, Mint box, increment_92f9fd9cae02. Act 2 no longer opens on storytree's busy globe with the problem and the four principles over it. It opens in four steps:

1. **The pain, on the dark screen Act 1 leaves.** Three lines, one at a time, before any globe or the product's name: "Your agents write more code than anyone can read." / "You can't tell which part of it needs you." / "So you read every line, or you trust every line." **This wording is the agent's DRAFT** (marked in `src/tour-copy.ts`), standing in until the owner writes his own. Its "Why it exists" holds ADR-0853's full problem statement.
2. **The shop grows, as a time-lapse.** The globe swells from a point of light (Act 1's, or a dark seed for a visitor who skipped) and replays the shop's recorded build, 3 October 2026, 15:45 to 20:26 UTC, in 15 seconds at 1×: its nine islands rise in their two waves, roads draw on, land and file circles fill in landing by landing, the shop's 35 decisions and its other notes appear under the stories they belong to as their dates come round, and the 13 recorded sessions tint the coasts of the islands they held. It plays on the tour's own clock: pause holds it, 1.5× speeds it, and the step lasts as long as the growth. Timing is compressed and smoothed; nothing is drawn that the shop's library and git history do not record (ADR-0798 D3). The card says so: "Recorded 3 October 2026 · timing compressed".
3. **The value statement, alone on its slide**, over the whole shop, the owner's words: "Storytree builds a map of your project and glues it to your code." / "The map grows as your agents work, and says what needs you and what doesn't."
4. **The three fixes**, the owner's words, each pain with its fix beside it. The four principles are this step's depth ("Why it exists"), written as a short explainer with no decision numbers.

Then the tour carries on into Conduit's chapters as before.

## The two looks of the three fixes, for the owner to choose

Both are built; `data-fixes-look` on `#chapter2` picks one (`index.html` ships **beside**). Each row plays as its line arrives: top row of `fixes-looks.png` is **beside**, bottom row is **resolve**, each at about 0.4 s, 1 s and settled.

![The two looks](fixes-looks.png)

- **beside**: the pain is said in red in its own box; an arrow draws, and the fix arrives in green beside it, while the pain settles back. It reads as a before and after table: quick to scan, the pain stays legible.
- **resolve**: the pain is said large in red where the fix will stand; it then shrinks to a small red caption, the row's edge turns from red to green, and the fix rises in its place. It reads as the pain being overcome rather than compared, and gives the fix the larger type.

Phone (390 px): `390-4-fixes-beside.png`, `390-4-fixes-resolve.png`.

## See, feel, think

| Step | The visitor sees | Likely feels / thinks |
|---|---|---|
| Pain | Act 1's screen collapses to a point; on the dark, large words, one thought at a time; no globe, no name (`1440-0a-turn.png`, `1440-0b-pain.png`, `1440-1-pain.png`) | "That's exactly my problem": recognition before any pitch; a skipper still meets the pain |
| Growth | A glass globe swells from the point; islands rise, roads draw between them, coasts glow as sessions work, dots gather under each island (`arrival-strip.png`, frames `1440-2-grow-0` to `-4`) | Curiosity, then "it's building itself as they work"; the subhead that follows names what they just watched |
| Value | Two lines alone over the finished shop (`1440-3-value.png`) | The promise in one read, with the proof still on screen |
| Fixes | Three pains, each answered (`fixes-looks.png`) | "Those are my three problems, and each has an answer on the map" |

![The arrival, frame by frame](arrival-strip.png)

A clip of it playing at 1×, pain to fixes, on SwiftShader: [arrival.webm](arrival.webm). Phone frames: `phone-strip.png`.

## Paths that still work

- **Reduced motion**: the growth draws whole at once, so under the pain the globe is not shown at all (`1440-reduced-1-pain.png`); the lines arrive without animation.
- **No WebGL**: the still picture is storytree's own globe, not the shop's, so it stays hidden through the arrival; the tour and its controls work (`390-no-webgl-4-fixes.png`).
- **Act 1's exit** lands on the pain (`1440-0b-pain.png`).

## What changed to make it

- `src/tour.ts`: a step can replay a growth (`growth: "seed" | { seconds }`, `map: "shop"`); it lasts as long as the growth, and `globeOf` gives the growth's moment from the step's elapsed time (contract 2.11, `tour.test.ts`).
- `src/conduit-growth.ts`: a saved growth now keeps the project's notes as dated changes with only their public fields, the way storytree's own reading keeps them (contract 3.6), so the shop's core can grow. `src/shop-snapshot.json` was re-exported from the shop's saved library record and its git mirror; every stage is byte-identical to PR #589's, plus the notes.
- `src/forest-scene.tsx`: the shop's globe with its growth plan, its own knowledge core and recorded sessions. A swap between globes now dives in once the new globe is drawn, rather than on a fixed beat: storytree's heavy globe could take longer to lay out than the beat, leaving the camera pulled back (seen on the camera journey). The drawing says when the camera has arrived (`data-arrived`).
- The Run warm start (question_0e4e2c128a20) is untouched.

## Reproduce

```sh
pnpm --filter @storytree/website build && node packages/website/evidence/arrival/capture.mjs
```

It asserts: Act 2 opens on the pain with the shop's globe at its point and no name shown; the growth's moment rises as the step plays, holds while paused, and the shop is whole on the value step; the value statement stands alone; all three fixes show while the tour waits, in each look; the principles are the fixes' depth with no decision list; reduced motion and no WebGL keep the screen dark under the pain; Act 1's exit lands on the pain; and the browser reports no errors.
