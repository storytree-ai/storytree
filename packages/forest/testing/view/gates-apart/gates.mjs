// Island gates stand apart where their border has room (increment_af16a373441d): every island's roads routed from the asks
// capture.mjs --dump wrote down, at each entrance spacing given (the router's COST.entranceApart), and measured: the
// clear ground between the nearest posts of every two gates with posts, in The library's units, and what the network
// costs (road drawn, tunnels, links over a third territory, links no road reaches).
// `node --import tsx gates.mjs <asks.json> <spacing> [<spacing> …]`
import { readFileSync } from 'node:fs';
import { answerRoads, inTunnelMouth, roadMeasures } from '../../../src/territories/island-roads.ts';
import { RELIEF } from '../../../src/territories/island-relief.ts';
import { COST } from '../../../src/territories/road-network.ts';
import { LIBRARY_LAND } from '../../../src/territories/link-layout.ts';
import { landArea } from '../../../src/territories/territories.ts';

const [file, ...spacings] = process.argv.slice(2);
const asks = JSON.parse(readFileSync(file, 'utf8'));
// A gate's posts reach this far either side of it, as the view stands them: wider where a ramp climbs to it from the open land.
const reach = (g, S) => (g.between.includes('open') ? Math.max(g.opening, RELIEF.ramp.width * S) : g.opening) / 2 + RELIEF.post.side * S;
for (const apart of spacings.map(Number)) {
  COST.entranceApart = apart;
  let least = Infinity, touching = 0, gates = 0, road = 0, tunnels = 0, unrouted = 0, overThird = 0, slowest = 0;
  const islands = {};
  for (const { title, ask } of asks) {
    const started = performance.now(), roads = answerRoads(ask).roads;
    slowest = Math.max(slowest, performance.now() - started);
    const S = Math.sqrt(landArea(ask.map.coast) / LIBRARY_LAND), m = roadMeasures(ask.map, ask.links, ask.docks, ask.names);
    road += m.roadDrawn; tunnels += m.tunnels; unrouted += m.unrouted; overThird += m.overThird;
    const posted = roads.gates.filter((g) => !inTunnelMouth(roads, g));
    gates += posted.length;
    let island = Infinity;
    posted.forEach((g, i) => posted.slice(i + 1).forEach((h) => {
      const clear = (Math.hypot(g.at.x - h.at.x, g.at.z - h.at.z) - reach(g, S) - reach(h, S)) / S;
      island = Math.min(island, clear);
      if (clear < 1) touching++;
    }));
    least = Math.min(least, island);
    if (island < 1) islands[title] = +island.toFixed(2);
  }
  console.log(JSON.stringify({ entranceApart: apart, gates, postsUnder1Apart: touching, leastBetweenPosts: +least.toFixed(2), islandsUnder1: islands, roadDrawn: Math.round(road), tunnels, overThird, unrouted, slowestMs: Math.round(slowest) }));
}
