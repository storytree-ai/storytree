# The first short's polish loop (increment_ea834305fe2d)

Five rounds, each: render the 1080p cut, build contact sheets (frames every 0.25 s plus the frames either side of every cut,
each labelled), a still of every beat and the script's timing table (`round.mjs`, since moved to `../polish-2/round.mjs`, which writes the second loop's rounds), then a fresh-context director subagent
given only the rubric, those pictures and the table (never the builder's reasoning) returns numbered findings with a
timestamp and a severity and a pass or fail on each rubric item. Every blocker and major was worked before the next round;
the loop stops at no blocker and no major, or after round 5. It stopped after round 5.

| Round | Blockers | Majors | What the round's fixes were |
| --- | --- | --- | --- |
| 1 | 1 (the map did not read as the glass sheet) | 0 | the map pulled back to show the slab's edges, names on dark plates, panel padding, `^` and `\` glyphs, the walk out turned right, both halves typing at about one rate, whole-message scrolling, the late cuts aligned |
| 2 | 0 | 3 (Claude's work invisible, the map, walking through the chair) | the work log cut to a full view from 45 s with its steps arriving one by one, the map drawn 4× and shrunk by averaging, aimed to show the near edge, line scrolling without orphans, the reply and "uh..." staggered |
| 3 | 0 | 5 (the exit route, the map's 780 colours, the map's look, the W read as U, "website 5") | standing up plays only the rise, the map put into a 16-colour palette, a new W, "the website / 5 · waitlist", the panel's words only once it is in |
| 4 | 0 | 3 (the map's look, which island was clicked, the walk's depth) | the clicked island ringed in gold, the cursor on its middle, the walk on one floor line in front of the chair, road beiges in the palette |
| 5 | 0 | 2 (walking through the chair, the map's look) | (the last round: none) |

What stays: the two round-5 majors and its minors (`round-5/findings.md`). The map is the forest's own drawing of the real
glass sheet, but at the short's 152 × 128 screen its land's thickness and rows do not resolve; every director judged it "not
a globe" and short of the app's look. The walk out is judged differently by successive directors (behind the chair: wrong
depth; in front: through it). The director cannot see motion between sampled frames: loop seams, the walk cycle, the
cursor's path and the panel's slide were never judged.

Every round's contact sheets, timing table and findings are kept; the beat stills only for round 5, the cut that lands. The
pictures are stored as 256-colour PNGs (they come from the compressed MP4 anyway); the round script writes them full-colour.

After round 5 the composition was made to wait until the forest's drawing is the same picture several times running before
its first frame (the renders' tests had caught two renders of one frame differing on a busy machine: the roads round the
selected island were still being drawn). The committed cut was rendered again from that code; against round 5's stills only
the tint of the selected island's lanes differs, in two of the ten.
