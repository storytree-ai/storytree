# The map's bottom-left strip: the factory's CI averages (contracts 6.6, 2.55)

Stage 1 of the CI/CD time display Mick chose on question_177bdb4c1e2a (option B, Fable's recommendation in
research_5ab97b11f915): the map's bottom-left corner shows the factory's CI averages as four small dim figures, read when
wanted and never asking for attention. Mick, by voice 2026-11-10: "once I see it, I can provide feedback."

The real desktop page on storytree's own map (the code-rows snapshot and its survey), its bridge answering a CI times
reading shaped like storytree's own on 2026-11-10 (research_34ce87f80d67's medians: to merge 42 min this week against 35
the week before, runs 16 min with Windows the slowest system, 28% of merge-queue runs red).

What the strip shows, left to right:

- **To merge:** this week's median from ready for review to merged, a bar for each day's median over two weeks (last
  week's dimmed), and last week's median.
- **Run:** a commit's CI, its longest workflow run, the median of this week's passing ones, and the system whose job was
  longest in most of them.
- **Queue reds:** of this week's merge-queue runs that reached a verdict, the share that failed.
- **In CI, in queue:** the pull requests with a run going in CI and in the merge queue, as the last recording saw them,
  and how long ago that was.

Its hover says what each figure is and how many it is the median of. With nothing recorded there is no strip.

Why one line: the first drive's four-line block (review 1's reading, failed) covered the southmost island and its name
with the rail open. The map opens with a 45 px band clear below its south edge (forest's sheet-navigation, CLEAR_BOTTOM);
one line sits in that band, so at rest it covers nothing. A narrow map cuts the live count first and the time to merge last.

Pictures, 1440 x 960:

- `map-with-ci-times.png`: the map with the rail beside it; the strip runs along the map's bottom edge from the rail.
- `map-with-ci-times-rail-collapsed.png`: the rail collapsed; the strip follows the map's left edge.
- `ci-times-close.png`: the strip alone.

Taken with `node --import tsx packages/ci-health/testing/view/ci-times/capture.mjs --retake`, which measures the strip's
box (inside the clear band) and its four figures into the JSON beside each picture.

In the evidence bucket for #700, linked from the pull request body (ADR-1234; deleted after 90 days or when its arc closes): `700/map-with-ci-times.png`, `700/map-with-ci-times-rail-collapsed.png`, `700/ci-times-close.png`.
