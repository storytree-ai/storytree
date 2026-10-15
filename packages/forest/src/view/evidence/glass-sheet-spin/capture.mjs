// The glass sheet moved by the keys and spun about its upright axis, with its compass (increment_f9d799c44ac5, ADR-1060),
// drawn by the actual desktop page from the same read-only snapshot of storytree's own library as glass-sheet-tilt/ used
// (branch spike/glass-sheet, its seed.json.gz and survey.json, kept out of this repository for its size). Every move is a
// real key press or a real right-drag of the mouse; the frame sequences hold the page's clock and step it. Run from the
// checkout root, in the foreground:
//   node packages/dev-loop/src/heavy-lock.mjs -- node --import tsx packages/forest/src/view/evidence/glass-sheet-spin/capture.mjs <seed folder> --retake
import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, fakeBridge, withCapture } from '../../../../../../apps/desktop/src/capture/index.ts';
import { SHEET_TILT } from '@storytree/forest-world/planet';

const resting = Math.cos(SHEET_TILT);

const here = path.dirname(fileURLToPath(import.meta.url));
const from = process.argv.slice(2).find(arg => !arg.startsWith('--'));
if (from === undefined) throw new Error('Name the folder holding the snapshot (seed.json.gz and survey.json).');
const seed = JSON.parse(gunzipSync(readFileSync(path.join(from, 'seed.json.gz'))).toString('utf8'));
const survey = JSON.parse(readFileSync(path.join(from, 'survey.json'), 'utf8'));
const dist = path.join(here, 'dist');
const viewport = { width: 1440, height: 960 };
await buildCapture({ dist });

/** What the eye sees now: the face, the tilt, each island's place on the window, and where the compass's needle points. */
const measure = page => page.evaluate(() => {
  const { scene, camera } = window.__globe, V = camera.position.constructor, Q = camera.quaternion.constructor;
  scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
  const eye = new V(0, 0, 1).applyQuaternion(camera.quaternion);
  const canvas = document.querySelector('canvas').getBoundingClientRect();
  const islands = [];
  scene.traverse(object => {
    if (!object.name.startsWith('planet:story_')) return;
    const p = object.getWorldPosition(new V()).project(camera);
    islands.push({ story: object.name.slice(7), x: Math.round((p.x + 1) / 2 * canvas.width * 10) / 10, y: Math.round((1 - p.y) / 2 * canvas.height * 10) / 10, onScreen: Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 });
  });
  const glass = scene.getObjectByName('sheet:glass');
  const facing = new V(0, 0, 1).applyQuaternion(glass.parent.getWorldQuaternion(new Q())).dot(eye);
  const tip = document.querySelector('.sheet-compass-north')?.getAttribute('points')?.split(' ')[0]?.split(',').map(Number);
  return {
    mode: document.querySelector('[data-forest-mode]')?.dataset.forestMode ?? null,
    pressed: Object.fromEntries([...document.querySelectorAll('[data-globe-switch]')].map(b => [b.dataset.globeSwitch, b.getAttribute('aria-pressed')])),
    facing: Math.round(facing * 1000) / 1000,
    zoomPxPerUnit: Math.round(camera.zoom * 1000) / 1000,
    compassNorthDeg: tip === undefined ? null : Math.round(Math.atan2(-(tip[1] - 32), tip[0] - 32) * 1800 / Math.PI) / 10,
    islandsOnScreen: islands.filter(i => i.onScreen).length,
    perIsland: islands,
  };
});

await withCapture({ folder: here, dist }, async ({ browser, origin, out, settle }) => {
  const results = {};
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1, colorScheme: 'dark' });
  await page.addInitScript(() => {
    const real = performance.now.bind(performance);
    let held, behind = 0;
    performance.now = () => held ?? real() - behind;
    window.__holdClock = () => { held = real() - behind; };
    window.__stepClock = ms => { held += ms; };
    window.__releaseClock = () => { if (held !== undefined) { behind = real() - held; held = undefined; } };
  });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const copy = value => structuredClone(value);
  const bridge = fakeBridge({
    projectSelection: async () => ({ projects: seed.projects, current: 'storytree' }),
    chooseProject: async () => ({ projects: seed.projects, current: 'storytree' }),
    listProjects: async () => copy(seed.projects), projectTree: async () => copy(seed.tree),
    changesSince: async (_, cursor) => cursor === 0 ? copy(seed.changes) : { changes: [], cursor: seed.changes.cursor },
    linesSince: async (_, cursor) => cursor === 0 ? copy(seed.lines) : { lines: [], cursor: seed.lines.cursor },
    frontCovers: async (_, id) => copy(seed.covers[id] ?? []),
    codeSurvey: async () => copy(survey),
  });
  await bridge.install(page);
  await page.goto(`${origin}/index.html`, { timeout: 180000, waitUntil: 'domcontentloaded' });
  await bridge.ready(page);
  await page.waitForFunction(ids => {
    const state = window.__globe;
    if (document.body.dataset.state !== 'ready' || !state || !state.scene.getObjectByName('sheet:glass')) return false;
    return ids.every(id => !!state.scene.getObjectByName(`planet:${id}`)?.getObjectByName('island-ground'));
  }, seed.tree.stories.map(s => s.id), { timeout: 180000 });
  await page.waitForFunction(() => { let n = 0; window.__globe.scene.getObjectByName('sheet:under')?.traverse(o => { if (o.name.startsWith('knowledge-point:')) n++; }); return n > 0; }, undefined, { timeout: 180000 });
  for (const name of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
  await page.evaluate(() => { for (const menu of document.querySelectorAll('[popover]')) if (menu.matches(':popover-open')) menu.hidePopover(); });
  // The teaching cards (one at a time, as each part is first met) sit over the sheet and its buttons; they are not the subject.
  await page.evaluate(() => {
    const hide = () => { for (const card of document.querySelectorAll('.teaching-card')) card.style.display = 'none'; };
    hide();
    new MutationObserver(hide).observe(document.body, { childList: true, subtree: true });
  });
  // Keys go to the page, not to a button the capture last clicked.
  const unfocus = () => page.evaluate(() => document.activeElement?.blur?.());
  const shoot = async name => {
    await page.mouse.move(2, 2);
    await settle(page, 30);
    await page.screenshot({ path: path.join(out, `${name}.png`), timeout: 180000 });
    results[name] = await measure(page);
    const { perIsland, ...summary } = results[name];
    console.log(name, JSON.stringify(summary));
  };
  const frames = [];
  const frame = async (strip, label) => {
    await settle(page, 2);
    const file = `${strip}-${String(frames.filter(f => f.strip === strip).length).padStart(2, '0')}.png`;
    await page.screenshot({ path: path.join(out, file), timeout: 180000 });
    frames.push({ strip, file, label });
  };
  /** The angle on the window of the line between two islands on screen, in degrees, y up. */
  const bearing = (view, a, b) => { const p = view.perIsland.find(i => i.story === a), q = view.perIsland.find(i => i.story === b); return Math.atan2(-(q.y - p.y), q.x - p.x) * 180 / Math.PI; };
  const turnBy = (from, to) => { const d = ((to - from) % 360 + 540) % 360 - 180; return d; };

  await shoot('sheet-rest');
  const rest = results['sheet-rest'];
  assert.ok(Math.abs(rest.facing - resting) < 0.01, `the sheet opens on its top face, at the tilt (${rest.facing})`);
  assert.equal(rest.compassNorthDeg, 90, 'the compass points north up the window');
  const [a, b] = rest.perIsland.filter(i => i.onScreen).sort((p, q) => p.x - q.x).filter((_, k, all) => k === 0 || k === all.length - 1).map(i => i.story);

  // Q: a quarter turn, animated, with nothing else changed.
  await unfocus();
  await page.keyboard.press('q');
  await page.waitForTimeout(800);
  await shoot('sheet-after-q');
  const q = results['sheet-after-q'];
  assert.ok(Math.abs(q.facing - resting) < 0.01 && q.zoomPxPerUnit === rest.zoomPxPerUnit, 'the tilt and the zoom hold');
  assert.ok(Math.abs(Math.abs(turnBy(rest.compassNorthDeg, q.compassNorthDeg)) - 90) < 0.2, `the compass turned a quarter (${q.compassNorthDeg}°)`);
  assert.ok(turnBy(bearing(rest, a, b), bearing(q, a, b)) > 20, 'Q turned the sheet anticlockwise on the window');

  // Home: back to the opening view, heading and all.
  await page.keyboard.press('Home');
  await page.waitForTimeout(1000);
  await shoot('sheet-home');
  for (const island of results['sheet-home'].perIsland) {
    const was = rest.perIsland.find(i => i.story === island.story);
    assert.ok(Math.hypot(island.x - was.x, island.y - was.y) < 1.5, `${island.story} is back where it opened`);
  }

  // A right-drag across the window spins the sheet smoothly to an odd heading; the compass shows it.
  const box = await page.locator('canvas').first().boundingBox();
  await page.mouse.move(box.x + 600, box.y + 500);
  await page.mouse.down({ button: 'right' });
  for (let k = 1; k <= 10; k++) await page.mouse.move(box.x + 600 + k * 13, box.y + 500);
  await page.mouse.up({ button: 'right' });
  await shoot('sheet-odd-heading');
  const odd = results['sheet-odd-heading'];
  assert.ok(Math.abs(odd.facing - resting) < 0.01, 'the spin keeps the tilt');
  assert.ok(Math.abs(turnBy(90, odd.compassNorthDeg)) > 10 && Math.abs(turnBy(90, odd.compassNorthDeg)) < 80, `an odd heading (${odd.compassNorthDeg}°)`);

  // T turns the spun sheet over; the heading holds, and the underside shows.
  await page.keyboard.press('t');
  await page.waitForFunction(() => document.querySelector('[data-forest-mode]')?.dataset.forestMode === 'library');
  await page.waitForTimeout(1200);
  await shoot('sheet-underside-spun');
  const under = results['sheet-underside-spun'];
  assert.deepEqual(under.pressed, { stories: 'false', library: 'true' }, 'T turned it over to the Library face');
  assert.ok(Math.abs(under.facing + resting) < 0.01, 'the underside rests at the tilt');
  // Turned over north to south, the window's up and down swap: the needle mirrors about the window's horizontal line.
  assert.ok(Math.abs(turnBy(-odd.compassNorthDeg, under.compassNorthDeg)) < 0.5, `the compass mirrors (${odd.compassNorthDeg}° to ${under.compassNorthDeg}°)`);

  // Back to the top face and home, then the frame sequences: a held D, and an E spin, the page's clock stepped.
  await page.keyboard.press('t');
  await page.waitForTimeout(1200);
  await page.keyboard.press('Home');
  await page.waitForTimeout(1000);
  await page.mouse.move(2, 2);
  await page.evaluate(() => window.__holdClock());
  await frame('pan', '0 ms');
  await page.keyboard.down('d');
  for (let k = 1; k <= 5; k++) { await page.evaluate(() => window.__stepClock(100)); await frame('pan', `${k * 100} ms`); }
  await page.keyboard.up('d');
  await frame('spin', '0 ms');
  await page.keyboard.press('e');
  for (let k = 1; k <= 5; k++) { await page.evaluate(() => window.__stepClock(80)); await frame('spin', `${k * 80} ms`); }
  await page.evaluate(() => window.__releaseClock());
  const panned = await measure(page);

  // Each sequence as one strip of small frames, laid out by the page itself.
  const strip = await browser.newPage({ viewport: { width: 6 * 360 + 7 * 8, height: 2 * (240 + 26) + 3 * 8 }, deviceScaleFactor: 1, colorScheme: 'dark' });
  const row = name => frames.filter(f => f.strip === name).map(f => `<figure><img src="data:image/png;base64,${readFileSync(path.join(out, f.file)).toString('base64')}"><figcaption>${name === 'pan' ? 'D held' : 'E pressed'}, ${f.label}</figcaption></figure>`).join('');
  await strip.setContent(`<style>body{margin:0;background:#0d1419;color:#e6ecf0;font:13px system-ui;padding:8px;display:grid;gap:8px}div{display:flex;gap:8px}figure{margin:0}img{width:360px;height:240px;display:block}figcaption{height:22px;padding-top:4px}</style><div>${row('pan')}</div><div>${row('spin')}</div>`);
  await strip.screenshot({ path: path.join(out, 'pan-and-spin-frames.png') });
  await strip.close();
  // The full-size frames live on only in the strip.
  for (const f of frames) rmSync(path.join(out, f.file));

  assert.deepEqual(errors, []);
  const slim = Object.fromEntries(Object.entries({ ...results, 'after-frames': panned }).map(([name, { perIsland, ...rest }]) => [name, rest]));
  writeFileSync(path.join(out, 'measurements.json'), JSON.stringify({ viewport, seed: seed.stats, results: slim }, null, 1) + '\n');
});
