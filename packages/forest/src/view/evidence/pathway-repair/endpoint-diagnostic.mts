// Where every link's two ends land on the saved code-rows seed and survey: the desktop's own scene, layout and
// pathway plan (as renderer.ts builds them), each endpoint looked up in its island's territories as test 3.7 does.
// Reads only the committed files; writes endpoint-diagnostic.json. Run: tsx endpoint-diagnostic.mts
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Vector3 } from 'three';
import { workStates } from '@storytree/arc-surface';
import { buildPlanetPathways, plateTransform } from '@storytree/forest-world/geometry';
import { forestScene, storyNodes } from '../../../index.js';
import { planetLayout } from '../../planet-navigation.js';
import { territories, territoryAt } from '../../../territories/territories.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const rows = path.join(here, '../code-rows');
const seed = JSON.parse(gunzipSync(readFileSync(path.join(rows, 'seed.json.gz'))).toString('utf8'));
const survey = JSON.parse(readFileSync(path.join(rows, 'survey.json'), 'utf8'));
const history = seed.changes.changes;
const scene = forestScene(seed.tree, history, workStates([]), survey);
const layout = planetLayout(scene, new Map(storyNodes(seed.tree, history, survey).map(node => [node.id, node.place])));
const plan = buildPlanetPathways(layout.scene, layout.spots, layout.radius);
const segments = new Map(plan.segments.map(segment => [segment.id, segment]));
const titles = new Map<string, string>(seed.tree.stories.flatMap((story: { title: string; capabilities: { id: string; title: string }[] }) =>
  story.capabilities.map(cap => [cap.id, `${story.title} / ${cap.title}`] as const)));

const ends = new Map<string, { inside: boolean; territory: boolean; landedIn?: string }>();
for (const edge of plan.edges) for (const last of [false, true]) {
  const cap = last ? edge.to : edge.from;
  const island = layout.scene.islands.find(i => i.trees.some(t => t.capability === cap))!;
  const ref = last ? edge.segments.at(-1)! : edge.segments[0]!;
  const points = segments.get(ref.id)!.points;
  const endpoint = last !== ref.reversed ? points.at(-1)! : points[0]!;
  const transform = plateTransform(layout.spots.get(island.story)!, layout.radius);
  const local = endpoint.clone().sub(new Vector3(...transform.position)).applyQuaternion(transform.quaternion.clone().invert());
  const shares = island.land?.territories ?? [];
  const landedIn = territoryAt(territories(shares, plan.plates.get(island.story)!.coast), local.x, local.z)?.capability;
  const seen = ends.get(cap) ?? { inside: true, territory: shares.some(share => share.capability === cap) };
  seen.inside &&= landedIn === cap;
  if (landedIn !== cap) seen.landedIn = landedIn ?? 'off the land';
  ends.set(cap, seen);
}

const all = [...ends].map(([id, end]) => ({ id, title: titles.get(id), ...end }));
const result = {
  links: plan.edges.length,
  linkedCapabilities: all.length,
  withTerritory: all.filter(end => end.territory).length,
  endingInside: all.filter(end => end.inside).length,
  withoutTerritory: all.filter(end => !end.territory).map(({ id, title }) => ({ id, title })),
  outsideTheirTerritory: all.filter(end => end.territory && !end.inside),
};
writeFileSync(path.join(here, 'endpoint-diagnostic.json'), JSON.stringify(result, null, 1) + '\n');
console.log(JSON.stringify(result, null, 1));
