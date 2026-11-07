# Tunnels as a last resort: the territory search avoids them and keeps territories compact (increment_fb8987cfd45e)

Mick, 2026-11-07, answering question_ad09fc6c81bd (option A): "it should be a last resort. And yes, it is something that's in
the back pocket in case it is actually ever needed." And of Connection by address on The library: it "has an outstretched part
that seems to divide between two other capabilities ... we could have just made Connection by address grow outward more."

## Measured first: the live map's tunnels

storytree's own plan and code as of 2026-11-08 (the code-rows seed and survey refreshed from the library and this checkout,
read-only, not committed), every island's ask to the territory search taken from the page (`capture.mjs --dump`), then each
island searched in full (300 steps) with main's score and with this branch's. Tunnels are counted as drawn: the tunnel
portals in the scene, two a tunnel, from the map drawn from each side's arrangements (`capture.mjs --kept`), which agree with
the router's own count island by island.

- **Main's searched map draws 3 tunnels**: one each on The command line, Mick's dev loop and Storytree's own repository
  checks. Unsearched (the start arrangement, what a page with no worker draws) it draws 9: The library 3, The command line 2,
  Setup 2, Map view 1, the repository checks 1.
- **This branch's searched map draws none.** No island draws more than before.
- **The library draws no tunnel on either side, and the road from Work in flight (10) to Waits (11) does not go under
  Connection by address.** It is open road on both sides: on main over Data schema, Project libraries and The library's
  commands, here over Project libraries, Library transactions and The library's commands, shared in each with links that call
  that land (a road is in a tunnel only where every link it carries goes under it). #565's stills added links that do not
  exist, as its README says.
- **The score's "inside links through a third territory" are not tunnels.** The library's searched arrangement has 92 such
  links on main and 0 tunnels, so the heavy cost is put on the tunnels the network draws, and the mock's 10 a link over a
  third territory stays as it was.

| island | tunnels, main | tunnels, here | links over a third territory, main | here | border between territories, main | here | road drawn, main | here |
|---|---|---|---|---|---|---|---|---|
| The library | 0 | 0 | 92 | 88 | 2485 | 2490 | 1293 | 1128 |
| Session management | 0 | 0 | 17 | 18 | 1561 | 1440 | 930 | 862 |
| Desktop app | 0 | 0 | 6 | 7 | 1264 | 1066 | 661 | 688 |
| Map view | 0 | 0 | 1 | 1 | 605 | 388 | 367 | 375 |
| Work board | 0 | 0 | 2 | 1 | 519 | 319 | 303 | 412 |
| The command line | 1 | 0 | 6 | 6 | 1564 | 1122 | 571 | 744 |
| Knowledge graph | 0 | 0 | 2 | 1 | 784 | 493 | 358 | 540 |
| Setup | 0 | 0 | 9 | 8 | 1451 | 1434 | 697 | 762 |
| Mick's dev loop | 1 | 0 | 0 | 0 | 1675 | 1582 | 252 | 259 |
| Code map | 0 | 0 | 2 | 2 | 671 | 477 | 309 | 477 |
| CI health | 0 | 0 | 2 | 3 | 731 | 554 | 599 | 555 |
| The MCP server | 0 | 0 | 1 | 0 | 1010 | 712 | 483 | 537 |
| Plugin loader | 0 | 0 | 0 | 1 | 501 | 426 | 362 | 410 |
| Context | 0 | 0 | 0 | 0 | 697 | 493 | 307 | 352 |
| Experiments | 0 | 0 | 1 | 1 | 1443 | 1101 | 452 | 474 |
| Agent runner | 0 | 0 | 1 | 0 | 662 | 605 | 509 | 597 |
| Marketing artifacts | 0 | 0 | 0 | 0 | 426 | 238 | 74 | 139 |
| The local database | 0 | 0 | 0 | 0 | 388 | 154 | 65 | 106 |
| The drawing engine | 0 | 0 | 0 | 0 | 597 | 500 | 265 | 305 |
| Surface feedback | 0 | 0 | 0 | 0 | 1028 | 509 | 276 | 349 |
| Talk to storytree by voice | 0 | 0 | 0 | 0 | 805 | 712 | 413 | 376 |
| Test waits | 0 | 0 | 0 | 0 | 587 | 419 | 96 | 146 |
| Base dev loop | 0 | 0 | 0 | 0 | 992 | 545 | 254 | 359 |
| Service host | 0 | 0 | 0 | 0 | 709 | 479 | 190 | 252 |
| Teaching cards | 0 | 0 | 0 | 0 | 618 | 356 | 207 | 303 |
| Storytree's own repository checks | 1 | 0 | 1 | 4 | 1204 | 941 | 527 | 460 |
| Claude Code mod | 0 | 0 | 0 | 0 | 410 | 294 | 10 | 19 |
| Mick's agent runner | 0 | 0 | 0 | 0 | 769 | 400 | 29 | 90 |

Keys and The session manager's scheduled runs on the Mint box hold one territory each: nothing to search. Lengths are in The
library's units (an island searched at The library's size).

## What changed (contract 3.80)

- **100 for each tunnel the network draws**, against the mock's 10 a link over a third territory, which stays: at 100 a
  tunnel outweighs 2,000 units of road, more than any island's way round. A tunnel is still drawn where no arrangement
  avoids one; the router's pricing (3.77) is unchanged.
- **0.2 for each unit of border between two territories** (open land and the coast are no border): a territory reaching an
  arm between two others draws a border along each side of it, so the search grows it outward. The border measure was chosen
  over a territory's spread from its seed because the arm Mick named is long and thin, little area far out but a long border
  on each side. The total border between territories fell on 27 of the 28 islands searched, by 23% across them; The library's
  held (2,485 to 2,490) while its road fell from 1,293 to 1,128. Each territory still holds its share of the lines (3.14):
  the score never changes how many cells a territory grows to.
- **The kept arrangement's key carries the score's version** (`score 2`), so every island kept under main's score searches
  once more, from the arrangement it draws, and keeps what it finds.

## What it costs

A step of the search still routes the network once, and now also counts its tunnels from the cut and sums the borders: per
step, serially on the Mint box, main against this branch over 40 steps each, twice: The library 667 / 654 against 651 / 648 ms,
Session management 342 / 346 against 327 / 337 ms, Setup 293 / 294 against 274 / 289 ms, Map view 183 / 181 against 179 / 182
ms. Within the 0.3 to 0.7 s a step increment_45fb1b3db15c and increment_8bde01fc16da measured.

## Pictures

1440 x 960, each island faced and drawn at 1.4 times the near zoom, from main's searched arrangements (`before-*.png`) and
this branch's (`after-*.png`): The library, The command line, Mick's dev loop and Storytree's own repository checks. Every
island's arrangement changes (each is searched again under the new score); these are The library and the three that lose a
tunnel.

Taken with `node --import tsx packages/forest/testing/view/tunnel-last-resort/capture.mjs --seed <folder> --kept
<arrangements.json> --prefix before|after --islands <story,…> --retake`, the arrangements from searching each island's
dumped ask with main's `searchTerritories` and this branch's.
