# The globe redraws only what changed: items 1-2 (ADR-0836 D1)

**What it shows.** The actual desktop page, built by `../session-tints/build.mjs`, on the knowledge-under-islands
seed with its code survey, fed by a stand-in bridge whose agent log grows by one line on every read: every
2-second live poll carries news, and nothing drawn on the globe changes. `capture.mjs <dist> <out-prefix> 40`
records Long Animation Frames for 40 s and screenshots the page after the polls.

**Before** (main at 9070f12): a long frame on every poll, 40-42 in 40 s; 25-38% of page time blocked;
longest frame 360-1241 ms (software GL, so slower than a real GPU; compare relative, same box, same instrument).
**After:** no long frames at all in 40 s; 0% blocked. `before.png` and `after.png` are the same scene after
the polls and are pixel-identical.
