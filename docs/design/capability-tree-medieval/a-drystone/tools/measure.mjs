// Snapshots The library's capability tree into data.json: capabilities, health, links, contracts and lines of code.
// Run from the checkout root: node docs/design/capability-tree-medieval/a-drystone/tools/measure.mjs
// It also copies data.json into index.html, so the page opens from disk with no network; --inline-only does just that.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const dir = 'docs/design/capability-tree-medieval/a-drystone/';
const story = 'story_754e87e7d531';
// The page carries its own copy of the data, in its <script id="data"> element.
const inline = () => {
  const page = readFileSync(dir + 'index.html', 'utf8');
  const json = readFileSync(dir + 'data.json', 'utf8').trim().replace(/</g, '\\u003c');
  writeFileSync(dir + 'index.html', page.replace(/(<script id="data" type="application\/json">)[\s\S]*?(<\/script>)/, (_, open, close) => open + json + close));
};
if (process.argv.includes('--inline-only')) { inline(); process.exit(0); }
const storytree = (...args) => execFileSync('pnpm', ['-s', 'storytree', ...args], { encoding: 'utf8', maxBuffer: 64 << 20 });

// The tree: each capability's line, then its contracts, a contract's text running until its [contract_…] id.
const capabilities = [];
let open;
for (const line of storytree('tree', story).split('\n')) {
  const capability = line.match(/^  (\d+) · (.+?)  \[(capability_[0-9a-f]+)\].*?(healthy|unhealthy|untested|proposed|parked)?$/);
  if (capability) { capabilities.push({ id: capability[3], number: Number(capability[1]), title: capability[2], health: capability[4] ?? 'untested', contracts: [] }); continue; }
  const start = line.match(/^      - (\d+\.\d+) · (.*)$/);
  if (start) { open = { number: start[1], title: start[2] }; capabilities.at(-1).contracts.push(open); }
  else if (open && line.startsWith(' ')) open.title += ' ' + line.trim();
  if (open && /\[contract_[0-9a-f]+\]/.test(open.title)) {
    const [, title, id] = open.title.match(/^(.*?)\s+\[(contract_[0-9a-f]+)\]/);
    Object.assign(open, { id, title });
    open = undefined;
  }
}

// Each capability's record: its description and what it depends on.
for (const capability of capabilities) {
  const record = storytree('library', 'read', capability.id);
  capability.description = storytree('library', 'read', capability.id, '--field', 'description').trim();
  capability.dependsOn = [...(record.match(/dependsOn: \[([^\]]*)\]/)?.[1] ?? '').matchAll(/capability_[0-9a-f]+/g)].map(([id]) => id);
  // Its files, as the map assigns them, and their lines of code: the map's own count (non-blank lines), tests left out.
  const files = storytree('map', '--select', `cap:${capability.id}`, '--kind', 'file', '--show').split('\n')
    .map(row => row.split(/\s+/)).filter(cells => cells[1] === 'file').map(cells => cells[3]).filter(path => !/\.test\./.test(path));
  capability.files = files.map(path => ({ path, lines: readFileSync(path, 'utf8').split('\n').filter(text => text.trim() !== '').length }));
  capability.lines = capability.files.reduce((sum, file) => sum + file.lines, 0);
}

// A link to another story's capability: its title and its story's.
const ours = new Set(capabilities.map(({ id }) => id));
const outside = {};
for (const id of new Set(capabilities.flatMap(({ dependsOn }) => dependsOn.filter(other => !ours.has(other))))) {
  const storyId = storytree('library', 'read', id, '--field', 'story').trim();
  outside[id] = { title: storytree('library', 'read', id, '--field', 'title').trim(), story: storytree('library', 'read', storyId, '--field', 'title').trim() };
}

// Wrenches: the open increments (proposal or active) whose capabilities lists name one of ours, read in one start.
const openWork = ['proposal', 'active'].flatMap(status => [...storytree('library', 'list', 'increment', '--where', `status=${status}`).matchAll(/increment_[0-9a-f]{12}/g)].map(([id]) => id));
const work = [];
for (const record of storytree('library', 'read', ...new Set(openWork)).split(/\n(?=increment_[0-9a-f]{12}  \[increment\])/)) {
  const named = [...(record.match(/\ncapabilities: \[([^\]]*)\]/)?.[1] ?? '').matchAll(/capability_[0-9a-f]+/g)].map(([id]) => id).filter(id => ours.has(id));
  if (named.length === 0) continue;
  work.push({ id: record.match(/^increment_[0-9a-f]{12}/)[0], title: record.match(/\ntitle: (.*)/)[1], arc: record.match(/\narc: (arc_[0-9a-f]+)/)[1], status: record.match(/\nstatus: (\w+)/)[1], capabilities: named });
}
const arcs = {};
for (const arc of new Set(work.map(({ arc }) => arc))) {
  const [, title, state] = storytree('arc', 'show', arc).match(/^(.*?)  \[arc_[0-9a-f]+\]  (\w+)/);
  arcs[arc] = { title, state };
}
// An unproven capability named by open work on a parked arc reads parked, grey, as the map draws it (ADR-0992).
for (const capability of capabilities) {
  if (capability.health === 'untested' && work.some(({ arc, capabilities: named }) => named.includes(capability.id) && arcs[arc].state === 'parked')) capability.health = 'parked';
}

const data = {
  story: { id: story, title: 'The library', package: 'packages/library' },
  measured: new Date().toISOString().slice(0, 10),
  howMeasured: 'storytree tree (capabilities, contracts, health); library read (description, dependsOn); map --select cap:<id> --kind file (files, tests left out), each counted in non-blank lines as packages/map\'s code survey counts them; open increments (status proposal or active) whose capabilities lists name one of these capabilities, with their arcs from arc show.',
  capabilities,
  outside,
  work,
  arcs,
};
writeFileSync(dir + 'data.json', JSON.stringify(data, null, 2) + '\n');
console.log(capabilities.map(c => `${c.number} ${c.title}: ${c.lines} lines, ${c.contracts.length} contracts, ${c.health}, depends on ${c.dependsOn.join(', ') || 'nothing'}`).join('\n'));
inline();
