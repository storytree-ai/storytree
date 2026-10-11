# Why the islands flash on the map chapter's capabilities step (diagnosis only, increment_fbfb586cfd31)

`probe-website.mjs` plays the locally built website at 1440×900 from the stories step to the capabilities step and reads, on every
frame the globe renders (through the capture seam in `PlanetWorldCanvas`), each territory's fill opacity and visibility and its
island's borders. `website-frames-before.json` is main at bc9039d9: 150 frames over about 9 s.

**What flashes, and why.** Each time the replay adds a territory (6 times), `Territories` in `planet-view.tsx` rebuilds the land of
every island (new mesh ids on all of them, not only the island that changed), and `territoryLand` returns the territories at their
full health fill. The step shows territories `plain` (no fill), but `presentTerritories` and `growLand` run in a `useEffect` and a
`useFrame` after the rebuilt group has been drawn once, so for exactly one frame every territory on every island is painted in its
health colour (opacity 0.8 to 0.85) and then drops back to 0. In the frame table each fill reads `H` on the rebuild frame and `0`
otherwise; the borders appear whole at once.

**Fix, for the session that builds it.** Present the rebuilt land before it can be drawn (apply the territory mode and the growth
inside the build, or in a layout effect), keep unchanged islands' land across a stage, and give new border segments and fills their
draw-on (borders traced along their length over one rendered second as the roads' 6.17, then the fill easing in; reduced motion whole).

```sh
pnpm --filter @storytree/website build
node packages/forest/src/view/evidence/territory-draw-on/probe-website.mjs --out /tmp/frames.json
```
