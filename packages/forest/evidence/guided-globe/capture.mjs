import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './build.mjs';
import { execFileSync } from 'node:child_process';
import { withCapture } from '../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url)), dist = path.join(here, 'dist');
await withCapture({ folder: here, dist }, async ({ browser, origin, out, settle }) => {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = []; page.on('pageerror', error => errors.push(String(error)));
  await page.goto(origin); await page.waitForFunction(() => window.demo?.controls && window.demo.state && window.demo.state().scene.getObjectByName(`file:${window.demo.path}`));
  const results = [];
  const capture = async name => { await settle(page, 4); await page.screenshot({ path: path.join(out, `${name}.png`) }); };
  const pointer = async target => page.evaluate(target => {
    const at = demo.controls.position(target), mark = document.querySelector('#pointer');
    mark.hidden = !at?.visible;
    if (at) { mark.style.left = `${at.x}px`; mark.style.top = `${at.y}px`; mark.firstElementChild.textContent = target.path ?? 'Knowledge core'; }
  }, target);
  // Contract 3.21/3.23: a public target stop moves the actual globe, exposes its pointer position and survives resize.
  const target = await page.evaluate(() => ({ kind: 'file', story: demo.story, path: demo.path }));
  assert.equal(await page.evaluate(target => demo.controls.stop({ target, framing: 0.6, sideOffset: -150, duration: 300 }), target), true);
  await page.waitForTimeout(600); await settle(page);
  const focused = await page.evaluate(target => demo.controls.position(target), target);
  assert.ok(focused.visible && focused.x < 800); results.push({ contract: '3.21, 3.23', focused });
  await pointer(target); await capture('file-stop');
  const retained = await page.evaluate(() => { const s = demo.state(); demo.kept = { canvas: s.gl.domElement, camera: s.camera, scene: s.scene, zoom: s.camera.zoom }; return true; });
  assert.ok(retained);
  // Contracts 3.22/6.7: inspect the mounted objects after each independent surface switch.
  for (const [field, name] of [['sea', 'planet:shell'], ['grounds', `island-surface:`], ['roads', 'globe-roads'], ['territories', 'territory:'], ['fileCircles', 'file-circles'], ['knowledgeCore', 'globe-core']]) {
    await page.evaluate(field => demo.options({ surfaces: { [field]: false } }), field); await settle(page);
    await page.waitForFunction(name => {
      const matches = [];
      demo.state().scene.traverse(object => { if (object.name.startsWith(name)) {
        let shown = true; for (let at = object; at; at = at.parent) if (!at.visible) shown = false;
        matches.push(shown);
      } });
      return matches.length > 0 && matches.every(shown => !shown);
    }, name);
    const result = await page.evaluate(({ field, name }) => {
      const s = demo.state(), matches = [];
      s.scene.traverse(object => { if (object.name.startsWith(name)) { let shown = true; for (let at = object; at; at = at.parent) if (!at.visible) shown = false; matches.push({ name: object.name, shown }); } });
      return { field, found: matches.length, hidden: matches.every(mark => !mark.shown), shown: matches.filter(mark => mark.shown).map(mark => mark.name), same: s.gl.domElement === demo.kept.canvas && s.camera === demo.kept.camera && s.scene === demo.kept.scene, zoom: s.camera.zoom };
    }, { field, name });
    assert.ok(result.found > 0 && result.hidden && result.same, JSON.stringify(result)); results.push({ contract: '3.22, 6.7', ...result });
  }
  await page.evaluate(() => demo.options({ surfaces: { sessionTints: false } }));
  await page.waitForFunction(() => {
    let visible = 0; demo.state().scene.traverse(object => {
      if (object.name.startsWith('territory-claim:')) {
        let shown = true; for (let at = object; at; at = at.parent) if (!at.visible) shown = false;
        if (shown) visible++;
      }
    }); return visible === 0;
  });
  results.push({ contract: '3.22', field: 'sessionTints', hidden: true });
  await page.evaluate(() => demo.options({ surfaces: { nameplates: false, territories: 'plain' } })); await settle(page);
  await page.waitForFunction(() => !document.querySelector('.planet-nameplate'));
  assert.equal(await page.locator('.planet-nameplate').count(), 0);
  assert.equal(await page.evaluate(() => { let wrong = 0; demo.state().scene.traverse(o => { if (o.name.startsWith('territory:') && o.material.opacity !== 0) wrong++; }); return wrong; }), 0);
  await page.evaluate(() => demo.options({ surfaces: { nameplates: false, territories: 'plain' }, highlighted: [demo.story] }));
  await page.waitForFunction(() => demo.state().scene.getObjectByName(`territory:${demo.capability}`).material.userData.sessionBrightness !== undefined);
  await page.evaluate(() => demo.options({ surfaces: { nameplates: false, territories: 'health' }, highlighted: [demo.story] }));
  await page.waitForFunction(() => demo.state().scene.getObjectByName(`territory:${demo.capability}`).material.opacity > 0);
  await page.evaluate(() => demo.options({ surfaces: { nameplates: false, territories: 'plain' }, highlighted: [demo.story] }));
  await page.waitForFunction(() => demo.state().scene.getObjectByName(`territory:${demo.capability}`).material.opacity === 0);
  await page.evaluate(() => demo.options({ surfaces: { nameplates: false, territories: 'plain' } }));
  await page.waitForFunction(() => demo.state().scene.getObjectByName(`territory:${demo.capability}`).material.userData.sessionBrightness === undefined);
  assert.equal(await page.evaluate(() => demo.state().scene.getObjectByName(`territory:${demo.capability}`).material.opacity), 0);
  results.push({ contract: '3.22', field: 'territories after session hover', plainAndHealthRestored: true });
  await capture('plain-territories');
  await page.evaluate(() => { demo.options({ mode: 'library' }); demo.controls.stop({ target: { kind: 'core' }, framing: 1.18, sideOffset: -150, duration: 0 }); }); await settle(page);
  await page.waitForFunction(target => demo.controls.position(target)?.visible === false, target);
  assert.equal(await page.evaluate(target => demo.controls.position(target).visible, target), false);
  await pointer({ kind: 'core' }); await capture('knowledge-core');
  await page.evaluate(() => demo.options({})); await settle(page);
  await page.waitForFunction(target => demo.controls.position(target)?.visible === true, target);
  await page.setViewportSize({ width: 390, height: 760 });
  await page.waitForFunction(() => demo.state().size.width === 390);
  await page.evaluate(target => demo.controls.stop({ target, framing: 0.8, sideOffset: 0, duration: 0 }), target); await settle(page);
  assert.ok((await page.evaluate(target => demo.controls.position(target), target)).visible); await pointer(target); await capture('phone-stop');
  await page.evaluate(() => demo.arcs.open()); await page.waitForSelector('.arc-overlay:not([hidden])');
  results.push({ contract: 'public views', arcs: await page.locator('.arc-overlay:not([hidden])').count() });
  assert.deepEqual(errors, []);
  await page.evaluate(() => demo.dispose());
  assert.equal(await page.locator('canvas').count(), 0);
  writeFileSync(path.join(out, 'measurements.json'), JSON.stringify({ browser: await browser.version(), errors, results }, null, 2) + '\n');
  // The recorder mints verified health from these actual checks; no agent verdict is an input.
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  for (const [story, contracts, file] of [['The forest', ['3.21', '3.22', '3.23'], 'forest-observations.json'], ['The world', ['6.7'], 'world-observations.json']]) {
    writeFileSync(path.join(out, file), JSON.stringify({ story, commit, evidence: 'packages/forest/evidence/guided-globe',
      checks: contracts.map(contract => ({ contract, name: 'Mounted public camera and surface checks', observed: 'pass' })) }, null, 2) + '\n');
  }
  console.log('PASS 3.21, 3.22, 3.23, 6.7: mounted public views, stops, switches, resize and teardown');
});
