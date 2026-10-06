// The world 6.14: storytree's own globe from the code-rows seed (packages/forest/src/view/evidence/code-rows), laid out
// as the app lays it out, written as { scene, spots, radius } for capture.mjs. Run:
// node --import tsx packages/forest-world/evidence/roads-charted-about-the-islands/snapshot.mts <output.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { forestScene, storyNodes } from '../../../forest/src/index.ts';
import { workStates } from '../../../arc-surface/src/index.ts';
import { buildPlanetPathways } from '../../src/planet/pathways.ts';
import { planetLayout } from '../../../forest/src/view/planet-navigation.ts';

const rows = new URL('../../../forest/src/view/evidence/code-rows/', import.meta.url);
const seed = JSON.parse(gunzipSync(readFileSync(new URL('seed.json.gz', rows))).toString());
const survey = JSON.parse(readFileSync(new URL('survey.json', rows), 'utf8'));
const scene = forestScene(seed.tree, seed.changes.changes, workStates([]), survey);
const places = new Map(storyNodes(seed.tree, seed.changes.changes, survey).map(node => [node.id, node.place]));
const { spots, radius } = planetLayout(scene, places);
writeFileSync(process.argv[2]!, JSON.stringify({ scene, spots: [...spots], radius }));
// The longest stretch of any road filled in along the surface rather than routed, as this checkout routes it.
const filled = Math.max(0, ...buildPlanetPathways(scene, spots, radius).segments.map(s => s.filled ?? 0));
console.log(`radius ${radius.toFixed(1)}; longest unrouted stretch ${filled.toFixed(1)} units (${(filled / radius * 180 / Math.PI).toFixed(1)}°)`);
