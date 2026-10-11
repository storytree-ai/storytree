# A mapped island is drawn brown and whole (ADR-0993 D3)

Increment "A mapped island is drawn brown and whole on the globe, below what stands on it", arc "An existing
codebase is imported as mapped islands that new work stands on". A mapped story (a package of an imported
project, here before storytree and assumed to be working) is one brown island: no territories, no file circles,
no hatch, and no health. Its land follows its lines of code as a built island's does, capped at 12,000 ground
units² (`MAPPED_ISLAND_CAP`, about 8,000 lines' worth). Its panel says it is mapped, with its file and line counts.
This is a picture for the owner to judge; nothing here is recorded as accepted (ADR-0794).

| View | Picture |
| --- | --- |
| Storytree's eight stories with three mapped ones of about 2,000 (storefront), 20,000 (api) and 200,000 (core) lines, each importing the next, so core is lowest and storefront highest; the shipped cap | [beside-shipped.png](beside-shipped.png) |
| The same with the cap at 30,000 ground units², the first value tried | [beside-cap-30000.png](beside-cap-30000.png) |
| The same with no cap: land per line as for a built island | [beside-cap-1000000000.png](beside-cap-1000000000.png) |
| A click on api: its panel says it is mapped, with 20 files and 20,000 lines, and shows no health | [close-up-shipped.png](close-up-shipped.png) |
| A project whose only stories are mapped, never verified and with no survey: it opens on brown land | [only-mapped-shipped.png](only-mapped-shipped.png) |

**Choosing the cap.** Each island's reach (its coast's farthest point from its middle, in ground units), from the
measurements files; the largest built island is The agent link, at 93.6.

| Cap | storefront (2k) | api (20k) | core (200k) |
| --- | --- | --- | --- |
| none | 35.3 | 104.4 | 356.8: wraps a third of the globe and pushes every built island to the rim |
| 30,000 | 35.3 | 104.9 | 104.4: both larger than any built island, and the globe grows to fit them |
| 12,000 (shipped) | 35.3 | 67.3 | 67.2: smaller than the two largest built islands, beside them without crowding |

Above the cap, a 20,000-line and a 200,000-line island are drawn the same size; their panels give the true counts.

**The shade.** ADR-0992's placeholder, #A9794E at 0.85 opacity, kept: on the lit globe it reads as earth, well apart
from parked's cool slate grey (#86939D) and from the health words' green, yellow and red.

Renderer: headless Chromium, ANGLE / SwiftShader, 1440 x 960, dark theme, device scale 1. Seed: the snapshot of
`../knowledge-under-islands` with the code survey of `../session-tints`, each capability given its verified
column's word. Taken on the Mint box on 2026-10-11. Run `node build.mjs [cap]`, then
`node --import tsx capture.mjs [cap] --retake`, under `node "<checkout>/packages/dev-loop/src/heavy-lock.mjs" --`.
