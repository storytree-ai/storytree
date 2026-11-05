// The drawing engine 4.43, on the real desktop page: the eight-story forest map as the app opens it, the sidebar hidden and
// shown again with Ctrl+B while Chrome's screencast keeps every frame it paints, the map's own motion reduced so nothing else
// moves but small things. Each toggle should change what is painted across the map once, on the frame it is painted on;
// every further such change is a frame the map flickered through (drawn at the old size, then put right). `node --import tsx capture.mjs <label>`
// writes the frames and `frames.json` under a temporary folder (append --retake to write into src/planet/evidence/sidebar-toggle).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, buildFolder, captureOutput, captureSeed, runCapture } from '../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const pictures = path.join(here, '../../src/planet/evidence', 'sidebar-toggle');
const label = process.argv.slice(2).find(arg => !arg.startsWith('--')) ?? 'frames';
const { seed } = captureSeed('forest');
const dist = buildFolder(here, label);
await buildCapture({ dist });
const until = (page, predicate) => page.waitForFunction(predicate, undefined, { timeout: 180_000, polling: 200 });

const results = {};
await runCapture({
  folder: pictures, dist, seed, viewport: { width: 1440, height: 900 },
  prepare: async ({ page, settle }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await until(page, () => document.body.dataset.state === 'ready');
    for (const button of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name: button, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
    await until(page, () => { let n = 0, laid = 0; window.__globe.scene.traverse(o => { if (o.name.startsWith('planet:') && o.name !== 'planet:shell') { n++; if (o.getObjectByName('territory-land')) laid++; } }); return n > 0 && laid === n; });
    await settle(page, 30);
  },
  views: [{
    name: 'toggle', picture: false, measurement: 'frames.json',
    measure: async ({ page, browser }) => {
      const out = path.join(captureOutput(pictures), label);
      rmSync(out, { recursive: true, force: true });
      mkdirSync(out, { recursive: true });
      const cdp = await page.context().newCDPSession(page);
      const frames = [];
      cdp.on('Page.screencastFrame', frame => {
        frames.push(frame.data);
        cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});
      });
      await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
      await page.waitForTimeout(500);
      for (let toggle = 0; toggle < 2; toggle++) {
        await page.keyboard.press('Control+b');
        await page.waitForTimeout(800);
      }
      await cdp.send('Page.stopScreencast');
      for (const [index, frame] of frames.entries()) writeFileSync(path.join(out, `${String(index).padStart(3, '0')}.png`), Buffer.from(frame, 'base64'));
      // How wide a change each frame made from the one before it, in pixels across the page, judged in a page of its own.
      const judge = await (await browser.newContext()).newPage();
      const boxes = await judge.evaluate(async shots => {
        const pixels = async data => {
          const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context = canvas.getContext('2d');
          context.drawImage(bitmap, 0, 0);
          return context.getImageData(0, 0, bitmap.width, bitmap.height);
        };
        const changed = [];
        let last = await pixels(shots[0]);
        for (const shot of shots.slice(1)) {
          const now = await pixels(shot);
          let left = Infinity, right = -1;
          for (let i = 0; i < now.data.length; i += 4) {
            if (Math.abs(now.data[i] - last.data[i]) + Math.abs(now.data[i + 1] - last.data[i + 1]) + Math.abs(now.data[i + 2] - last.data[i + 2]) <= 24) continue;
            const x = (i / 4) % now.width;
            if (x < left) left = x;
            if (x > right) right = x;
          }
          changed.push(right < 0 ? 0 : right - left + 1);
          last = now;
        }
        return changed;
      }, frames);
      await judge.context().close();
      // The map's motion reduced, what still moves (a lit stretch of road, the compass) changes under 300 pixels across; the
      // toggle changes most of the page, and so does each frame flickered through. Two toggles that flicker through no frame
      // are two such changes.
      results.toggles = 2;
      results.changes = boxes.filter(wide => wide > 0);
      results.acrossTheMap = results.changes.filter(wide => wide > page.viewportSize().width / 3).length;
      results.rail = await page.evaluate(() => document.querySelector('[aria-controls="side-rail"]')?.getAttribute('aria-expanded'));
      return results;
    },
  }],
});
console.log(JSON.stringify(results));
