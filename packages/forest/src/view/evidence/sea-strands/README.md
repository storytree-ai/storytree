# Sea lanes at rest: fine dots of one size on gentle curves, a busy stretch as strands (ADR-1307, contract 4.44)

Mick, 2026-11-10, on a screenshot of the planet: "this shipping lanes look quite ugly"; of six mocks, "fine dots with
gentle curves are nice however i want to keep the signal where there are lots of merging lanes without the dots getting
fat"; of four ways to keep that signal, "go with 1": strands. Recorded as ADR-1307, narrowing ADR-1278 D1.

The real desktop page on storytree's own map (the code-rows snapshot and its survey), the sidebar hidden, nothing
selected: first near The knowledge core, where the library's, the agent link's and the command line's lanes merge, at
2.2 CSS pixels a ground unit (the islands' own detail shown, a few islands across, as in his screenshot); then with The
knowledge core selected; then at the whole map's opening zoom, where every lane size is scaled up 16 times
(`laneScale`, LANE_MIN_PX).

What changed, measured from the scene (29 stretches in both):

- Before: one line of dots a stretch, sized by how many lanes share it (11 dot sizes, 0.16 to 0.37 ground units), 6159
  dots, routes bending at the router's right angles.
- After: one dot size (0.16, about 2.2 px at the floor), 86 strands, 14400 dots; a stretch carrying n lanes is n strands
  side by side (four at most, brighter above that), fanning in where its lanes join or come ashore; every route a gentle
  curve that keeps clear of land.
- A selection's fill (ADR-1278 D2, unchanged) runs down the route's middle over the dimmed strands, on the same curve.

Pictures, 1440 x 960:

- `before-near.png`, `before-zoomed-out.png`: main.
- `near-the-knowledge-core.png`, `the-knowledge-core-selected.png`, `zoomed-out.png`: this change.

Taken with `node --import tsx packages/forest/testing/view/sea-strands/capture.mjs` (append `--retake` to write here);
the before pictures by the same script on main's lane drawing.

In the evidence bucket for #698, linked from the pull request body (ADR-1234; deleted after 90 days or when its arc closes): `698/before-near.png`, `698/before-zoomed-out.png`, `698/near-the-knowledge-core.png`, `698/the-knowledge-core-selected.png`, `698/zoomed-out.png`.
