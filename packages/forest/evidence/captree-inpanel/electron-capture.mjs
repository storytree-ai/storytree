// Captures the capability tree's own space INSIDE the story panel, and the larger window its pop-out
// icon opens, in the real `pnpm desktop:smoke` Electron window, driven over CDP. #204's capture
// (../captree/electron-capture.mjs) with the shots changed. No pixel editing. Run under the heavy
// lock with a restored CAPTURE_STORYTREE_HOME and a temporary X display (see README):
//   DISPLAY=:137 STORYTREE_EMBEDDER=off node packages/dev-loop/src/heavy-lock.mjs -- env STORYTREE_HOME="$CAPTURE_STORYTREE_HOME" node --import tsx packages/forest/evidence/captree-inpanel/electron-capture.mjs
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
const shots = ['panel', 'panned', 'popout'];
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
const child = spawn('pnpm', ['desktop:smoke', '--project', 'storytree', '--remote-debugging-port=0', '--inspect=0', '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--screenshot', '/tmp/captree-smoke-end.png'], { cwd: root, env: process.env });
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
      const inPanel = document.querySelector('.panel-tree-frame');
      const card = (selector) => { const box = document.querySelector(selector)?.getBoundingClientRect(); return box === undefined ? null : { width: Math.round(box.width), height: Math.round(box.height) }; };
      const popOut = document.querySelector('[data-open-tree]');
      return {
        selectedStory: document.body.dataset.selected,
        selectedCapability: document.querySelector('.panel-detail')?.dataset.capabilityId,
        panelFrame: inPanel === null ? null : { width: inPanel.clientWidth, height: inPanel.clientHeight, view: inPanel.querySelector('.panel-tree-surface')?.dataset.view },
        panelCardOnScreen: card('.panel-diagram .card-bg'),
        panelSelectedOnScreen: (() => { const box = document.querySelector('.panel-diagram .selected .card-bg')?.getBoundingClientRect(); const f = inPanel?.getBoundingClientRect(); return box && f ? { dx: Math.round(box.left + box.width / 2 - (f.left + f.width / 2)), dy: Math.round(box.top + box.height / 2 - (f.top + f.height / 2)) } : null; })(),
        popOut: popOut === null ? null : { label: popOut.getAttribute('aria-label'), title: popOut.getAttribute('title') },
        textButton: document.body.textContent.includes('Open the capability tree'),
        treeOpen: space !== null && !space.hidden,
        view: space?.querySelector('.tree-space-surface')?.dataset.view,
        windowCardOnScreen: space?.hidden === false ? card('.tree-space-diagram .card-bg') : null,
      };
    });
    results.push({ shot, capture: 'CDP screenshot of the pnpm desktop:smoke Electron window', viewport, ...state });
    console.log(`${shot}: ${JSON.stringify(state)}`);
    return state;
  };

  // (a) The panel's own space, opened on the selected capability at full size.
  await page.waitForSelector('.panel-tree-frame');
  const opened = await shoot('panel');
  assert.ok(opened.panelFrame !== null && opened.popOut?.label === 'Open in a larger window' && !opened.textButton);
  const frameBox = () => page.evaluate(() => { const { x, y, width, height } = document.querySelector('.panel-tree-frame').getBoundingClientRect(); return { x, y, width, height }; });

  // (b) A drag pans it, and is not a click: the capability shown below stays.
  // The story's own cards build on 1 · Front door, so they sit above it: drag down until one is in view.
  const findPick = () => frameBox().then((f) => page.evaluate((f) => {
    const inside = [...document.querySelectorAll('.panel-diagram [data-capability-id]')]
      .map((card) => ({ id: card.dataset.capabilityId, selected: card.classList.contains('selected'), box: card.querySelector('.card-bg').getBoundingClientRect() }))
      .map(({ id, selected, box }) => ({ id, selected, x: box.left + box.width / 2, y: box.top + box.height / 2 }))
      .filter(({ x, y }) => x > f.x + 20 && x < f.x + f.width - 20 && y > f.y + 20 && y < f.y + f.height - 20);
    return inside.find(({ selected }) => !selected);
  }, f));
  const before = await page.evaluate(() => document.querySelector('.panel-detail')?.dataset.capabilityId);
  let pick;
  for (let drag = 0; drag < 6 && pick === undefined; drag++) {
    const box = await frameBox();
    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.15);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.85, { steps: 12 });
    await page.mouse.up();
    await frame();
    assert.equal(await page.evaluate(() => document.querySelector('.panel-detail')?.dataset.capabilityId), before, 'a drag chose nothing');
    pick = await findPick();
  }
  assert.ok(pick, 'another of the story\'s cards is in view after the pan');
  const panned = await page.evaluate(() => document.querySelector('.panel-tree-surface')?.dataset.view);
  await page.mouse.click(pick.x, pick.y);
  await page.waitForFunction((id) => document.querySelector('.panel-detail')?.dataset.capabilityId === id, pick.id);
  assert.equal(await page.evaluate(() => document.querySelector('.panel-tree-surface')?.dataset.view), panned, 'the redraw kept the view');
  await page.mouse.move(4, 4);
  await shoot('panned');

  // (c) The pop-out icon opens the larger window, unchanged.
  await page.click('[data-open-tree]');
  await page.waitForSelector('.tree-space:not([hidden])');
  await page.mouse.move(4, 4);
  await shoot('popout');
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
