// Captures the capability cards' words and the fitted opening view (ADR-0744) in the real
// `pnpm desktop:smoke` Electron window, driven over CDP: #210's capture
// (../captree-inpanel/electron-capture.mjs) with the shots changed. No pixel editing. Run under the
// heavy lock with a restored CAPTURE_STORYTREE_HOME and a temporary X display (see README):
//   DISPLAY=:137 STORYTREE_EMBEDDER=off node packages/dev-loop/src/heavy-lock.mjs -- env STORYTREE_HOME="$CAPTURE_STORYTREE_HOME" node --import tsx packages/forest/evidence/cardwords/electron-capture.mjs
// CARDWORDS_SHOTS=words takes the four-words shots, on a home seeded with ./seed-words.mjs.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { captureOutput, loadPlaywright, settle } from '../../../../apps/desktop/src/capture/index.ts'; // run with node --import tsx
const { chromium } = await loadPlaywright();
const here = path.dirname(fileURLToPath(import.meta.url));
const output = captureOutput(here);
const root = path.resolve(here, '../../../..');
assert.ok(process.env.STORYTREE_HOME, 'a throwaway restored STORYTREE_HOME is required');
assert.ok(process.env.DISPLAY, 'a temporary X display is required');
const STORY = process.env.CAPTREE_STORY ?? 'story_f9fb5136c28f'; // The command line
const shots = process.env.CARDWORDS_SHOTS === 'words' ? ['words', 'words-close'] : ['panel', 'window'];
const record = path.join(output, 'electron-capture.json');

// Hold the smoke's 800 ms capture delay open until the captures are done, then let it finish.
async function inspector(endpoint) {
  const socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const evaluate = (expression) => new Promise((resolve, reject) => {
    const mine = ++id;
    socket.addEventListener('message', function listen({ data }) {
      const message = JSON.parse(data);
      if (message.id !== mine) return;
      socket.removeEventListener('message', listen);
      if (message.error || message.result?.exceptionDetails) reject(new Error(JSON.stringify(message)));
      else resolve(message.result);
    });
    socket.send(JSON.stringify({ id: mine, method: 'Runtime.evaluate', params: { expression } }));
  });
  await evaluate(`(() => {
    const original = globalThis.setTimeout;
    globalThis.setTimeout = function(callback, delay, ...args) {
      if (delay !== 800) return original(callback, delay, ...args);
      globalThis.setTimeout = original;
      console.log("captree: capture window visible");
      let done = false;
      const go = () => { if (!done) { done = true; callback(...args); } };
      globalThis.captreeRelease = go;
      return original(go, 240000);
    };
  })()`);
  return { release: () => evaluate('globalThis.captreeRelease?.()'), close: () => socket.close() };
}

let log = '';
let browser;
const child = spawn('pnpm', ['desktop:smoke', '--project', 'storytree', '--remote-debugging-port=0', '--inspect=0', '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--screenshot', '/tmp/cardwords-smoke-end.png'], { cwd: root, env: process.env });
const exited = once(child, 'exit');
const results = existsSync(record) ? JSON.parse(readFileSync(record, 'utf8')).filter((result) => !shots.includes(result.shot)) : [];
try {
  let windowVisible;
  const visible = new Promise((resolve) => { windowVisible = resolve; });
  const endpoints = await new Promise((resolve, reject) => {
    const read = (chunk) => {
      log += String(chunk);
      if (log.includes('captree: capture window visible')) windowVisible();
      const match = log.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      const node = log.match(/Debugger listening on (ws:\/\/[^\s]+)/);
      if (match && node) resolve({ browser: match[1], inspector: node[1] });
    };
    child.stdout.on('data', read); child.stderr.on('data', read);
    exited.then(([code]) => reject(new Error(`smoke exited ${code} before CDP: ${log}`)));
  });
  const main = await inspector(endpoints.inspector);
  browser = await chromium.connectOverCDP(endpoints.browser);
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? await context.waitForEvent('page');
  const cdp = await context.newCDPSession(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await Promise.race([visible, exited.then(() => { throw new Error('smoke exited before its capture window'); })]);
  // The smoke has swept the arc scopes and sized its window; tidy the first-run help and the drawer away.
  await page.evaluate(() => {
    if (document.querySelector('#app-menu')?.matches(':popover-open')) document.querySelector('[data-app-close]')?.click();
    document.querySelector('[data-close-arcs]')?.click();
    document.activeElement?.blur();
  });
  const frame = () => settle(page, 2);
  await frame();

  // Select the story by clicking its island where its name floats, turning the globe until it faces us.
  for (let attempt = 0; attempt < 16; attempt++) {
    const label = await page.evaluate((story) => {
      const node = document.querySelector(`.forest-label[data-story-id="${story}"]`);
      if (node === null) return null;
      const { x, y, width, height } = node.getBoundingClientRect();
      return { x: x + width / 2, y: y + height + 14, visible: width > 0 && Number(node.style.opacity || 1) > 0.5 };
    }, STORY);
    if (label?.visible) {
      await page.mouse.click(label.x, label.y);
      await frame();
      if (await page.evaluate(() => document.body.dataset.selected) === STORY) break;
      await page.mouse.click(label.x, label.y - 20);
      await frame();
      if (await page.evaluate(() => document.body.dataset.selected) === STORY) break;
    }
    const box = await page.evaluate(() => { const { x, y, width, height } = document.querySelector('.forest').getBoundingClientRect(); return { x, y, width, height }; });
    const cx = box.x + box.width * 0.4, cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 140, cy, { steps: 8 }); await page.mouse.up();
    await page.waitForTimeout(600);
  }
  assert.equal(await page.evaluate(() => document.body.dataset.selected), STORY, 'the story is selected');
  await page.mouse.move(4, 4);
  await page.waitForTimeout(500);

  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  const shoot = async (shot) => {
    await frame();
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false, clip: { x: 0, y: 0, ...viewport, scale: 1 } });
    writeFileSync(path.join(output, `${shot}.png`), Buffer.from(data, 'base64'));
    const state = await page.evaluate(() => {
      const space = document.querySelector('.tree-space');
      const fitOf = (frameNode, surfaceSelector) => {
        if (frameNode === null) return null;
        const svg = frameNode.querySelector(`${surfaceSelector} svg`);
        const view = JSON.parse(frameNode.querySelector(surfaceSelector)?.dataset.view ?? 'null');
        const tree = { width: Number(svg?.getAttribute('width')), height: Number(svg?.getAttribute('height')) };
        const shown = view === null ? null : { width: Math.round(tree.width * view.scale), height: Math.round(tree.height * view.scale) };
        return { frame: { width: frameNode.clientWidth, height: frameNode.clientHeight }, tree, view, shown, wholeTreeInFrame: shown !== null && shown.width <= frameNode.clientWidth && shown.height <= frameNode.clientHeight };
      };
      const words = (selector) => [...document.querySelectorAll(`${selector} .card-status`)].reduce((count, node) => ({ ...count, [node.textContent]: (count[node.textContent] ?? 0) + 1 }), {});
      return {
        selectedStory: document.body.dataset.selected,
        selectedCapability: document.querySelector('.panel-detail')?.dataset.capabilityId,
        detailWord: document.querySelector('.panel-detail .panel-state')?.textContent,
        panel: fitOf(document.querySelector('.panel-tree-frame'), '.panel-tree-surface'),
        panelWords: words('.panel-diagram'),
        treeOpen: space !== null && !space.hidden,
        window: space?.hidden === false ? fitOf(space.querySelector('.tree-space-frame'), '.tree-space-surface') : null,
        legend: [...(space?.querySelectorAll('.tree-space-legend span') ?? [])].map((node) => node.textContent),
        fitButton: space?.querySelector('.tree-space-fit')?.textContent,
      };
    });
    results.push({ shot, capture: 'CDP screenshot of the pnpm desktop:smoke Electron window', viewport, ...state });
    console.log(`${shot}: ${JSON.stringify(state)}`);
    return state;
  };
  const noWorkState = (state) => assert.ok(!['planned', 'in progress', 'landed', 'not landed yet'].some((word) => word in state.panelWords), 'no work state on a card');

  await page.waitForSelector('.panel-tree-frame');
  if (shots[0] === 'panel') {
    // (a) The panel's own space opens fitted: as small as fits, clamped to the least zoom, centred.
    const opened = await shoot('panel');
    noWorkState(opened);
    assert.ok(opened.panel.view.scale < 1, 'the panel opened zoomed out');
    // (b) The pop-out icon: the larger window opens fitted too.
    await page.click('[data-open-tree]');
    await page.waitForSelector('.tree-space:not([hidden])');
    await page.mouse.move(4, 4);
    const window = await shoot('window');
    assert.deepEqual(window.legend, ['proposed', 'healthy', 'unhealthy', 'untested']);
    assert.equal(window.fitButton, 'Fit');
  } else {
    // (c) On the seeded copy: all four words, in the larger window fitted, then zoomed in on them.
    await page.click('[data-open-tree]');
    await page.waitForSelector('.tree-space:not([hidden])');
    await page.mouse.move(4, 4);
    const fitted = await shoot('words');
    noWorkState(fitted);
    for (const word of ['proposed', 'healthy', 'unhealthy', 'untested']) assert.ok(fitted.panelWords[word] > 0, `a card says ${word}`);
    const target = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.tree-space-diagram [data-capability-id]')].filter((card) => !card.classList.contains('status-proposed'));
      const boxes = cards.map((card) => card.getBoundingClientRect());
      return { x: boxes.reduce((sum, box) => sum + box.left + box.width / 2, 0) / boxes.length, y: boxes.reduce((sum, box) => sum + box.top + box.height / 2, 0) / boxes.length };
    });
    for (let step = 0; step < 2; step++) { await page.mouse.move(target.x, target.y); await page.mouse.wheel(0, -200); await frame(); }
    await page.mouse.move(4, 4);
    await shoot('words-close');
    // Fit puts the whole-tree view back.
    await page.click('.tree-space-fit');
    await frame();
    assert.deepEqual(JSON.parse(await page.evaluate(() => document.querySelector('.tree-space-surface').dataset.view)), fitted.window.view, 'Fit returns to the opening view');
  }
  await main.release();
  main.close();
  const [code] = await exited;
  assert.equal(code, 0, log);
} finally {
  writeFileSync(path.join(output, `smoke-${shots.join('-')}.txt`), log.replaceAll(root, '<worktree>'));
  writeFileSync(record, JSON.stringify(results, null, 2) + '\n');
  if (child.exitCode === null) child.kill('SIGTERM');
  await browser?.close().catch(() => {});
}
