// The story panel draws no capability tree (ADR-1285; Mick, 2026-11-07: "I'm actually really liking the one on the map. I
// don't think it's needed."): storytree's own map (the code-rows snapshot and its survey) as the app opens it, close up on The
// library. A capability's territory clicked on the island (a road click falls through to the land under it) opens the panel
// on exactly that capability: its title, its story named small above it, its whole description and its contracts, each with
// its own state, with no tree, card or pop-out and no How it works or Health fold (4.6, 4.8, ADR-1297). The story's name
// opens the story alone, with nothing picked for it and its capabilities by name (4.7); a name opens that capability,
// ringed on the island (4.8), and a contract opens on one click (4.41, ADR-1287); then a gate clicked shows its pair's
// links in the panel (3.88). `node --import tsx capture.mjs` (append --retake to write into
// src/view/evidence/panel-picked-on-island). Measures, from the page, what the panel holds, so "no tree" is measured.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, buildFolder, captureOutput, captureSeed, runCapture } from '../../../../../apps/desktop/src/capture/index.ts';
import { PLATE_CLEARANCE, SHEET_FOV, SHEET_RADIUS } from '../../../../forest-world/src/planet/PlanetWorldCanvas.tsx';
import { DETAIL_ZOOM } from '../../../src/view/zoom-detail.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const pictures = path.join(here, '../../../src/view/evidence', 'panel-picked-on-island');
const { seed, survey } = captureSeed('code-rows');
const dist = buildFolder(here);
await buildCapture({ dist });

const until = async (page, predicate, arg) => page.waitForFunction(predicate, arg, { timeout: 180_000, polling: 200 });
const libraryStory = seed.tree.stories.find(story => story.title === 'The library');
const library = libraryStory.id;
// The snapshot predates edge records (ADR-1279), so The library's links are staged here, one for every pair a gate may join
// (by its recorded dependency where it has one), each with contracts of its own but every third with none, for the gate's
// panel to show both states (ADR-1284 D4). Each link's first contract storytree last saw failing, its second passing, so the
// state line counts one failing.
const ids = libraryStory.capabilities.map(({ id }) => id);
const depends = new Set(libraryStory.capabilities.flatMap(({ id, dependsOn }) => dependsOn.map(to => `${id}>${to}`)));
const seen = state => ({ reported: { state: 'passing', at: '2026-11-08T00:00:00.000Z' }, verified: { state, at: '2026-11-08T00:00:00.000Z' } });
const pairs = ids.flatMap((one, i) => ids.slice(i + 1).map(other => depends.has(`${other}>${one}`) ? { from: other, to: one } : { from: one, to: other }));
libraryStory.edges = pairs.map(({ from, to }, index) => ({
  id: `staged-edge-${index}`, from, to,
  contracts: index % 3 === 2 ? [] : [
    { id: `staged-edge-${index}-reads`, title: 'Reads the other only through its exported functions, never its tables', health: seen('failing') },
    { id: `staged-edge-${index}-ids`, title: 'Names each record it hands over by its id', health: seen('passing') },
  ],
}));
/** What the panel holds: the capability whose detail it shows, a gate's links, and anything of a tree. */
const panel = page => page.evaluate(() => {
  const aside = document.querySelector('aside.story-panel');
  return {
    open: aside !== null && !aside.hidden,
    detail: aside?.querySelector('.panel-detail')?.dataset.capabilityId,
    title: aside?.querySelector('.panel-head h2')?.textContent,
    story: aside?.querySelector('.panel-head .panel-story-name')?.textContent,
    names: [...aside?.querySelectorAll('.panel-pick') ?? []].map(b => b.textContent),
    contractStates: [...aside?.querySelectorAll('.panel-detail [data-contract-id] .panel-handle .panel-mark') ?? []].length,
    gate: aside?.querySelector('.panel-gate') !== null && aside?.querySelector('.panel-gate') !== undefined,
    links: [...aside?.querySelectorAll('.panel-gate h3') ?? []].map(h => ({ said: h.textContent, contracts: h.nextElementSibling?.querySelectorAll('[data-contract-id]').length ?? 0, state: (h.nextElementSibling?.classList.contains('panel-link-state') ? [h.nextElementSibling.querySelector('.panel-handle')?.textContent, h.nextElementSibling.querySelector('.panel-link-failing')?.textContent, h.nextElementSibling.querySelector('.panel-link-open')?.textContent].filter(Boolean).join(' ') : h.nextElementSibling?.textContent) ?? '' })),
    tree: aside?.querySelectorAll('svg:not(.panel-mark > svg), .panel-tree, [data-open-tree], [role="button"]').length ?? 0,
    handles: [...aside?.querySelectorAll('.panel-handle') ?? []].filter(h => h.closest('.panel-fold-body[hidden]') === null).map(h => h.textContent),
    opened: [...aside?.querySelectorAll('.panel-handle[aria-expanded="true"]') ?? []].map(h => h.textContent),
    picked: (() => { const found = []; window.__globe.scene.traverse(o => { if (o.visible && o.name.startsWith('picked-ring:')) found.push(o.name.slice('picked-ring:'.length)); }); return found; })(),
  };
});
const eye = { radius: SHEET_RADIUS + PLATE_CLEARANCE, fov: SHEET_FOV };
const closeUp = async (page, settle, times) => {
  if (!await page.evaluate(story => window.storytreeGlobe.face({ kind: 'story', story }), library)) throw new Error('no camera stop for The library');
  await until(page, () => window.storytreeGlobe.still());
  await page.evaluate(({ zoom, radius, fov }) => {
    const { camera, size, invalidate } = window.__globe;
    camera.position.setLength(radius + Math.max(size.height, 1) / 2 / Math.tan(fov * Math.PI / 360) / zoom);
    camera.updateMatrixWorld(); invalidate();
  }, { zoom: DETAIL_ZOOM.near * times, ...eye });
  await settle(page, 12);
};
/** The screen points of The library's gate posts or road segments, nearest the middle of the view first. */
const targets = (page, kind) => page.evaluate(({ story, kind }) => {
  const { scene, camera } = window.__globe, box = document.querySelector('canvas').getBoundingClientRect();
  const marks = [];
  scene.updateMatrixWorld(true);
  scene.getObjectByName(`planet:${story}`).traverse(object => {
    const { gate, between, portal, links, width } = object.userData;
    const wanted = kind === 'gate' ? gate === true && /^gate-post:\d+:1$/.test(object.name) && !between.includes('open') : width !== undefined && !portal && links?.length === 1;
    if (!wanted) return;
    object.geometry.computeBoundingBox();
    const at = object.geometry.boundingBox.getCenter(object.position.clone()).applyMatrix4(object.matrixWorld).project(camera);
    if (Math.abs(at.x) > 0.6 || Math.abs(at.y) > 0.8) return;
    marks.push({ x: box.left + (at.x + 1) / 2 * box.width, y: box.top + (1 - at.y) / 2 * box.height, off: Math.hypot(at.x, at.y) });
  });
  return marks.sort((a, b) => a.off - b.off);
}, { story: library, kind });
const clickUntil = async (page, settle, kind, done) => {
  for (const target of await targets(page, kind)) {
    // A point the open panel covers is skipped: a click there would work its folds (ADR-1287), not the map.
    if (await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('aside.story-panel'), target)) continue;
    await page.mouse.click(target.x, target.y);
    await settle(page, 8);
    if (done(await panel(page))) return;
  }
  throw new Error(`no ${kind} on The library opened the panel as wanted`);
};
const results = {};

await runCapture({
  folder: pictures, dist, seed, survey,
  prepare: async ({ page, settle }) => {
    await until(page, () => document.body.dataset.state === 'ready');
    for (const button of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name: button, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
    await until(page, story => !!window.__globe.scene.getObjectByName(`planet:${story}`)?.getObjectByName('island-roads'), library);
    await closeUp(page, settle, 1.6);
  },
  views: [{
    name: 'capability-picked-on-island',
    prepare: async ({ page, settle }) => {
      await clickUntil(page, settle, 'road', found => found.open && found.picked.length === 1 && found.detail === found.picked[0]);
      await closeUp(page, settle, 1.6);
    },
    measure: async ({ page, out }) => {
      await page.locator('aside.story-panel').screenshot({ path: path.join(out, 'capability-picked-on-island-panel.png') });
      return (results.capability = await panel(page));
    },
    expect: found => {
      assert.equal(found.tree, 0, 'no tree, card or pop-out in the panel');
      assert.equal(found.detail, found.picked[0], 'the panel shows the capability picked on the island');
      assert.equal(found.story, 'The library', 'its story named small above its title');
      assert.deepEqual(found.names, [], 'nothing of the story\'s list');
      assert.ok(!found.handles.some(h => /How it works|Health|Contracts ·/.test(h)), 'no How it works, Health or Contracts fold');
      assert.ok(found.contractStates > 0, 'each contract shows its marks');
      assert.deepEqual(found.opened, [], 'every fold closed on the first pick');
    },
  }, {
    // ADR-1297 D1: the story's name opens the story alone, with no capability picked for it and its capabilities by name.
    name: 'story-alone',
    prepare: async ({ page, settle }) => {
      await page.locator('aside.story-panel .panel-story-name').click();
      await settle(page, 6);
    },
    measure: async ({ page, out }) => {
      await page.locator('aside.story-panel').screenshot({ path: path.join(out, 'story-alone-panel.png') });
      return (results.story = await panel(page));
    },
    expect: found => {
      assert.equal(found.title, 'The library');
      assert.equal(found.detail, undefined, 'no capability picked for the user');
      assert.deepEqual(found.picked, [], 'and none ringed on the island');
      assert.equal(found.names.length, libraryStory.capabilities.length, 'every capability by name');
      assert.ok(!found.handles.some(h => /How it works/.test(h)), 'its whole description, no fold');
    },
  }, {
    // ADR-1297 D1, 4.8: a name opens that capability, ringed on the island as its territory's click would.
    name: 'capability-picked-by-name',
    prepare: async ({ page, settle }) => {
      const names = page.locator('aside.story-panel .panel-pick');
      const wanted = page.locator('aside.story-panel .panel-pick', { hasText: 'Connection by address' });
      await ((await wanted.count()) > 0 ? wanted.first() : names.first()).click();
      await settle(page, 6);
      results.byName = await panel(page);
      await page.locator('aside.story-panel [data-fold="contract"] > .panel-handle').first().click();
      await settle(page, 4);
    },
    measure: async ({ page, out }) => {
      await page.locator('aside.story-panel').screenshot({ path: path.join(out, 'capability-picked-by-name-panel.png') });
      return (results.opened = await panel(page));
    },
    expect: found => {
      assert.ok(results.byName.detail !== undefined && results.byName.detail === results.byName.picked[0], 'the name opens its capability, ringed on the island');
      assert.equal(found.opened.length, 1, 'one click opens a contract to its detail');
    },
  }, {
    // ADR-1284 D4: a gate's links, each its sentence and one state line, their contracts closed behind the handle.
    name: 'gate-picked-on-island',
    prepare: async ({ page, settle }) => {
      await clickUntil(page, settle, 'gate', found => found.open && found.gate && found.links.some(link => link.contracts > 0));
    },
    measure: async ({ page, out }) => {
      await page.locator('aside.story-panel').screenshot({ path: path.join(out, 'gate-picked-on-island-panel.png') });
      return (results.gate = await panel(page));
    },
    expect: found => {
      assert.equal(found.tree, 0);
      assert.equal(found.detail, undefined, 'a gate shows its links in the capability\'s place');
      for (const link of found.links) assert.match(link.state, link.contracts === 0 ? /^No contracts on this link yet\.$/ : /^Contracts · 2 1 failing/, 'each link in one state line, saying how many are failing');
      assert.deepEqual(found.opened, [], 'its contracts closed behind the handle');
    },
  }, {
    name: 'gate-contracts-opened',
    prepare: async ({ page, settle }) => {
      await page.locator('aside.story-panel .panel-gate [data-fold="contracts"] > .panel-handle').first().click();
      await settle(page, 4);
    },
    measure: async ({ page, out }) => {
      await page.locator('aside.story-panel').screenshot({ path: path.join(out, 'gate-contracts-opened-panel.png') });
      return (results.gateOpened = await panel(page));
    },
    expect: found => { assert.equal(found.opened.length, 1, 'a click opens the link\'s contracts'); },
  }, {
    // A gate's contract opens one level deeper, to what a capability's contract shows and nothing more (ADR-1289).
    name: 'gate-contract-opened',
    prepare: async ({ page, settle }) => {
      await page.locator('aside.story-panel .panel-gate [data-fold="contract"] > .panel-handle').first().click();
      await settle(page, 4);
    },
    measure: async ({ page, out }) => {
      await page.locator('aside.story-panel').screenshot({ path: path.join(out, 'gate-contract-opened-panel.png') });
      const said = await page.evaluate(() => [...document.querySelectorAll('aside.story-panel .panel-gate [data-fold="contract"] > .panel-fold-body:not([hidden]) .panel-health > span')].map(span => span.className));
      return (results.gateContractOpened = { ...await panel(page), said });
    },
    expect: found => {
      assert.equal(found.opened.length, 2, 'a click opens the link\'s first contract');
      assert.deepEqual(found.said, ['panel-trail'], 'its trail, the tests\' word on its handle and no agent\'s claim beside it, as a capability\'s contract shows');
    },
  }],
});
writeFileSync(path.join(captureOutput(pictures), 'measurements.json'), JSON.stringify(results, null, 1) + '\n');
console.log(JSON.stringify(results));
