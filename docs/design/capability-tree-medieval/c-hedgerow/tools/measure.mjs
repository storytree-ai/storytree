// Measures The library's capability tree from the library and the code, writing data.json and the copy index.html carries.
// Run from the checkout root: node docs/design/capability-tree-medieval/c-hedgerow/tools/measure.mjs
// It reads only: storytree tree, map, library read/list and arc list. It writes nothing to the library.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const dir = 'docs/design/capability-tree-medieval/c-hedgerow/';
const STORY = 'story_754e87e7d531';
const run = (...args) => {
  const out = spawnSync('pnpm', ['-s', 'storytree', ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (out.status !== 0) throw new Error(`storytree ${args.join(' ')}: ${out.stderr || out.stdout}`);
  return out.stdout;
};
// The map's own measure (packages/map/src/code-survey/code-survey.ts linesOf): non-blank lines.
const linesOf = (path) => readFileSync(path, 'utf8').split('\n').filter((line) => line.trim() !== '').length;
const isTest = (path) => /\.test\.|\/test\//.test(path);

/** A story's capabilities and their contracts, from `storytree tree <story>`. */
function treeOf(story) {
  const caps = [];
  let cur;
  for (const line of run('tree', story).split('\n')) {
    let m = line.match(/^  (\d+) · (.*?)  \[(capability_[0-9a-f]{12})\].*storytree verified ([^;]*?)(?:; (.*))?$/);
    if (m) {
      const word = (m[5] ?? '').split(' —')[0].trim();
      caps.push(cur = { id: m[3], number: m[1], title: m[2], status: ['healthy', 'unhealthy', 'untested', 'proposed'].find((w) => word.startsWith(w)) ?? 'untested', contracts: [] });
      continue;
    }
    m = line.match(/^      - (\d+\.\d+) · (.*)$/);
    if (m && cur) {
      const id = m[2].match(/  \[(contract_[0-9a-f]{12})\]/);
      cur.contracts.push({ number: m[1], title: (id ? m[2].slice(0, id.index) : m[2]).trim(), ...(id ? { id: id[1] } : {}) });
    }
  }
  return caps;
}
/** Records read whole, split by their headers. */
function records(ids) {
  return run('library', 'read', ...ids).split(/\n(?=(?:capability|increment|arc|story)_[0-9a-f]{12}  \[)/).map((text) => ({
    id: text.match(/^\S+/)[0],
    field: (name) => text.match(new RegExp(`\\n${name}: (.*)`))?.[1],
    list: (name) => [...(text.match(new RegExp(`\\n${name}: \\[([\\s\\S]*?)\\]`))?.[1] ?? '').matchAll(/"([^"]+)"/g)].map((x) => x[1]),
  }));
}

const territories = treeOf(STORY);
const caps = new Map(records(territories.map(({ id }) => id)).map((r) => [r.id, r]));
for (const t of territories) {
  const rec = caps.get(t.id);
  t.description = rec.field('description') ?? '';
  t.dependsOn = rec.list('dependsOn');
  if (rec.list('parkedOn').length > 0) t.parked = true;
  const rows = JSON.parse(run('map', '--select', `cap:${t.id}`, '--down', '1', '--kind', 'file', '--show', '--json')).rows ?? [];
  t.files = rows.filter((r) => r.kind === 'file' && !isTest(r.path)).map((r) => ({ path: r.path, lines: linesOf(r.path) }));
  t.lines = t.files.reduce((sum, f) => sum + f.lines, 0);
}
const owned = new Set(territories.flatMap((t) => t.files.map((f) => f.path)));
const storyFiles = JSON.parse(run('map', '--select', `story:${STORY}`, '--down', '1', '--kind', 'file', '--show', '--json')).rows ?? [];
const unclaimed = storyFiles.filter((r) => r.kind === 'file' && !isTest(r.path) && !owned.has(r.path)).map((r) => ({ path: r.path, lines: linesOf(r.path) }));

const ids = new Set(territories.map(({ id }) => id));
const links = territories.flatMap((t) => t.dependsOn.map((to) => ({ from: t.id, to })));
const outside = [...new Set(links.map(({ to }) => to).filter((to) => !ids.has(to)))];
const external = outside.map((id) => {
  const rec = records([id])[0];
  const story = rec.field('story');
  const cap = treeOf(story).find((c) => c.id === id);
  return { id, number: cap.number, title: cap.title, story: { id: story, title: run('tree', story).split('\n')[0].split('  [')[0] }, contracts: cap.contracts };
});

// Open work: every proposal or active increment whose capabilities list names one of the story's capabilities.
const open = ['proposal', 'active'].flatMap((status) => [...run('library', 'list', 'increment', '--where', `status=${status}`).matchAll(/increment_[0-9a-f]{12}/g)].map((m) => m[0]));
const touching = records([...new Set(open)]).filter((r) => r.list('capabilities').some((c) => ids.has(c)));
const arcTitles = new Map([...run('library', 'list', 'arc').matchAll(/(arc_[0-9a-f]{12})  (.*)/g)].map((m) => [m[1], m[2].trim()]));
const work = territories.map(({ id }) => {
  const incs = touching.filter((r) => r.list('capabilities').includes(id));
  const arcs = [...new Set(incs.map((r) => r.field('arc')))].map((arc) => ({
    id: arc, title: arcTitles.get(arc) ?? arc,
    increments: incs.filter((r) => r.field('arc') === arc).map((r) => ({ id: r.id, title: r.field('title'), status: r.field('status') })),
  }));
  return { capability: id, arcs };
}).filter(({ arcs }) => arcs.length > 0);

const commit = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
const data = {
  story: { id: STORY, title: 'The library' },
  measured: { on: new Date().toISOString().slice(0, 10), commit, sample: work.length === 0 },
  territories: territories.map(({ dependsOn, ...t }) => t),
  unclaimed: { lines: unclaimed.reduce((s, f) => s + f.lines, 0), files: unclaimed },
  links,
  external,
  work,
};
writeFileSync(dir + 'data.json', JSON.stringify(data, null, 1) + '\n');
// The page opens from disk, where it may not fetch, so it carries the same data.
const page = readFileSync(dir + 'index.html', 'utf8');
writeFileSync(dir + 'index.html', page.replace(/(<script type="application\/json" id="data">)[\s\S]*?(<\/script>)/, `$1${JSON.stringify(data)}$2`));
console.log(`${territories.length} territories, ${data.territories.reduce((s, t) => s + t.lines, 0)} lines, ${links.length} links, ${work.length} with open work`);
