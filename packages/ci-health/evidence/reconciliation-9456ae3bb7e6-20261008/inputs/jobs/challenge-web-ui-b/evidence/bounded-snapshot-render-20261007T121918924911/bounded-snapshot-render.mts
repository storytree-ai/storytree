import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { refreshGrowthSnapshot } from '/repo/packages/website/src/saved-growth.ts';
import { growthReading } from '/repo/packages/website/src/tour-reading.ts';
import { drillDown } from '/repo/packages/forest/src/drill-down/drill-down.ts';
import { renderStoryPanel } from '/repo/packages/forest/src/view/story-panel.ts';

const payload = 'passing"><img src="data:," onerror="void 0" data-review-marker="synthetic"><b>Injected panel text</b><span class="';
const title = '<b>Synthetic title</b>';
const health = { reported:{ state:'passing' }, verified:{ state:'not-checked' } };
const input = (state:string, arcs: boolean = true) => JSON.parse(JSON.stringify({
  project:'synthetic-review', capturedAt:'2026-10-01T00:02:00.000Z',
  window:{ from:'2026-10-01T00:00:00.000Z', to:'2026-10-01T00:01:00.000Z' },
  tree:{ arcs:[], stories:[{ id:'story_review', title, health, capabilities:[{
    id:'cap_review', title:'1 · Synthetic capability', description:'Synthetic', dependsOn:[], proposed:false,
    status:'untested', health, contracts:[{ id:'contract_review', title:'1.1 · Synthetic contract',
      health:{ reported:{state}, verified:{state:'not-checked'} } }]
  }] }] }, changes:[], lines:[], stages:[], ...(arcs ? {arcs:[]} : {})
}));
async function throughSnapshot(state:string, withReading = true) {
  await refreshGrowthSnapshot('/work/synthetic-growth.json', async () => input(state, withReading));
  return JSON.parse(await readFile('/work/synthetic-growth.json','utf8'));
}
const poisoned = await throughSnapshot(payload);
const saved = growthReading(poisoned)!;
assert.equal(saved.tree.stories[0]!.capabilities[0]!.contracts[0]!.health.reported.state, payload);
const panel = drillDown(saved.tree, 'story_review', {part:() => 'planned'} as never, [])!;
const html = renderStoryPanel(panel, 'cap_review');
assert.ok(html.includes('<img src="data:," onerror="void 0" data-review-marker="synthetic">'));
assert.ok(html.includes('<b>Injected panel text</b>'));
assert.ok(html.includes('&lt;b&gt;Synthetic title&lt;/b&gt;'));
assert.ok(!html.includes('<b>Synthetic title</b>'));
assert.ok(!renderStoryPanel(panel, undefined).includes('data-review-marker'));
for (const state of ['passing', 'failing', 'not-checked']) {
  const clean = growthReading(await throughSnapshot(state))!;
  const rendered = renderStoryPanel(drillDown(clean.tree, 'story_review', {part:() => 'planned'} as never, [])!, 'cap_review');
  assert.ok(rendered.includes(`class="panel-badge badge-${state}"`));
  assert.ok(!rendered.includes('data-review-marker'));
}
assert.equal(growthReading(await throughSnapshot(payload, false)), undefined);
console.log(JSON.stringify({candidate:'web-ui-002', importedJson:'synthetic JSON round trip', pipeline:['refreshGrowthSnapshot','growthReading','drillDown','renderStoryPanel'], retainedState:panel.capabilities[0]!.contracts[0]!.reported, injectedMarkup:'<img src="data:," onerror="void 0" data-review-marker="synthetic"><b>Injected panel text</b>', controls:['three valid health states','escaped free-text title','unselected capability','no public reading without arcs'], browserExecuted:false, supplierTrustBoundaryTested:false}));
