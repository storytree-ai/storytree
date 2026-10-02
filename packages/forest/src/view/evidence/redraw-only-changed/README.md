# The globe redraws only what changed: items 1-2 (ADR-0836 D1)

**What it shows.** The actual desktop page, built by `../session-tints/build.mjs`, on the knowledge-under-islands
seed with its code survey, fed by a stand-in bridge whose agent log grows by one line on every read: every
2-second live poll carries news, and nothing drawn on the globe changes. `capture.mjs <dist> <out-prefix> 40`
records Long Animation Frames for 40 s and screenshots the page after the polls.

**Before** (main at 9070f12): a long frame on every poll, 40-42 in 40 s; 25-38% of page time blocked;
longest frame 360-1241 ms (software GL, so slower than a real GPU; compare relative, same box, same instrument).
**After:** no long frames at all in 40 s; 0% blocked. `before.png` and `after.png` are the same scene after
the polls and are pixel-identical.

## Items 3-4: a change re-derives only the island it changed; hover picks once a frame

`MODE=island` changes one island on every poll; `MODE=wisps` has a session claim and release a capability on
every poll; `HOVER=1` sweeps the pointer over an island and reads the tooltips. Before is main with items 1-2.

- One island changing per poll: 10.0-10.6% of page time blocked, longest frame 255-277 ms, before; 6.1-6.4%,
  longest 161-168 ms, after. Pathway routing (`buildGrid`, `runAstar`) is gone from the profile: an island's
  routes are kept while its ground and docks are, and the routes between islands while no island moved.
  What remains is the changed island's own territories and their new materials.
- A claim coming and going: longest frame 360 ms before, 98 ms after (a claim re-cuts only its own island).
- `island-change-before.png` / `island-change-after.png`: the same scene after 40 such changes, pixel-identical,
  as are the idle and claim-change scenes. Hover still names the file under the pointer.

The shared runner owns the server and browser lifetime, without adding settling frames
to the timed probe. Output prefixes (and `PROFILE`, when set) supply a filename inside
the temporary `storytree-captures/` folder; `--retake` writes into this evidence directory.
