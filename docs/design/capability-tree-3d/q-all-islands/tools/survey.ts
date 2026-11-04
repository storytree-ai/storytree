/** Rollout 1: every island's facts that decide how the look fits it, from the snapshot: its capabilities (and how many
 * hold lines, so have a territory), its links inside and to other islands, its size (the coast's furthest reach and its
 * land's area) and the map's cut (cells). Writes survey.json and prints a line per island.
 * Run from the checkout root: node --import tsx docs/design/capability-tree-3d/q-all-islands/tools/survey.ts */
import { readFileSync, writeFileSync } from "node:fs";
import { forestScene, selectionLanes } from "../../../../../packages/forest/src/index.ts";
import { workStates } from "../../../../../packages/arc-surface/src/index.ts";
import { islandCoast } from "../../../../../packages/forest-world/src/geometry.ts";
import { territories } from "../../../../../packages/forest/src/territories/territories.ts";
import { CUT } from "./layout-core.ts";

const HERE = "docs/design/capability-tree-3d/q-all-islands";
const data = JSON.parse(readFileSync(`${HERE}/data.json`, "utf8"));
const scene = forestScene(data.map.tree, data.map.changes, workStates([]), data.map.survey);
type P = { x: number; z: number };
const area = (r: readonly P[]) => Math.abs(r.reduce((s, a, i) => { const b = r[(i + 1) % r.length]!; return s + a.x * b.z - b.x * a.z; }, 0) / 2);
const rows = scene.islands.map(island => {
  const s = data.stories[island.story], coast = islandCoast(island);
  const own = new Set(s.capabilities.map((c: { id: string }) => c.id));
  const inside = s.capabilities.reduce((n: number, c: { dependsOn: { id: string }[] }) => n + c.dependsOn.filter(d => own.has(d.id)).length, 0);
  const lanes = selectionLanes(scene, island.story);
  const fine = territories(island.land!.territories, coast, CUT);
  return { story: island.story, title: s.story.title, capabilities: s.capabilities.length, territories: fine.territories.length, inside,
    arriving: lanes.filter(l => l.dir === "down").length, leaving: lanes.filter(l => l.dir === "up").length,
    reach: Math.round(Math.max(...coast.flat().map(p => Math.hypot(p.x, p.z)))), land: Math.round(coast.reduce((a, r) => a + area(r), 0)), cells: fine.cells.length, loops: coast.length };
});
writeFileSync(`${HERE}/survey.json`, JSON.stringify(rows, null, 1) + "\n");
for (const r of rows) console.log(`${r.title.padEnd(36)} caps ${r.capabilities} terr ${r.territories} inside ${r.inside} in ${r.arriving} out ${r.leaving} reach ${r.reach} land ${r.land} cells ${r.cells} loops ${r.loops}`);
