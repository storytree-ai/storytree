import { mkdirSync, readFileSync, readdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import { parseStory } from '../../../scripts/library-seed.mjs';
import { forestScene } from '@storytree/forest';
import { workStates } from '@storytree/arc-surface';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const dist = path.join(here, 'dist');
mkdirSync(dist, { recursive: true });
const health = { reported: { state: 'not-checked' }, verified: { state: 'not-checked' } };
const stories = readdirSync(path.join(root, 'stories')).filter(f => f.endsWith('.md')).sort().map(file => {
  const parsed = parseStory(readFileSync(path.join(root, 'stories', file), 'utf8'));
  const id = file.replace('.md', '');
  return {
    id, title: parsed.title, health,
    capabilities: parsed.capabilities.map(c => ({
      id: `${id}:${c.number}`, title: c.title, health,
      dependsOn: c.dependsOn.map(n => `${id}:${n}`),
      contracts: c.contracts.map(k => ({ id: `${id}:${k.number}`, title: k.title, health })),
    })),
  };
});
const own = forestScene({ stories, arcs: [] }, [], workStates([]));
// A larger fictional project, with real parsed capability/contract counts but invented states.
const syntheticStories = Array.from({ length: 36 }, (_, i) => {
  const base = stories[i % stories.length];
  const state = i % 11 === 0 ? 'failing' : i % 5 === 0 ? 'not-checked' : 'passing';
  return {
    ...base, id: `synthetic-${i + 1}`, title: `Story ${String(i + 1).padStart(2, '0')}`,
    capabilities: base.capabilities.map((c, j) => ({
      ...c, id: `synthetic-${i + 1}:${j}`, dependsOn: [],
      health: { ...health, reported: { state } },
    })),
  };
});
const synthetic = forestScene({ stories: syntheticStories, arcs: [] }, [], {
  part: id => Number(id.split('-')[1].split(':')[0]) % 4 === 0 ? 'in-progress' : 'landed',
  story: () => 'in-progress',
});
writeFileSync(path.join(dist, 'forests.json'), JSON.stringify({ own, synthetic }, null, 2));
await build({
  entryPoints: [path.join(here, 'scene.tsx')], outfile: path.join(dist, 'scene.js'),
  bundle: true, sourcemap: true, format: 'iife', platform: 'browser', target: 'es2023',
  loader: { '.glb': 'binary' }, jsx: 'automatic', logLevel: 'warning',
  define: { 'process.env.NODE_ENV': '"production"' },
  // Only the scene/PLACE_WIDTH entry is needed. The root barrel also reaches agent-link's
  // unrelated node-only merge reader on this checkout; do not bundle that into this scratch page.
  alias: { '@storytree/forest': path.join(root, 'packages/forest/src/render/forest-scene.ts') },
});
copyFileSync(path.join(here, 'index.html'), path.join(dist, 'index.html'));
console.log(JSON.stringify({ stories: own.islands.map(i => [i.title, i.trees.length]), synthetic: synthetic.islands.length }));
