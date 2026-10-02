// Captures the capability tree's own space in the real `pnpm desktop:smoke` Electron window,
// driven over CDP (the top-bars lane's route). No pixel editing. Run under the heavy lock with a
// throwaway restored STORYTREE_HOME and a temporary X display:
//   DISPLAY=:137 STORYTREE_EMBEDDER=off CAPTREE_SHOTS=panel,tree,panned flock /tmp/storytree-heavy.lock node --import tsx packages/forest/evidence/captree/electron-capture.mjs
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
const shots = (process.env.CAPTREE_SHOTS ?? 'panel,tree,panned').split(',');
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
      const cards = [...document.querySelectorAll('.tree-space-diagram .box, .panel-diagram .box')];
      const card = document.querySelector('.tree-space:not([hidden]) .tree-space-diagram .card-bg')?.getBoundingClientRect();
      return {
        selectedStory: document.body.dataset.selected,
        selectedCapability: document.querySelector('.panel-detail')?.dataset.capabilityId,
        treeOpen: space !== null && !space.hidden,
        view: space?.querySelector('.tree-space-surface')?.dataset.view,
        cardOnScreen: card === undefined ? null : { width: Math.round(card.width), height: Math.round(card.height) },
        statuses: [...new Set(cards.map((node) => node.querySelector('.card-status')?.textContent))],
        cards: document.querySelectorAll('.tree-space:not([hidden]) .tree-space-diagram .box').length,
      };
    });
    results.push({ shot, capture: 'CDP screenshot of the pnpm desktop:smoke Electron window', viewport, ...state });
    console.log(`${shot}: ${JSON.stringify(state)}`);
  };

  if (shots.includes('panel')) await shoot('panel');
  await page.click('[data-open-tree]');
  await page.waitForSelector('.tree-space:not([hidden])');
  // Click one of the story's own cards in the space: it becomes the panel's capability.
  const pick = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.tree-space-diagram [data-capability-id]')];
    const frame = document.querySelector('.tree-space-frame').getBoundingClientRect();
    const inside = cards.map((card) => ({ id: card.dataset.capabilityId, box: card.querySelector('.card-bg').getBoundingClientRect() }))
      .filter(({ box }) => box.left > frame.left && box.right < frame.right && box.top > frame.top && box.bottom < frame.bottom);
    const chosen = inside.find(({ id }) => !document.querySelector(`.tree-space-diagram [data-capability-id="${id}"]`).classList.contains('selected')) ?? inside[0];
    return chosen && { id: chosen.id, x: chosen.box.left + chosen.box.width / 2, y: chosen.box.top + chosen.box.height / 2 };
  });
  if (pick) {
    await page.mouse.click(pick.x, pick.y);
    await page.waitForFunction((id) => document.querySelector('.panel-detail')?.dataset.capabilityId === id, pick.id);
  }
  await page.mouse.move(4, 4);
  if (shots.includes('tree')) await shoot('tree');
  if (shots.includes('mixed')) await shoot('mixed');
  if (shots.includes('panned')) {
    const box = await page.evaluate(() => { const { x, y, width, height } = document.querySelector('.tree-space-frame').getBoundingClientRect(); return { x, y, width, height }; });
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.6, { steps: 12 });
    await page.mouse.up();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 200); // zoom out a step
    await page.waitForTimeout(200);
    await page.mouse.move(4, 4);
    await shoot('panned');
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
