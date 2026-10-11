// Each story's row and the roads between stories, as a checkout's forest ranks and draws them from this seed and
// survey: `tsx rows.mts <main checkout> <this checkout>` writes rows.json with both and what changed, and the edges
// the survey derives that have no capability at an end (no road; ADR-0991 D5). Reads nothing but the files here.
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const [before, after] = process.argv.slice(2).map(checkout => path.resolve(checkout));
if (before === undefined || after === undefined) throw new Error('pass <main checkout> <this checkout>');
const seed = JSON.parse(gunzipSync(readFileSync(path.join(here, 'seed.json.gz'))).toString('utf8'));
const survey = JSON.parse(readFileSync(path.join(here, 'survey.json'), 'utf8'));
const titles = new Map<string, string>(seed.tree.stories.map((s: { id: string; title: string }) => [s.id, s.title]));
const owner = new Map<string, string>(seed.tree.stories.flatMap((s: { id: string; capabilities: { id: string; title: string }[] }) => s.capabilities.map(c => [c.id, s.id])));
const capabilityTitle = new Map<string, string>(seed.tree.stories.flatMap((s: { capabilities: { id: string; title: string }[] }) => s.capabilities.map(c => [c.id, c.title])));

async function read(checkout: string) {
  const { storyNodes } = await import(path.join(checkout, 'packages/forest/src/story-nodes/story-nodes.ts'));
  const { forestScene } = await import(path.join(checkout, 'packages/forest/src/render/forest-scene.ts'));
  const { workStates } = await import(path.join(checkout, 'packages/arc-surface/src/index.ts'));
  const nodes = storyNodes(seed.tree, seed.changes.changes, survey) as { id: string; at: { y: number }; dependsOn: string[] }[];
  const links = (forestScene(seed.tree, seed.changes.changes, workStates([]), survey).links ?? []) as { from: string; to: string; typeOnly?: boolean }[];
  const between = links.filter(({ from, to }) => owner.get(from) !== owner.get(to));
  return {
    rows: Object.fromEntries(nodes.map(node => [titles.get(node.id)!, -node.at.y])),
    rowCount: Math.max(...nodes.map(node => -node.at.y)) + 1,
    roads: between.length,
    typeOnlyRoads: between.filter(link => link.typeOnly === true).length,
  };
}

const was = await read(before), now = await read(after);
const moved = Object.keys(now.rows).filter(story => was.rows[story] !== now.rows[story])
  .map(story => ({ story, before: was.rows[story], after: now.rows[story] }));
const edges = Object.entries(survey).flatMap(([story, { edges = [] }]: [string, { edges?: { story: string; from?: string; to?: string; typeOnly: boolean; files: { from: string; to?: string }[] }[] }]) =>
  edges.map(edge => ({ ...edge, by: story })));
const roadless = edges.filter(edge => edge.from === undefined || edge.to === undefined).map(edge => ({
  from: `${titles.get(edge.by)}${edge.from === undefined ? '' : ` · ${capabilityTitle.get(edge.from)}`}`,
  to: `${titles.get(edge.story)}${edge.to === undefined ? '' : ` · ${capabilityTitle.get(edge.to)}`}`,
  typeOnly: edge.typeOnly,
  files: [...new Set(edge.files.map(file => `${file.from} → ${file.to ?? '(not found)'}`))],
}));
const result = {
  seed: seed.stats,
  derivedEdges: { total: edges.length, typeOnly: edges.filter(edge => edge.typeOnly).length, noCapabilityEnd: roadless.length },
  before: was, after: now, moved, roadless,
};
writeFileSync(path.join(here, 'rows.json'), JSON.stringify(result, null, 1) + '\n');
console.log(JSON.stringify({ derivedEdges: result.derivedEdges, before: { rowCount: was.rowCount, roads: was.roads }, after: { rowCount: now.rowCount, roads: now.roads, typeOnly: now.typeOnlyRoads }, moved }, null, 1));
