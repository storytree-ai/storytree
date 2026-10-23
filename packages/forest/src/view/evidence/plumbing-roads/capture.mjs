// Storytree's own map with its plumbing calls drawn (ADR-1085 D3; forest-world 4.29-4.34, forest 3.67): Setup's build step to
// Plugin loader and Setup's cleanup to Code review, each a road between the two islands labelled with its kind.
// Same seed, same survey, same viewport, same turn every run; the only input is the page's own rotation setter and the wheel.
// Run with node --import tsx; --retake replaces committed evidence (see README.md).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFolder, runCapture, settle } from '../../../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(gunzipSync(readFileSync(path.join(here, 'seed.json.gz'))).toString('utf8'));
const survey = JSON.parse(readFileSync(path.join(here, 'survey.json'), 'utf8'));
const titles = new Map(seed.tree.stories.map(s => [s.id, s.title]));
const ids = seed.tree.stories.map(s => s.id);
const story = title => seed.tree.stories.find(s => s.title === title).id;
const SETUP = story('Setup'), LOADER = story('Plugin loader'), REVIEW = story('Code review');

/** The plumbing roads the page drew, their labels in the DOM, and each plumbing island's place on screen. */
const drawn = (page) => page.evaluate(ids => {
  const { scene, camera } = window.__globe, V = camera.position.constructor;
  scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
  const group = scene.getObjectByName('pathways:cross-island');
  const rect = document.querySelector('canvas').getBoundingClientRect();
  const roads = [];
  scene.traverse(object => {
    if (!object.name.startsWith('pathway:') || !object.userData.plumbing) return;
    roads.push({ id: object.name, plumbing: object.userData.plumbing, links: object.userData.links.length, widthGround: +object.userData.widthGround.toFixed(2),
      colour: '#' + object.material.color.getHexString() });
  });
  const threads = [];
  scene.traverse(object => { if (object.name.startsWith('pathway-plumbing:')) threads.push('#' + object.material.color.getHexString()); });
  const names = [...document.querySelectorAll('.planet-nameplate')].map(el => el.getBoundingClientRect()).filter(r => r.width > 0);
  const meets = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const labels = [...document.querySelectorAll('[data-plumbing]')].map(box => {
    const r = box.getBoundingClientRect();
    return { overlapsAName: names.filter(n => meets(r, n)).length, insideCanvas: r.left >= rect.left && r.right <= rect.right && r.top >= rect.top && r.bottom <= rect.bottom, road: box.dataset.plumbing, chips: [...box.querySelectorAll('span')].map(chip => ({ text: chip.textContent, title: chip.title })),
      x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height), visibility: getComputedStyle(box).visibility };
  });
  const at = id => {
    const plate = scene.getObjectByName(`planet:${id}`), p = plate.getWorldPosition(new V());
    const n = p.clone().project(camera);
    return { x: Math.round(rect.left + (n.x + 1) * rect.width / 2), y: Math.round(rect.top + (1 - n.y) * rect.height / 2),
      facing: +p.clone().normalize().applyQuaternion(camera.quaternion.clone().invert()).z.toFixed(3) };
  };
  return { plumbing: group.userData.plumbing, capabilityRoads: group.userData.links.length, roads, threads, labels,
    islands: Object.fromEntries(ids.map(id => [id, at(id)])) };
}, ids);

/** Drag the sheet from open sea until the middle of `stories` stands at `target` (CSS pixels); real pointer drags, twice, to settle the tilt's foreshortening. */
async function bringTo(page, stories, target, byLabels = false) {
  for (let pass = 0; pass < 4; pass++) {
    const { islands, labels } = await drawn(page);
    const points = byLabels ? labels.map(l => ({ x: l.x + l.width / 2, y: l.y + l.height / 2 })) : stories.map(id => islands[id]);
    const now = points.reduce((m, p) => ({ x: m.x + p.x / points.length, y: m.y + p.y / points.length }), { x: 0, y: 0 });
    const by = { x: target.x - now.x, y: target.y - now.y };
    if (Math.hypot(by.x, by.y) < 6) return;
    const from = { x: 720, y: 760 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + by.x * i / 8, from.y + by.y * i / 8);
    await page.mouse.up();
    await settle(page, 12);
  }
}

const capture = (seed, survey, views) => runCapture({
  folder: here, dist: buildFolder(here, 'after'), seed, survey, views,
  prepare: async ({ page, errors, failed, warnings }) => {
    await page.waitForFunction(ids => {
      const state = window.__globe;
      if (document.body.dataset.state !== 'ready' || !state || !window.__nav) return false;
      return ids.every(id => !!state.scene.getObjectByName(`planet:${id}`)?.getObjectByName('island-ground'));
    }, ids, { timeout: 180000 }).catch(async error => {
      console.error(JSON.stringify({ errors, urls: failed, warnings: warnings.slice(0, 5) }));
      throw error;
    });
    for (const name of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
    await page.evaluate(() => { for (const menu of document.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover(); });
    await settle(page, 20);
  }
});

await capture(seed, survey, [
    { name: 'opening',
      measure: async ({ page, errors }) => ({ errors, ...await drawn(page) }),
      expect: r => {
        assert.deepEqual(r.errors, []);
        console.log('opening: plumbing', r.plumbing, 'capability roads', r.capabilityRoads, 'labels', r.labels.length);
      } },
    { name: 'setup-east',
      prepare: async ({ page }) => { await bringTo(page, [SETUP, REVIEW], { x: 900, y: 420 }); await settle(page, 20); },
      measure: async ({ page, errors }) => ({ errors, ...await drawn(page) }),
      expect: r => { assert.deepEqual(r.errors, []); console.log('setup-east: labels', JSON.stringify(r.labels)); } },
    { name: 'both-labels',
      // Framed on the middle of the two chips, wheeled in two notches: the build step's and the cleanup's both on screen.
      prepare: async ({ page }) => {
        await bringTo(page, [], { x: 720, y: 500 }, true);
        await page.mouse.move(720, 500);
        for (let i = 0; i < Number(process.env.WHEEL ?? 2); i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(150); }
        await settle(page, 20);
        await bringTo(page, [], { x: 720, y: 500 }, true);
        await page.mouse.move(2, 2);
        await settle(page, 20);
      },
      measure: async ({ page, errors }) => ({ errors, ...await drawn(page) }),
      expect: r => {
        assert.deepEqual(r.errors, []);
        assert.deepEqual(r.labels.flatMap(l => l.chips.map(c => c.text)).sort(), ['build step', 'cleanup']);
        assert.ok(r.labels.every(l => l.insideCanvas), 'both chips are on screen');
        console.log('both-labels: labels', JSON.stringify(r.labels.map(l => [l.chips[0].text, l.x, l.y, l.overlapsAName])));
      } },
]);
