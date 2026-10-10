// Seeded, repeatable capture of the claim flag (ADR-0968) on the real globe: the code-rows reading, one island left with no
// code, labelled fixture claims, the globe's clock held at set moments. Pictures at the tour's close-up (an island about
// 480 px wide), the resting globe and a 390-wide phone, of a claim arriving, held, quiet and gone, three sessions in three
// colours, and two lots. Run `node --import tsx capture.mjs` under `node "<checkout>/packages/dev-loop/src/heavy-lock.mjs" --`.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './build.mjs';
import { withCapture } from '../../../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url)), dist = path.join(here, 'dist');
const ISLAND_WIDTH = 44; // ground units an island of the drawn sizes spans (claim-flag.ts)
await withCapture({ folder: here, dist }, async ({ browser, origin, out, settle }) => {
  const results = { pictures: [] };
  for (const viewport of [{ name: 'desktop', width: 1440, height: 960 }, { name: 'phone', width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: viewport.name === 'phone' ? 2 : 1 });
    const errors = []; page.on('pageerror', error => errors.push(String(error)));
    await page.goto(origin);
    await page.waitForFunction(() => { if (!window.demo?.controls || !window.demo.state) return false; let flags = 0; window.demo.state().scene.traverse(o => { if (o.name.startsWith('territory-claim:')) flags++; }); return flags >= 5; }, undefined, { timeout: 60000 });
    await settle(page, 6);
    const at = async t => { await page.evaluate(t => { demo.t = t; demo.state().invalidate(); }, t); await settle(page, 3); };
    // The framing (radii across half the short side) at which an island of the drawn sizes is `px` wide: `orthographicZoomFor` turned round.
    const face = async (story, px) => {
      await page.evaluate(([story, px, width]) => {
        const { size, scene } = demo.state();
        const radius = scene.getObjectByName(`planet:${story}`).position.length();
        // Never past the islands (PAST_ISLANDS.leave, 0.34): this reading's globe is large, so its deepest close-up is less than 480 px.
        return demo.controls.stop({ target: { kind: 'story', story }, framing: Math.max(0.36, Math.min(size.width, size.height) / (2 * radius * px / width)), duration: 1 });
      }, [story, px, ISLAND_WIDTH]);
      await page.waitForTimeout(100); await settle(page, 6);
    };
    const picture = async (name, stage) => { await page.evaluate(stage => demo.stage(stage), stage); await page.screenshot({ path: path.join(out, `${viewport.name}-${name}.png`) }); results.pictures.push(`${viewport.name}-${name}.png`); };
    const measure = () => page.evaluate(() => {
      const { scene, camera } = demo.state(); scene.updateMatrixWorld(true);
      const flags = []; scene.traverse(o => { if (!o.name.startsWith('territory-claim:')) return;
        const pole = o.getObjectByName('flag-pole'), dot = o.getObjectByName('flag-dot'), lot = o.getObjectByName(`claim-lot:${o.userData.capability}`);
        let height = null; if (pole?.visible) { pole.geometry.computeBoundingBox(); const { min, max } = pole.geometry.boundingBox; const end = y => min.clone().set(0, y, 0).applyMatrix4(pole.matrixWorld).project(camera); height = Math.round(Math.abs(end(min.y).y - end(max.y).y) * demo.state().size.height / 2 * 10) / 10; }
        flags.push({ ...o.userData, dot: !!dot?.visible, poleHeightPx: height, lotDashes: lot ? lot.geometry.attributes.position.count / 2 : 0 }); });
      let bands = 0; scene.traverse(o => { if (o.name.startsWith('territory-claim:') && o.isMesh) bands++; });
      return { zoom: camera.zoom, flags, bands };
    });
    for (const [label, px] of viewport.name === 'phone' ? [['rest', 30], ['close', 200]] : [['rest', 90], ['close', 480]]) {
      await at(undefined);
      await face(await page.evaluate(() => demo.built), px);
      await at(100);
      const held = await measure();
      results[`${viewport.name}-${label}`] = held;
      assert.equal(held.bands, 0, 'no band is drawn for a claim');
      await picture(`${label}-held`, `${label}: three sessions' flags, held`);
      // A fourth session's claim arrives, goes quiet and is released.
      await page.evaluate(() => demo.arrive()); await settle(page, 2);
      for (const [t, stage] of [[100.12, 'arriving: dropping in'], [100.4, 'arriving: overshoot'], [100.75, 'arriving: the ring at its foot'], [102, 'held']]) {
        await at(t); await picture(`${label}-arrive-${String(t).replace('.', '_')}`, `${label}, ${stage}`);
      }
      await at(110); await page.evaluate(() => demo.quiet()); await settle(page, 2);
      await at(110.4); await picture(`${label}-quieting`, `${label}, going quiet`);
      await at(111); await picture(`${label}-quiet`, `${label}, quiet: furled and greyed`);
      results[`${viewport.name}-${label}-quiet`] = (await measure()).flags.find(f => f.faded);
      await at(120); await page.evaluate(() => demo.release()); await settle(page, 2);
      await at(120.4); await picture(`${label}-leaving`, `${label}, released: lifting away`);
      await at(121); await picture(`${label}-gone`, `${label}, gone`);
    }
    // The island with no code: its claimed shares are lots, the flag standing in each.
    await at(undefined);
    await face(await page.evaluate(() => demo.bare), viewport.name === 'phone' ? 200 : 480);
    await at(200); results[`${viewport.name}-lots`] = await measure();
    await picture('lots', 'an island with no code: two claimed shares are lots');
    results[`${viewport.name}-errors`] = errors;
    await page.close();
  }
  writeFileSync(path.join(out, 'measurements.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify({ pictures: results.pictures.length, errors: [results['desktop-errors'], results['phone-errors']] }));
});
