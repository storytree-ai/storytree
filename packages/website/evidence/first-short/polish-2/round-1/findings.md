# Round 1: the director's findings, and what was done with each

A fresh-context director saw only the rubric (`../rubric.md`), the owner's reference, the app's screenshot of the shop's sheet
(`../../../freeplay-shop-panels/freeplay-shop-story-1440.png`), these contact sheets, the beat stills, the lossless stills and
`timing.md`. Its findings in short, each with what the builder did before round 2.

## Findings

1. **11.0–15.5, right. Major (2, 9).** The slab reads flat and is cut off by the panel; the panel's lower third is empty.
   **Fixed:** the map is framed to show the whole sheet, every island named, before the panel opens; as the panel opens, the
   map slides aside by half its width, as the app's does, so the new island stays in view beside it. The panel is now the app's:
   its title, the story's description and its capability graph in a frame with the button that opens it full size.
2. **11.0–15.5, right. Major (6, 2).** Signing in is missing from the map. **Fixed** by the same framing; a name that would
   overlap another island's is lettered above its island instead of dropped.
3. **15.5–19.0, right. Major (2).** The other stories' parts in the graph differ from the app's screenshot ("Browsing 3 · Cart
   store" there, "Browsing 2 · Cart store" here). **Rejected:** the screenshot is an earlier capture of the shop; the graph's
   names come from the website's saved shop snapshot, the same plan the map is drawn from (contract 6.12).
4. **11.0–15.5, right. Major (7).** The wishlist's yellow land is "invented for the short". **Rejected:** yellow is the app's own
   fill for a part not yet proven, which "asks for attention" (packages/forest/src/view/territory-land.ts, ADR-0825 D3); the
   dark dotted patches in the screenshot are code no contract has surveyed. The new island is the only one on the sheet with
   land not yet proven, and it takes the free place at the end of a row.
5. **15.0/15.5, 32.6/34.5, 36.5–43, both. Major (4).** The halves cut apart. **Fixed:** both halves now change what they look
   at together at 10, 11, 15.5, 19, 22, 23, 41 and 48 s; the left's last look at the code moved to 37.5–41 so his return to
   Claude and the right's stand-up both land at 41 s; the right's empty chair is held from 44.5 to 48 s and the end card moved
   to 54 s (58 s in all). The timing table now lists as cuts only changes of view, app or file, not a new thought inside one view.
6. **25.4–34.5, right. Minor (4).** The right's terminal is still for about 9 s. Not changed: it is Claude's answer held for its
   reading time (16 words, 7.4 s) against the left's paragraph.
7. **41–42.3, right. Minor (10).** No door where he walks out. Not changed.
8. **Left. Minor (1).** The mouse is hidden behind the developer on the left. Not changed (the same room as the right, where it
   shows once he leaves).
9. **Evidence. Minor.** A stale still of the last loop's cut (`still-almost-right.png`) was left beside the renders. **Fixed:**
   removed.

## Scorecard

| Rubric item | Round 1 |
| --- | --- |
| 1 Set and staging | PASS |
| 2 The product is current | FAIL (findings 1, 3) |
| 3 Legibility | PASS |
| 4 Pacing | FAIL (finding 5) |
| 5 Craft | PASS |
| 6 The shop's map | FAIL (finding 2) |
| 7 A new story node | FAIL (finding 4) |
| 8 No frustration | PASS |
| 9 More room | PASS |
| 10 The walk-out | PASS |

## Could not judge

Motion between the 0.25 s samples (the walk cycle, the chair's roll, the cursor's path, typing), whether the chair clips him
between samples, sound.
