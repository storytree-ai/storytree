// The drawing engine 4.35: a sheet opened again with its lanes already routed shows its lanes notice, laid over it in the DOM, and
// React reports no root unmounted while it rendered. Run: node --import tsx packages/forest-world/testing/sheet-overlays/reopen.mjs --smoke
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPage } from './build.mjs';
import { buildFolder, settle, withCapture } from '../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = buildFolder(here, 'reopen');
try {
  await buildPage(dist);
  await withCapture({ folder: here, dist }, async ({ browser, origin }) => {
    const page = await browser.newPage({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(origin);
    // The first opening routes the lane, and the page keeps that routing; opened again, the kept lane and the notice are
    // drawn with the canvas's first mount. Each opening is given time to draw its notice.
    const shown = () => page.waitForFunction(() => window.proof.notices().length === 1, null, { timeout: 30_000 }).catch(() => {});
    await page.evaluate(() => window.proof.open());
    await shown();
    await page.evaluate(() => window.proof.close());
    await page.evaluate(() => window.proof.open());
    await shown();
    await settle(page, 2);
    const notices = await page.evaluate(() => window.proof.notices());
    assert.deepEqual(errors, [], 'no page errors, and no root unmounted mid-render');
    assert.deepEqual(notices, ['Some lanes could not be drawn. Island health and selection are still available.'], 'the reopened sheet shows its lanes notice');
    await page.evaluate(() => window.proof.close());
    console.log(JSON.stringify({ notices, errors: errors.length }));
    await page.close();
  });
} finally {
  rmSync(dist, { recursive: true, force: true });
}
