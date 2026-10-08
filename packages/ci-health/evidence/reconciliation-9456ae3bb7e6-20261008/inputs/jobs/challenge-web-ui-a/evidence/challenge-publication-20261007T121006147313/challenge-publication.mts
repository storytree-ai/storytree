import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { refreshGrowthSnapshot } from '/repo/packages/website/src/saved-growth.ts';
import { growthReading } from '/repo/packages/website/src/tour-reading.ts';
import { drillDown } from '/repo/packages/forest/src/drill-down/drill-down.ts';
import { renderStoryPanel } from '/repo/packages/forest/src/view/story-panel.ts';
import { workStates } from '/repo/packages/arc-surface/src/index.ts';
import { RECORD_SCHEMAS } from '/repo/packages/library/src/schema/types.ts';

const payload = 'passing"><img data-synthetic="health-injection" src="invalid:" onerror="void 0"><span class="';
const freeTitle = '<b data-synthetic="free-title">literal title</b>';
const health = { reported: { state: 'not-checked' }, verified: { state: 'not-checked' } };
function input(state: string, includeReading: boolean): any {
  // A JSON round trip models data, not a callable object or a mutated prototype.
  return JSON.parse(JSON.stringify({
    project: 'synthetic-shop', capturedAt: '2026-10-01T02:00:00Z',
    window: { from: '2026-10-01T00:00:00Z', to: '2026-10-01T01:00:00Z' },
    tree: { arcs: [], unverified: true, stories: [{ id: 'story_shop', title: freeTitle, description: '', health,
      capabilities: [{ id: 'cap_shop', title: '1 · Synthetic capability', description: '', health,
        status: 'untested', proposed: false, dependsOn: [], contracts: [{ id: 'contract_shop', title: '1.1 · Synthetic contract', description: '',
          health: { reported: { state }, verified: { state: 'not-checked' } } }] }] }] },
    changes: [], lines: [], stages: [], ...(includeReading ? { arcs: [], holds: { waits: {}, heldOn: {} } } : {}),
  }));
}
async function writeAndRender(state: string, label: string) {
  const file = `/work/${label}.json`;
  await refreshGrowthSnapshot(file, async () => input(state, true));
  const saved = growthReading(JSON.parse(await readFile(file, 'utf8')))!;
  const panel = drillDown(saved.tree, 'story_shop', workStates([]), saved.changes)!;
  return { saved, html: renderStoryPanel(panel, 'cap_shop'), unselected: renderStoryPanel(panel, undefined) };
}
const bad = await writeAndRender(payload, 'malformed');
assert.equal(bad.saved.tree.stories[0]!.capabilities[0]!.contracts[0]!.health.reported.state, payload);
assert.ok(bad.html.includes('<img data-synthetic="health-injection" src="invalid:" onerror="void 0">'));
assert.ok(!bad.unselected.includes('<img data-synthetic="health-injection"'));
assert.ok(!bad.html.includes('<b data-synthetic="free-title">'));
assert.ok(bad.html.includes('&lt;b data-synthetic="free-title"&gt;literal title&lt;/b&gt;'));
for (const state of ['passing', 'failing', 'not-checked']) {
  const good = await writeAndRender(state, state);
  assert.ok(good.html.includes(`class="panel-badge badge-${state}"`));
  assert.ok(!good.html.includes('<img data-synthetic="health-injection"'));
  assert.equal(RECORD_SCHEMAS.health.safeParse({ node: 'contract_shop', column: 'reported', state }).success, true);
}
assert.equal(RECORD_SCHEMAS.health.safeParse({ node: 'contract_shop', column: 'reported', state: payload }).success, false);
await refreshGrowthSnapshot('/work/no-reading.json', async () => input(payload, false));
assert.equal(growthReading(JSON.parse(await readFile('/work/no-reading.json', 'utf8'))), undefined);
assert.equal(RECORD_SCHEMAS.story.safeParse({ title: 'Constructor' }).success, true);
assert.equal(RECORD_SCHEMAS.story.safeParse({ title: 'Shop', id: '__proto__' }).success, false);
console.log('web-ui-002: real snapshot writer -> growthReading -> drillDown -> renderStoryPanel retained malformed health and emitted the injected img/event-handler markup. No browser or publisher CLI executed.');
console.log('web-ui-002 controls: all 3 valid health states rendered; free-text title escaped; contract injection absent without capability selection; no public reading without arcs; library health schema rejected payload.');
console.log('web-ui-004/005 schema controls: Constructor title accepted; explicit id in ordinary story fields rejected. No library writes executed.');
