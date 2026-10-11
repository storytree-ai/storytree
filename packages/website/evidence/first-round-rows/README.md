# The shop's first four islands sit in rows, then move once (increment_64de8f753567)

The owner's answer to "Where do the shop's islands sit while its plan is still small?" (question_9073ebdfd19e): "A, send it to
mint". Two layouts, one move. While the tour shows the shop's first round (the map chapter and the knowledge chapter) the four
islands sit at their own plan's places, as the app drew them from 01:53 to 03:08: Signing in at the bottom, Browsing above it,
the Cart and Checkout side by side above Browsing. Free play shows the finished shop at its places; when the shop's globe stays
on screen (Skip to free play from a map or knowledge step) the four ease across to those places once, over 1.6 s, with no
roads while they travel. Reduced motion jumps. Storytree's own time-lapse keeps one place per island, unchanged.

Made with `node packages/website/evidence/first-round-rows/capture.mjs <dist> <before|after>` on SwiftShader (the Mint box's
software WebGL): `before` on main's build (9f5277ec), `after` on this branch's. Both JSON files name main's commit, as the
branch's build was made from its working tree.

| | Stories and pathways step, at its end | Health step, at its end | The move, 0.7 s after Skip to free play | Free play |
| --- | --- | --- | --- | --- |
| 1440, before | [before-1440-pathways.png](before-1440-pathways.png) | [before-1440-health.png](before-1440-health.png) | [before-1440-move.png](before-1440-move.png) | [before-1440-free-play.png](before-1440-free-play.png) |
| 1440, after | [after-1440-pathways.png](after-1440-pathways.png) | [after-1440-health.png](after-1440-health.png) | [after-1440-move.png](after-1440-move.png) | [after-1440-free-play.png](after-1440-free-play.png) |
| 390, before | [before-390-pathways.png](before-390-pathways.png) | [before-390-health.png](before-390-health.png) | [before-390-move.png](before-390-move.png) | [before-390-free-play.png](before-390-free-play.png) |
| 390, after | [after-390-pathways.png](after-390-pathways.png) | [after-390-health.png](after-390-health.png) | [after-390-move.png](after-390-move.png) | [after-390-free-play.png](after-390-free-play.png) |

Island middles on the page at the stories step's end (north to south):

| | Cart | Checkout | Browsing | Signing in |
| --- | --- | --- | --- | --- |
| 1440, before | (867, 278) | (915, 149) | (949, 450) | (1007, 627) |
| 1440, after | (873, 203) | (1025, 203) | (949, 450) | (949, 697) |
| 390, before | (168, 182) | (184, 141) | (195, 239) | (214, 296) |
| 390, after | (170, 158) | (220, 158) | (195, 239) | (195, 319) |

The four keep the finished shop's globe radius (218), so the globe does not change size at the move.

**The move's cost.** Sampled in the page each frame for 2.4 s after Skip to free play, with no screenshot to stall it
(`*.json`, `frames` and `move`). The switch itself (eight islands mounting, the panels opening, the camera's flight) stalls
frames on both builds. After, the four travel across 30 distinct frames at 1440 and 69 at 390. Only the plates move during
the travel: the roads are left out, and territories, names and the core are drawn once, at the new places.

| | Frames in 2.4 s | Over 50 ms | Worst | Frames the four moved on |
| --- | --- | --- | --- | --- |
| 1440, before | 76 | 14 | 183 ms | (a jump) |
| 1440, after | 47 | 13 | 250 ms | 30, from 230 to 1880 ms |
| 390, before | 40 | 11 | 617 ms | (a jump) |
| 390, after | 89 | 3 | 300 ms | 69, from 256 to 1839 ms |

**Known on phones.** With the Cart and Checkout side by side, their two-line names meet at 390 and 320 on the stories, claims
(first line) and health steps, and Checkout's hides rather than stray from its island (forest 3.31); the island stands in
frame. A closer phone view (1.2) did not part them at 390 and put Signing in under the card at 320, so the view is unchanged;
the map chapter's capture lists these as known (`../arrival/capture.mjs`), and giving side-by-side names room on a phone is
its own increment on the arc.
