import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { workStates } from '@storytree/arc-surface';
import { forestScene, storyNodes } from '@storytree/forest';
import { sheetLayout } from '../../src/view/sheet-navigation.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const into = path.resolve(here, '../../../forest-world/src/layout-measures/seeds');
const health = { reported: { state: 'not-checked' as const }, verified: { state: 'not-checked' as const } };
const titles = ['Have an account', 'Comment on articles', 'Browse the home page feed', 'Read and write articles', 'Follow people and favourite articles'];

function fiveStoryRow() {
  const ids = titles.map((_, i) => `story_${i}`);
  return { arcs: [], stories: ids.map((id, i) => ({ id, title: titles[i]!, health, capabilities: [{
    id: `${id}-0`, title: 'Capability', dependsOn: i > 0 ? [`${ids[i - 1]}-0`] : [], proposed: true, status: 'proposed' as const, contracts: [], health,
  }] })) };
}

function seedOf(tree: any, survey: any) {
  const places = new Map(storyNodes(tree, [], survey).map(({ id, place }) => [id, place]));
  const scene = forestScene(tree, [], workStates([]), survey);
  const { spots, radius } = sheetLayout(scene, places);
  return { scene, spots: [...spots], radius };
}

const rows = path.join(here, 'code-rows');
const codeRows = JSON.parse(gunzipSync(readFileSync(path.join(rows, 'seed.json.gz'))).toString('utf8'));
const survey = JSON.parse(readFileSync(path.join(rows, 'survey.json'), 'utf8'));
mkdirSync(into, { recursive: true });
writeFileSync(path.join(into, 'five-story-row.json'), JSON.stringify(seedOf(fiveStoryRow(), {})) + '\n');
writeFileSync(path.join(into, 'code-survey.json.gz'), gzipSync(JSON.stringify(seedOf(codeRows.tree, survey)) + '\n'));
console.log(`Wrote the five-story row and the full code survey's layout seeds into ${into}.`);
