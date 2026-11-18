import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPage } from './build.mjs';
import { buildFolder, settle, withCapture } from '../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = buildFolder(here, 'turning');
try {
  await buildPage(dist);
  await withCapture({ folder: here, dist }, async ({ browser, origin }) => {
    const page = await browser.newPage({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(origin);
    await page.evaluate(() => window.proof.openTurning());
    await page.waitForFunction(() => window.proof.turnable(), null, { timeout: 30_000 });
    await settle(page, 2);
    await page.evaluate(() => window.proof.turnBetweenRenderAndCommit());
    await settle(page, 4);
    const centre = await page.evaluate(() => window.proof.centre());
    await page.evaluate(() => window.proof.close());
    assert.deepEqual(errors, []);
    assert.deepEqual(centre, [0, 2, 0], 'the group stands where the host turned it last, not where its render read it');
    console.log(JSON.stringify({ centre }));
    await page.close();
  });
} finally {
  rmSync(dist, { recursive: true, force: true });
}
