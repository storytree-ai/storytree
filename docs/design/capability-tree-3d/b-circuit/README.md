# Capability tree, round 6B: The library as a circuit board

**The idea.** Each of The library's capabilities is a chip on a calm dark-green board, its area its lines of code and
its package its health colour; each link is a copper trace that leaves its caller on the right and lands on its own
gold pad (the gate) on the chip it calls, so traces run one way, in right angles, with open board between the parts.
Links from other stories come in at an edge connector, one gold finger per story, whose trace splits to each gate it
serves; the one link out of the story leaves at a finger on the opposite edge.

Open `index.html` from disk (no network, no build). Drag to pan, wheel or `+`/`−` to zoom, `Fit` for the whole board.
Click a chip, a gate (gold pad), a trace, an edge-connector finger or a wrench; the datasheet panel on the right says
what it is.

## Why a board, and why this layout

Round 5 taught that the links need room: a full tiling of territories leaves none, and the plain architecture diagram
read better because of its open space, its layers by dependency and its compact nodes. A circuit board is that diagram
with a discipline that suits it: traces are routed in right angles at a set pitch, parts are placed so their
connections stay short, and the board has an idiom for everything we must show (a pad where a connection lands, an
edge connector where another board plugs in, a via where one trace passes under another).

I chose a standalone SVG page over the map's three.js island. A board is flat by nature, and the 2.5D tilt that suits
the map's flags would only foreshorten the traces and the names; flat, every name reads at one size and the routing
is exact. It does not sit on the island, so it does not yet show where The library is in the world; a link to the
map at the story's node is the obvious way back (see "Next").

- **Columns by dependency.** A capability's column is the length of its longest chain of in-story dependencies, then
  each capability is pulled right to sit just left of its nearest caller (so `17 · The library's commands` sits
  beside `27 · Fixed data questions`, not at the far left). Callers are always to the right of what they call.
- **Rows by barycentre.** Within a column, chips are ordered and spaced by the average height of what they connect
  to (twelve sweeps), so most traces run straight across.
- **Room by count.** The channel between two columns is 8 grid cells plus about one cell for every link that passes
  through it, so the channels are as wide as their traffic needs.
- **Routing.** An 8-pixel grid; each trace is found by A* that charges for length, more for each bend, and a lot
  (90 cells' worth) for passing under another trace, never through a chip, a name or another trace's pad. A trace may
  run on its own story bus for a quarter of the cost, which is what makes an arriving bus share its trunk and split
  near its gates. The best of five routing orders is then improved by ripping up each trace that crosses another and
  routing it again around everything else, keeping only changes that make the whole board calmer. That search is slow
  (it runs once, offline, in `tools/route.mjs`), so its result is saved in `routes.js` and the page just draws it;
  if the layout changes and the saved routes no longer fit, the page routes live with one good order.
- **Pads.** One gate per link, on the called chip's right edge, ordered top to bottom by where its caller sits so
  traces do not cross at the pad. Each caller's traces leave from small copper pins on its left edge, ordered the
  same way.

## Palette

| Use | Hex |
| --- | --- |
| Board (solder mask) | `#1f3a2d`, edge `#2d5040`; page behind it `#14251d` |
| Trace (copper) | `#c6914a` on a `#15291f` keep-out line |
| Lit route | `#ffe39a` on `#3a2a0e` |
| Gate pad and edge finger (gold) | `#d9b45a`, edge `#7d5f27`; lit `#ffe39a` |
| Via (where a trace passes under) | ring `#e0c27a` |
| Silkscreen (names) | `#efe4c8`; second line `#d9cdae` |
| Chip package: healthy / unhealthy / untested or proposed / parked | `#97C459` / `#E24B4A` / `#F2D16B` / `#86939D` (the map's own words, `packages/forest/src/view/territory-land.ts`) |
| Wrench | `#1b1814` with a `#efe4c8` edge (the claim flags' ink) |
| Datasheet panel and legend | paper `#f4ecd9`, ink `#2a241b`, rules `#d9cdb0` |

## What is measured, and what is sample

Everything on the board is measured; nothing is sample. `tools/measure.mjs` read the library and the code survey on
2026-11-02 and wrote `data.json`:

- 24 capabilities of `The library` (`story_754e87e7d531`), each with its description, health word, parked flag,
  contracts, and its lines of code: the code survey's source files mapped to it, tests excluded (the map's own
  measure). They range from 12 lines (`25 · Lapsed questions`) to 1,977 (`1 · Project libraries`). A chip's side is
  4.2 × √lines pixels, rounded to the 8-pixel grid, so area follows lines of code; the smallest chips round up to two
  grid cells.
- 27 links inside the story and 1 leaving it (`15 · Connection by address` → Keys' `1 · Key store and resolver`), from
  each capability's `dependsOn`.
- 22 links arriving from 7 other stories (every capability elsewhere whose `dependsOn` names one of these): The command
  line 14, Mick's dev loop 3, and one each from Knowledge graph, Code map, The MCP server, Experiments and Talk to
  storytree by voice.
- 3 open increments that name a capability here, so 3 wrenches: `8 · Cloud connection (GCP)`, `14 · Ranked search` and
  `17 · The library's commands`. Real work exists today, so no sample wrench is drawn.

**Where a wrench stands.** The library does not record which link an increment's work changes, so the wrench stands at
the chip's gate from inside the story when it has one (`17`'s, from `27 · Fixed data questions`). `8` and `14` have no
gates at all, since nothing calls them, so their wrenches stand on the chip's gate edge.

## Stills

| File | Shows |
| --- | --- |
| `stills/resting.png` | The page as it opens: the whole board fitted, nothing selected |
| `stills/whole-graph.png` | The whole board at twice the size, every name readable |
| `stills/close-up.png` | A close-up around `4 · Work model`: pads, pins and traces at full size |
| `stills/gate-contracts.png` | The gate from `27 · Fixed data questions` on `7 · Library API` open: its contracts, its route lit |
| `stills/arrivals.png` | The command line's edge finger open: its bus lit, splitting to all 14 gates it serves |
| `stills/wrench-open.png` | `17 · The library's commands`'s wrench open: its arc and increment |
| `stills/chip-open.png` | `26 · Rounds` open: its description, contracts, gates and calls |

## Reopen and rebuild

From the checkout root:

```sh
node --import tsx docs/design/capability-tree-3d/b-circuit/tools/measure.mjs   # data.json, from the library
node docs/design/capability-tree-3d/b-circuit/tools/build.mjs                   # data.js, for the page
node docs/design/capability-tree-3d/b-circuit/tools/route.mjs                   # routes.js (a few minutes)
node docs/design/capability-tree-3d/b-circuit/tools/shots.mjs                   # stills/
```

## Next, for Mick

Routing today: all 50 links routed; 33 places where one trace passes under another (19 between links inside the
story, 14 where an arriving bus meets them), down from 101 in the first attempt (one finger per calling capability,
one routing order) and 59 once each story arrived as one bus. The page opens with the saved routes in a few
milliseconds.

1. **Put it on the map.** Click The library's island and the board slides up in its place; the arrival fingers
   could sit where the map's docks are, so the two views agree about which way other stories lie.
2. **The arrivals crowd the right-hand channel.** All 22 arriving links enter from one edge and must reach chips in
   every column. Fingers on the top and bottom edges as well, each placed over the columns its story reaches, would
   shorten them and take most of the remaining vias away.
3. **A legend that keeps out of the way.** It sits over the board's lower-left corner at rest; it could fold to a
   single "?" once read.
4. **Which gate the work changes.** If an increment recorded the contracts it changes, the wrench could stand at the
   exact gate (or gates) whose contracts those are, instead of the rule above.
5. **Health on the gate.** A gate shows the called chip's contracts; colouring each pad by whether those contracts
   pass when called that way would make a red link findable at a glance.
