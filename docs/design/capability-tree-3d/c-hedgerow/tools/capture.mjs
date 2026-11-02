// Takes the hedgerow mock's stills into ../stills/ from the built page opened from disk (file://, no server, no network),
// in the capture kit's Chromium (software GL, as the map's own evidence captures). Each click still clicks the page where
// the mock's object is drawn and checks the card that opens names it. Run `node tools/build.mjs` first, then:
// node --import tsx docs/design/capability-tree-3d/c-hedgerow/tools/capture.mjs
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { closeBrowser, launch } from '../../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const folder = path.resolve(here, '..'), stills = path.join(folder, 'stills');
mkdirSync(stills, { recursive: true });
const page0 = pathToFileURL(path.join(folder, 'index.html')).href;
// How close the view opens on the island: half the short side, in the glass sheet's radii (the view's own framing).
const PANEL = { width: 480, height: 760, framing: 0.00047 }, WIDE = { width: 960, height: 720, framing: 0.00042 };
const results = {};

const browser = await launch();
try {
  const open = async ({ width, height, framing }, view = '') => {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: 'dark' });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('requestfailed', r => errors.push(`request failed: ${r.url()}`));
    await page.goto(`${page0}?framing=${framing}${view}`);
    await page.waitForFunction(() => document.body.dataset.state === 'ready', undefined, { timeout: 120000 });
    await page.waitForTimeout(2500);
    return { page, errors };
  };
  /** Where a pick of `kind` is drawn on the page, in CSS pixels: the middle of the first one `choose` takes. */
  const where = (page, kind, index = 0) => page.evaluate(([kind, index]) => {
    const { camera } = window.__globe, layer = window.__mockLayer, box = window.__globe.gl.domElement.getBoundingClientRect();
    const picks = layer.picks.filter(p => p.userData.kind === kind);
    const pick = picks[Math.min(index, picks.length - 1)];
    pick.geometry.computeBoundingBox();
    const centre = pick.geometry.boundingBox.getCenter(pick.position.clone());
    const p = pick.localToWorld(centre).project(camera);
    return { x: (p.x + 1) / 2 * box.width + box.left, y: (1 - p.y) / 2 * box.height + box.top, userData: pick.userData, count: picks.length };
  }, [kind, index]);
  const card = page => page.evaluate(() => { const c = document.querySelector('.mock-card'); return c && { kind: c.dataset.card, heading: c.querySelector('h2')?.textContent, items: c.querySelectorAll('li').length }; });

  // 1. The resting view, at the story panel's size (min(30rem, 100% - 1.5rem) wide).
  {
    const { page, errors } = await open(PANEL);
    results.counts = await page.evaluate(() => ({ ...document.body.dataset }));
    await page.screenshot({ path: path.join(stills, '1-resting-panel.png') });
    results.restingErrors = errors;
    await page.close();
  }
  // 2. The same island orbited: turned with E and tilted lower with F, the view's own keys, held as a hand would.
  {
    const { page } = await open(WIDE);
    await page.locator('canvas').click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.keyboard.press('Escape');
    for (const [key, ms] of [['e', 700], ['f', 450]]) { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); }
    await page.waitForTimeout(1500);
    await page.evaluate(() => document.querySelector('.mock-card .mock-close')?.click());
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(stills, '2-orbited.png') });
    await page.close();
  }
  // 3. A wrench's arc list, 4. a pathway's contracts, 5. a gate's, 6. a territory's description and contracts.
  {
    const { page } = await open(WIDE);
    const click = async (kind, index) => {
      const at = await where(page, kind, index);
      await page.mouse.click(at.x, at.y);
      await page.waitForTimeout(600);
      return at;
    };
    const wrench = await click('wrench');
    results.wrench = { clicked: wrench.userData, card: await card(page) };
    assert.equal(results.wrench.card?.kind, 'wrench');
    await page.screenshot({ path: path.join(stills, '3-wrench-arcs.png') });
    // The track carrying the most links, so the card shows a shared stretch.
    const tracks = await page.evaluate(() => window.__mockLayer.picks.map((p, i) => [i, p.userData]).filter(([, u]) => u.kind === 'track'));
    const busiest = tracks.map(([, u], i) => [i, u.links.length]).sort((a, b) => b[1] - a[1])[0][0];
    const track = await click('track', busiest);
    results.track = { clicked: track.userData, card: await card(page) };
    assert.equal(results.track.card?.kind, 'track');
    await page.screenshot({ path: path.join(stills, '4-pathway-contracts.png') });
    const gate = await click('gate', 3);
    results.gate = { clicked: gate.userData, card: await card(page) };
    assert.equal(results.gate.card?.kind, 'gate');
    await page.screenshot({ path: path.join(stills, '5-gate-contracts.png') });
    // A territory: a point on its land clear of tracks and hedges, found by the view's own pick (forest 3.15).
    await page.evaluate(() => document.querySelector('.mock-card .mock-close')?.click());
    const seat = await page.evaluate(() => {
      const { camera } = window.__globe, box = window.__globe.gl.domElement.getBoundingClientRect();
      const plate = window.__mockLayer.root.parent, land = plate.getObjectByName('territory-land');
      const mesh = land.children.find(c => c.userData.word === 'untested' && !c.userData.parked) ?? land.children.find(c => c.userData.capability);
      // The middle of its largest triangle, well inside its land.
      const a = mesh.geometry.attributes.position, v = mesh.position.clone();
      let best = 0, area = -1;
      for (let i = 0; i < a.count; i += 3) {
        const ux = a.getX(i + 1) - a.getX(i), uz = a.getZ(i + 1) - a.getZ(i), wx = a.getX(i + 2) - a.getX(i), wz = a.getZ(i + 2) - a.getZ(i);
        const s = Math.abs(ux * wz - uz * wx);
        if (s > area) { area = s; best = i; }
      }
      v.set((a.getX(best) + a.getX(best + 1) + a.getX(best + 2)) / 3, (a.getY(best) + a.getY(best + 1) + a.getY(best + 2)) / 3, (a.getZ(best) + a.getZ(best + 1) + a.getZ(best + 2)) / 3);
      const p = mesh.localToWorld(v).project(camera);
      return { x: (p.x + 1) / 2 * box.width + box.left, y: (1 - p.y) / 2 * box.height + box.top, capability: mesh.userData.capability };
    });
    await page.mouse.click(seat.x, seat.y);
    await page.waitForTimeout(800);
    results.territory = { aimedAt: seat.capability, card: await card(page) };
    assert.equal(results.territory.card?.kind, 'territory');
    assert.notEqual(results.territory.card?.heading, 'The library', 'the click landed on the island, not a territory');
    await page.screenshot({ path: path.join(stills, '6-territory-contracts.png') });
    await page.close();
  }
  // 7. Side by side at the same size and framing: the real map's island today (file dots and all), and the mock.
  {
    const shots = [];
    for (const view of ['&view=real', '']) {
      const { page } = await open(PANEL, view);
      shots.push((await page.screenshot()).toString('base64'));
      await page.close();
    }
    const page = await browser.newPage({ viewport: { width: PANEL.width * 2 + 12, height: PANEL.height + 34 } });
    await page.setContent(`<body style="margin:0;background:#101418;color:#E8EEF0;font:13px system-ui;display:flex;gap:12px">
      ${shots.map((s, i) => `<figure style="margin:0"><figcaption style="padding:8px 10px">${i === 0 ? 'The real map today' : 'With hedgerows, gates, tracks and the wrench'}</figcaption><img style="display:block" src="data:image/png;base64,${s}"></figure>`).join('')}</body>`);
    await page.screenshot({ path: path.join(stills, '7-side-by-side.png') });
    await page.close();
  }
} finally {
  await closeBrowser(browser);
}
writeFileSync(path.join(stills, 'capture.json'), JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify(results, null, 1));
