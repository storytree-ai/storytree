# Act 2 polish from the owner's look (increment_cd43dbc5d7fb)

The owner's feedback from the live site, 2026-10-04, built as he gave it. Locally built site, Chromium headless.

| What changed | Pictures |
|---|---|
| Act 2 plays at **0.75×** by default; the bar shows it selected on arrival (contract 2.4) | `tour-1440.png`, `pain-390.png` (the phone's speed button reads 0.75×) |
| **The pain** is two lines, the owner's final words, centred on the dark screen while no globe shows | `pain-1440.png`, `pain-390.png`, `pain-320.png` |
| **The growth** names storytree "a living map of your project, for both you and your agents"; the days-of-work line is gone (contract 2.11 reworded) | `grow-1440.png`, `grow-390.png` |
| **The recording's date** ("Recorded … · timing compressed") is small print in the bottom-left corner, above the bar, not a chip on the card; every recording chip follows it | `grow-1440.png`, `grow-390.png` |
| **No zoom bounce:** between steps the camera makes one eased flight that turns the globe and zooms together; between close steps it stays in, and it pulls back only to a wider view (new contract 2.15) | `close-flight.webm` (clip), `close-flight-0..4.png` (frames 0.6 s apart) |

See / feel / think:
- **Pain:** a dark screen and two centred lines; the second, in green, answers the first. The visitor feels named, then promised a fix.
- **Growth:** one line under the growing globe; the date sits out of the way, readable when looked for.
- **Close moves:** the globe turns under the camera; no lurch out and back in.

Checks: `tour.test.ts` 2.4 and 2.15 red then green; browser journeys `--verify-immersive` (pain centred, small print in the corner, 0.75× on arrival: red then green), `--verify-tour`, `--verify-camera`, `--verify-forest`, `--verify-recording`, `--verify-opening`, `--verify-opening-frames`, `--verify-enlarged` and `arrival/capture.mjs` pass.

Reproduce: `pnpm --filter @storytree/website build && node packages/website/evidence/capture.mjs act2-polish --verify-immersive` and `node packages/website/evidence/arrival/capture.mjs --only closeFlight`.
