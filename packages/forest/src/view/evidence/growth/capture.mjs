// Seeded capture for ADR-0804 D3/D7 as anchored to dependency rows by ADR-0839 D1-D3: the same eight-story seed
// and real code survey as ../file-circles, the same 1440 x 960 viewport, no hand-panning. Four scenarios:
//   before   no survey, so every island is sized by its capabilities
//   after    the real survey: each island's land follows its lines of code
//   nudged   The agent link's code doubled: its row packs again; other rows that fit stay in place
//   grown    every story's code x5: row packing and nudging need a larger globe (and core)
// Run from the checkout root with `node --import tsx`, after `node build.mjs`.
// Measures what can be counted before anyone looks and writes measurements.json.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fakeBridge, withCapture } from '../../../../../../apps/desktop/src/capture/index.ts'; // run with node --import tsx
import { fileURLToPath } from 'node:url';
import { forestScene, storyNodes, rowOf, PLANET_RADIUS, SEA_GAP } from '@storytree/forest';
import { workStates } from '@storytree/arc-surface';
import { planetLayout } from '../../planet-navigation.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(readFileSync(path.join(here, '../knowledge-under-islands/seed.json'), 'utf8'));
const survey = JSON.parse(readFileSync(path.join(here, '../file-circles/survey.json'), 'utf8'));
const AGENT_LINK = 'story_05e45963ca9f';
const scaled = (by) => Object.fromEntries(Object.entries(survey).map(([id, story]) => [id, { ...story,
  files: story.files.map(file => ({ ...file, lines: Math.round(file.lines * (typeof by === 'function' ? by(id) : by)) })) }]));
const scenarios = {
  before: {},
  after: survey,
  nudged: scaled(id => id === AGENT_LINK ? 2 : 1),
  grown: scaled(5),
};
const changes = seed.changes.changes;

// Contracts 3.4 and 7.17: measure the rendered near-side name against the actual strip,
// including the header left when collapsed. CSS visibility alone misses an overlay covering it.
const measureName = page => page.evaluate(() => {
  const label = [...document.querySelectorAll('.planet-nameplate[data-story-id]')].find(el => el.textContent === 'The library');
  const strip = document.querySelector('.sessions-list');
  const rectangle = el => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };
  return { name: rectangle(label), strip: rectangle(strip), visible: label.checkVisibility({ visibilityProperty: true }), facing: Number(label.dataset.facing) };
});
const assertName = (reading, state) => {
  assert.ok(reading.visible && reading.facing > 0, `3.4: The library is a visible near-side name (${state})`);
  assert.ok(reading.name.bottom <= reading.strip.top - 2.99,
    `3.4 / 7.17: The library bottom ${reading.name.bottom} clears Sessions top ${reading.strip.top} (${state})`);
};
await withCapture({ folder: here, dist: path.join(here, 'dist') }, async ({ browser, origin, out, settle }) => {

/** Per island: its drawn land, how far its coast reaches, and where its plate stands (a direction, in the globe's own frame); and the globe's radius. */
const measure = page => page.evaluate(() => {
  const { scene } = window.__globe;
  scene.updateMatrixWorld(true);
  const shell = scene.getObjectByName('planet:shell');
  const islands = [];
  scene.traverse(object => {
    if (!object.name.startsWith('planet:story_')) return;
    const local = new object.position.constructor();
    let area = 0, reach = 0;
    object.traverse(child => {
      if (child.name !== 'island-ground') return;
      child.traverse(mesh => {
        if (!mesh.geometry?.attributes?.position) return;
        const at = mesh.geometry.attributes.position, index = mesh.geometry.index;
        const point = i => { local.fromBufferAttribute(at, i).applyMatrix4(mesh.matrixWorld); object.worldToLocal(local); return [local.x, local.z]; };
        const n = index ? index.count : at.count;
        for (let t = 0; t < n; t += 3) {
          const [a, b, c] = [0, 1, 2].map(k => point(index ? index.getX(t + k) : t + k));
          area += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
          reach = Math.max(reach, Math.hypot(a[0], a[1]), Math.hypot(b[0], b[1]), Math.hypot(c[0], c[1]));
        }
      });
    });
    const p = object.position.clone();
    islands.push({ story: object.name.slice(7), area, reach, distance: p.length(), direction: p.normalize().toArray() });
  });
  // The knowledge core's points sit inside the globe, so their farthest distance from its middle is the core's size.
  let core = 0, points = 0;
  scene.traverse(object => { if (object.name.startsWith('knowledge-point:')) { points++; core = Math.max(core, object.position.length()); } });
  return { radius: shell.geometry.parameters.radius, coreReach: core, corePoints: points, zoom: window.__globe.camera.zoom, islands };
});

  const results = { seed: seed.stats, scenarios: {} };
  for (const [name, code] of Object.entries(scenarios)) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, colorScheme: 'dark' });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const bridge = fakeBridge({});
    await bridge.install(page);
    await page.addInitScript(({ data, survey }) => {
      const copy = value => structuredClone(value);
      let current = data.projects.includes('storytree') ? 'storytree' : data.projects[0];
      window.storytreeAnswers = {
        projectSelection: async () => copy({ projects: data.projects, current }),
        chooseProject: async project => { current = project; return copy({ projects: data.projects, current }); },
        listProjects: async () => copy(data.projects), projectTree: async () => copy(data.tree),
        changesSince: async (_, cursor) => cursor === 0 ? copy(data.changes) : { changes: [], cursor: data.changes.cursor },
        linesSince: async (_, cursor) => cursor === 0 ? copy(data.lines) : { lines: [], cursor: data.lines.cursor },
        frontCovers: async (_, id) => copy(data.covers[id] ?? []), relatedNotes: async () => [], readSurfaces: async () => undefined,
        codeSurvey: async () => copy(survey),
      };
    }, { data: seed, survey: code });
    await page.goto(`${origin}/index.html`, { timeout: 180000, waitUntil: 'domcontentloaded' });
    await page.waitForFunction(ids => {
      const state = window.__globe;
      if (document.body.dataset.state !== 'ready' || !state || !window.__nav) return false;
      return ids.every(id => !!state.scene.getObjectByName(`planet:${id}`)?.getObjectByName('island-ground'));
    }, seed.tree.stories.map(s => s.id), { timeout: 60000 });
    if (Object.keys(code).length > 0) await page.waitForFunction(() => { let n = 0; window.__globe.scene.traverse(o => { if (o.name.startsWith('file:')) n++; }); return n > 0; }, undefined, { timeout: 30000 });
    const closeMenu = page.getByRole('button', { name: 'Close app menu', exact: true });
    if (await closeMenu.isVisible()) await closeMenu.click();
    await page.evaluate(() => { for (const menu of document.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover(); });
    await settle(page);
    const measured = await measure(page);
    if (name === 'grown') {
      measured.nameClearance = { expanded: await measureName(page) };
      assertName(measured.nameClearance.expanded, 'expanded');
      await page.getByRole('button', { name: 'Hide sessions', exact: true }).click();
      // No forced WebGL redraw: changing strip height must update the name by itself.
      await page.waitForFunction(expandedBottom => {
        const label = [...document.querySelectorAll('.planet-nameplate[data-story-id]')].find(el => el.textContent === 'The library');
        return label.getBoundingClientRect().bottom > expandedBottom + 20;
      }, measured.nameClearance.expanded.name.bottom);
      measured.nameClearance.collapsed = await measureName(page);
      assertName(measured.nameClearance.collapsed, 'collapsed');
      await page.screenshot({ path: path.join(out, 'grown-collapsed.png'), timeout: 180000 });
      await page.getByRole('button', { name: 'Show sessions', exact: true }).click();
      await page.waitForFunction(() => {
        const label = [...document.querySelectorAll('.planet-nameplate[data-story-id]')].find(el => el.textContent === 'The library');
        return label.getBoundingClientRect().bottom <= document.querySelector('.sessions-list').getBoundingClientRect().top - 2.99;
      });
      measured.nameClearance.reopened = await measureName(page);
      assertName(measured.nameClearance.reopened, 'reopened');
    }
    const lines = Object.fromEntries(Object.entries(code).map(([id, story]) => [id, story.files.reduce((sum, file) => sum + file.lines, 0)]));
    const nodes = storyNodes(seed.tree, changes, code);
    const expected = planetLayout(forestScene(seed.tree, changes, workStates(seed.lines.lines), code),
      new Map(nodes.map(story => [story.id, story.place])));
    assert.equal(measured.radius, expected.radius, `${name}: the drawn globe uses this scenario's row layout`);
    assert.equal(measured.islands.length, nodes.length, `${name}: every story has its drawn island`);
    for (const island of measured.islands) {
      const node = nodes.find(node => node.id === island.story);
      const spot = expected.spots.get(island.story);
      island.title = node.title;
      island.row = rowOf(node.place).row;
      island.slot = rowOf(node.place).slot;
      island.lines = lines[island.story] ?? null;
      island.expectedDirection = [spot.x, spot.y, spot.z];
      island.layoutError = Math.hypot(...island.direction.map((value, i) => value - island.expectedDirection[i]));
      assert.ok(island.layoutError < 1e-8, `${name}: ${node.title} is at its scenario's dependency-row position`);
    }
    // Nearest two islands' reaches, sea to spare between them (reach discs, as the layout reads them).
    let tightest = Infinity;
    for (const a of measured.islands) for (const b of measured.islands) if (a.story < b.story) {
      const angle = Math.acos(Math.max(-1, Math.min(1, a.direction[0] * b.direction[0] + a.direction[1] * b.direction[1] + a.direction[2] * b.direction[2])));
      tightest = Math.min(tightest, angle * measured.radius - a.reach - b.reach);
    }
    measured.seaBetweenReaches = tightest;
    assert.ok(tightest >= SEA_GAP - 1e-4, `${name}: the drawn coasts keep ${SEA_GAP} units of sea (${tightest})`);
    for (const island of measured.islands) for (const below of measured.islands.filter(other => other.row < island.row)) {
      assert.ok(island.direction[1] > below.direction[1], `${name}: deeper dependency rows stay further north`);
    }
    measured.errors = errors;
    results.scenarios[name] = measured;
    await page.screenshot({ path: path.join(out, `${name}.png`), timeout: 180000 });
    assert.deepEqual(errors, []);
    await page.close();
  }
  const { after, nudged, grown } = results.scenarios;
  const growingRow = after.islands.find(island => island.story === AGENT_LINK).row;
  for (const island of nudged.islands) {
    const before = after.islands.find(other => other.story === island.story);
    island.movedFromSurvey = Math.hypot(...island.direction.map((value, i) => value - before.direction[i]));
    if (island.row === growingRow) assert.ok(island.movedFromSurvey > 1e-4, `${island.title}: growth moves neighbours along the same row`);
    else assert.ok(island.movedFromSurvey < 1e-8, `${island.title}: another row that fits stays in place`);
  }
  assert.equal(nudged.radius, PLANET_RADIUS, 'row packing makes enough room for one doubled island');
  assert.ok(grown.radius > PLANET_RADIUS, 'the globe grows when packing and nudging cannot make room');
  assert.ok(Math.abs(grown.coreReach / after.coreReach - grown.radius / after.radius) < 1e-8, 'the live core grows with the globe');
  assert.ok(Object.values(results.scenarios).every(scenario => scenario.corePoints === after.corePoints), 'growth retains the complete knowledge core');
  results.browser = await browser.version();
  writeFileSync(path.join(out, 'measurements.json'), JSON.stringify(results, null, 2) + '\n');
  const line = ([name, s]) => [name, `radius ${s.radius.toFixed(1)}`, `sea ${s.seaBetweenReaches.toFixed(1)}`, s.islands.map(i => `${i.title}:row${i.row}/${i.area.toFixed(0)}`).join(' ')].join(' | ');
  console.log(Object.entries(results.scenarios).map(line).join('\n'));
});
