# Round 1: the director's findings

A fresh-context director saw only the rubric, the owner's reference, these contact sheets, the beat stills and `timing.md`.
Its return, as given, then what was done about each finding.

## Findings

1. **11.00–19.00, right half (and the right room shots at 10–11 and 19–22). Blocker. Breaks 2 (map is current).** The map
   is a dark, almost unlit plane. Only a faint perspective edge at the top and right hints at a slab. The islands are flat
   green blobs with no land thickness, scattered and joined by beige roads rather than in rows by depth. It is not the old
   globe, but it does not read as the lit glass sheet at a tabletop tilt. Fix: show the sheet as a slab with a lit edge, a
   fixed tilt and land with depth.
2. **11.0–19.0, right half. Minor. Breaks 3.** Map labels collide with map art: a road runs through "THE FOREST"; the
   yellow "THE WEBSITE" tag sits over a road and half its island; the slab is cropped at the left and bottom, and the open
   panel hides the right third ("THE APP"). Fix: labels off the roads, frame the sheet left of the panel.
3. **13.23–19.0, right half, side panel. Minor. Breaks 3 (no clipping).** Rows have no bottom padding ("SITE", "SNAPSHOT",
   "ON MERGE", "WAITLIST" touch their box's lower border); the cursor parks on the right end of "5 · WAITLIST". Fix: 1–2 px
   padding under each row.
4. **11.0–22.0, 35.5–39.5, left half, check.ts. Minor. Breaks 5.** Line 2's regex renders as `/ [ @ ]+@[ @ ]+ .[A-`: the
   `^` and `\` glyphs are missing from the font. Fix: add them.
5. **Every room shot, both halves. Minor. Breaks 1.** The chair's backrest sits to his right rather than behind him; an
   unexplained dark object is cut off at the bottom-left of each half.
6. **39.5–42.0, right half. Minor. Breaks 1.** He walks out left, in front of the desk and into the seam between the halves.
   Fix: exit him off the right or bottom edge.
7. **23.0–29.2, both halves. Minor. Breaks 4.** The left's 358-character prompt types at about 58 characters a second, the
   right's 56-character one at about 16, so the long prompt finishes only 2.7 s after the short one and the storytree
   developer looks like the slower typist. Fix: type both at the same rate and let the left run longer.
8. **46.5–52.0, right half, Claude. Minor. Breaks 3.** After scrolling, the top line is an orphan fragment ("STOP DUPLICATE
   EMAILS?"); "WORKING..." sits on the screen's last pixel row. Fix: scroll by whole messages, keep a margin at the bottom.
9. **46.5 (right) / 47.0 and 48.0 (left). Minor. Breaks 5.** Three cuts in 1.5 s across the halves. Fix: align them.

## Scorecard

1. Set and staging: PASS (desk at the reference's perspective, monitor at a normal size, keyboard and mouse with hands on
   the keys, the same room on both halves, PixelLab props), with the staging notes in 5.
2. The product is current: **FAIL** (the map does not read as the lit glass sheet); the panel's parts: PASS on appearance.
3. Legibility: PASS (nothing covers a focus line; all 21 lines held their reading time; no text clipped), with notes 3, 8.
4. Pacing: PASS (56 s; punchlines held: the short prompt ~8 s, the answer ~7.4 s, the empty chair 4.5 s, the left still
   flipping 5 s; contrasts line up), contrast weakened by 7.
5. Craft: FAIL on minors 4 and 9 only; whole-number scaling in one palette PASS; full-screen cut-ins PASS.

## Could not judge

Motion between the 0.25 s samples (whether the typing, scratching, leaning and walk cycles pop; the stand-up jumps from
seated to standing between samples at 39.5–40.0), loop seams, sub-frame jitter (the panel's slide-in, the cursor's path),
typing cadence, whether the map moves at all in 11–19, the 1080p encode, and whether the props really are PixelLab's.

## What round 2 changed

- 1, 2: the map is aimed further back, at the island in front of the website, so the slab's near, far and side edges show
  at its tabletop tilt, with the website left of the panel; every island's name sits on a dark plate, as the app's
  nameplates do, so roads no longer run through words.
- 3: a pixel more padding under each panel card.
- 4: the screen font has `^` and `\`.
- 6: he turns and walks out to the right, past his chair and off the frame's edge.
- 7: both halves type at about the same rate (42 and 30 characters a second), so the paragraph takes 8.6 s against the
  short prompt's 1.9 s; the left half's later beats move 2.4 s later to make room.
- 8: Claude's screen scrolls by whole messages and keeps two lines free at the bottom while Claude works.
- 9: the right cuts to the full view at 48.5 s, with the left's cut.
- Not changed: 5 (the chair is the developer's own PixelLab sprite, drawn at his three-quarter angle; the dark object is the
  set's computer tower, cut by the frame). Both stay as minor.
