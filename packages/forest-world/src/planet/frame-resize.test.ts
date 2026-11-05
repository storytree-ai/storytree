import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

/** The planet canvas alone, beside a 280-pixel sidebar, on a sheet with one island; the capture seam hands over its state. */
async function canvasBundle(): Promise<string> {
  const entry = `import { createElement } from 'react';
    import { createRoot } from 'react-dom/client';
    import { PlanetWorldCanvas, SHEET_RADIUS, sheetSpot } from ${JSON.stringify(path.join(import.meta.dirname, 'PlanetWorldCanvas.tsx'))};
    const island = { story: 'a', title: 'a', x: 0, z: 0, key: 'a', trees: [{ capability: 'a1', form: 'green', status: 'healthy', contracts: 1, x: 0, z: 0, scale: 1, turn: 0 }] };
    globalThis.__storytreeCaptureGlobe = get => { globalThis.__globe = get; };
    createRoot(document.querySelector('#globe')).render(createElement(PlanetWorldCanvas, { scene: { islands: [island], links: [] },
      spots: new Map([['a', sheetSpot({ x: 60, y: 0 })]]), radius: SHEET_RADIUS, sheet: { width: 260, height: 160 }, sideOffset: -40 }));`;
  const result = await build({
    stdin: { contents: entry, resolveDir: import.meta.dirname, loader: 'js' }, bundle: true, write: false, format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  return result.outputFiles[0]!.text;
}

type Step = { canvas: number; frame: number; drawn: number; before: number; after: number };

test('4.43 · the sidebar beside the map hidden or shown, the canvas is at its frame\'s new size and drawn, the island kept from the right edge, before the frame is painted', { timeout: 120_000 }, async t => {
  // Chrome is installed on the three CI runner images; no browser download during tests.
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1200, height: 700 }, deviceScaleFactor: 1 });
  await page.setContent(`<div style="position:fixed;inset:0;display:flex"><div id="rail" style="width:280px;flex:none"></div>
    <div id="globe" style="flex:1;min-width:0;position:relative"></div></div>`);
  await page.addScriptTag({ content: await canvasBundle() });
  await page.waitForFunction(() => {
    const state = (window as unknown as { __globe?: () => { gl: { info: { render: { frame: number } } }; scene: { getObjectByName(name: string): unknown } } }).__globe?.();
    return state !== undefined && state.scene.getObjectByName('planet:a') !== undefined && state.gl.info.render.frame > 0;
  }, undefined, { timeout: 60_000 });

  // The rail is hidden or shown, and the page's own watch on the map's frame, made after the canvas's, reads the canvas in the
  // same resize step, between laying the page out and painting it: what it reads is what that frame paints. As a script, since
  // a named function in an evaluated one would need the bundler's helper.
  await page.addScriptTag({ content: `window.__toggle = shown => {
    const state = window.__globe(), canvas = state.gl.domElement, frame = document.querySelector('#globe');
    const fromRight = () => {
      const at = state.scene.getObjectByName('planet:a').getWorldPosition(state.camera.position.clone()).project(state.camera);
      const box = canvas.getBoundingClientRect();
      return frame.getBoundingClientRect().right - (box.left + (at.x + 1) / 2 * box.width);
    };
    let drawn = 0;
    const render = state.gl.render;
    state.gl.render = (scene, camera) => { render.call(state.gl, scene, camera); drawn++; };
    const before = fromRight();
    return new Promise(done => {
      const watch = new ResizeObserver(() => {
        watch.disconnect();
        state.gl.render = render;
        done({ canvas: canvas.getBoundingClientRect().width, frame: frame.getBoundingClientRect().width, drawn, before, after: fromRight() });
      });
      watch.observe(frame);
      document.querySelector('#rail').style.display = shown ? '' : 'none';
    });
  };` });
  const toggle = (shown: boolean) => page.evaluate(shown => (window as unknown as { __toggle(shown: boolean): Promise<Step> }).__toggle(shown), shown);

  for (const [shown, width] of [[false, 1200], [true, 920]] as const) {
    const step = await toggle(shown);
    assert.equal(step.frame, width, 'the map\'s frame took its new width');
    assert.equal(step.canvas, width, `the canvas is at its frame's new width on the frame the rail is ${shown ? 'shown' : 'hidden'}`);
    assert.ok(step.drawn > 0, 'and drawn at it before that frame is painted');
    assert.ok(Math.abs(step.after - step.before) < 0.5, `the island stays ${step.before} pixels from the right edge, not ${step.after}`);
  }
});
