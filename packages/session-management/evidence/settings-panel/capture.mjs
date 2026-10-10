// Settings contracts: real desktop renderer and settings writers with an isolated snapshot/home.
// Reuses packages/app/evidence/project-switch-smoke.mjs's headless renderer route.
// Run after build, under flock /tmp/storytree-heavy.lock. Never opens the live library.
import assert from 'node:assert/strict';
import { settingsActions } from '@storytree/session-management/settings';
import { readSettings, setSetting } from '@storytree/session-management';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { connect } from '@storytree/library';
import { start } from '@storytree/local-postgres';

const desktopRequire = createRequire(new URL('../../../../apps/desktop/package.json', import.meta.url));
const { pageReads, projectSelection, smokeProblems } = await import(desktopRequire.resolve('@storytree/app'));

const { chromium } = await import(process.env.STORYTREE_PLAYWRIGHT ?? '/home/mickh/code/Storytree/node_modules/.pnpm/playwright-core@1.60.0/node_modules/playwright-core/index.mjs');
const output = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(output, '../../../../apps/desktop/dist/renderer');
const temporary = mkdtempSync(path.join(tmpdir(), 'storytree-settings-capture-'));
let pg, store, reads, server, browser;
try {
  pg = await start({ dataDir: path.join(temporary, 'pgdata'), owner: 'settings capture' });
  store = await connect({ url: pg.url });
  const snapshotPath = process.env.SETTINGS_SNAPSHOT ?? '/home/mickh/storytree-lanes/snapshots/2026-09-28T07-26-00-491Z.json';
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  await store.restore('storytree', snapshot);
  console.log('Restored real snapshot');
  reads = pageReads({ storytree: store });
  const selection = projectSelection({ file: path.join(temporary, 'choice.json'), listProjects: () => store.listProjects() });
  await selection.choose('storytree');
  let failRead = false, failSave = false;
  let deferSave = false, releaseSave;
  const settings = settingsActions(temporary);
  const bridge = { ...reads, ...settings,
    readSettings: () => failRead ? { ok: false, error: 'Temporary settings read failure' } : settings.readSettings(),
    saveSetting: async (...args) => {
      if (failSave) { failSave = false; throw new Error('Temporary settings transport failure'); }
      if (deferSave) { deferSave = false; await new Promise(resolve => { releaseSave = resolve; }); }
      return settings.saveSetting(...args);
    }, projectSelection: () => selection.read(), chooseProject: async name => {
    return selection.choose(name);
  } };
  server = createServer((req, res) => {
    const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
    if (!['index.html', 'renderer.js', 'styles.css', 'app-setup.css', 'arc-surface.css', 'forest.css'].includes(name)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(readFileSync(path.join(dist, name)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ executablePath: process.env.STORYTREE_CHROMIUM ?? '/home/mickh/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell', headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, colorScheme: 'dark', deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', error => errors.push(String(error)));
  await page.exposeFunction('gearRead', (method, args) => { assert.ok(Object.hasOwn(bridge, method)); return bridge[method](...args); });
  await page.addInitScript(methods => {
    window.storytree = Object.fromEntries(methods.map(method => [method, (...args) => window.gearRead(method, args)]));
    try { localStorage.setItem('storytree:setup:guide-seen:v1', 'yes'); } catch { /* about:blank has no storage */ }
  }, Object.keys(bridge));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => document.body.dataset.state === 'ready', undefined, { timeout: 120000 });
  console.log('Forest ready');
  const gear = page.getByRole('button', { name: 'App menu', exact: true });
  const menu = page.locator('#app-menu');
  const panel = page.getByRole('dialog', { name: 'Settings', exact: true });
  const row = page.locator('[data-setting="context-guidance"]');
  const input = row.getByRole('textbox', { name: 'Context guidance', exact: true });
  const save = row.getByRole('button', { name: 'Save', exact: true });
  const source = row.locator('.settings-source');
  const error = row.getByRole('alert');
  const tree = await reads.projectTree('storytree');
  await gear.click();
  const entry = menu.getByRole('button', { name: 'Settings', exact: true });
  assert.equal(await entry.isEnabled(), true);
  await entry.click();
  await input.waitFor();
  assert.equal(await menu.isVisible(), false);
  assert.equal(await input.inputValue(), '700000');
  assert.equal(await source.textContent(), 'default');
  assert.equal(await panel.locator('form').count(), Object.keys(readSettings(temporary)).length);
  assert.equal(await save.isEnabled(), false);
  const panelBox = await panel.boundingBox();
  assert.ok(panelBox.width <= 760 && panelBox.x >= 0 && panelBox.x + panelBox.width <= 1440);
  const inputBox = await input.boundingBox();
  const labelBox = await row.locator('.settings-description').boundingBox();
  assert.ok(inputBox.x > labelBox.x + labelBox.width, 'value sits to the right of the meaning');
  assert.equal(await input.evaluate(node => getComputedStyle(node).textAlign), 'right');
  // Native dialog contains keyboard focus and Escape returns it to the gear.
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => document.querySelector('#settings-panel').contains(document.activeElement)), true);
  console.log('Panel geometry and focus passed');
  await input.fill('420000');
  await input.press('Enter');
  await page.waitForFunction(() => document.querySelector('[data-setting="context-guidance"] .settings-source').textContent === 'set by you');
  assert.equal(readSettings(temporary)['context-guidance'].value, 420000);
  const before = readFileSync(path.join(temporary, 'settings.json'), 'utf8');
  await input.fill('0'); await save.click();
  await error.filter({ hasText: 'positive whole number' }).waitFor();
  let reason;
  try { setSetting('context-guidance', '0', temporary); } catch (error) { reason = error.message; }
  assert.equal(await error.textContent(), reason);
  assert.equal(await input.getAttribute('aria-invalid'), 'true');
  assert.equal(readFileSync(path.join(temporary, 'settings.json'), 'utf8'), before);
  assert.equal(await source.textContent(), 'set by you');
  await input.fill('430000'); failSave = true; await save.click();
  await error.filter({ hasText: 'Temporary settings transport failure' }).waitFor();
  assert.equal(await save.isEnabled(), true, 'transport failure can be retried');
  await save.click();
  await row.getByRole('status').filter({ hasText: 'Saved' }).waitFor();
  assert.equal(readSettings(temporary)['context-guidance'].value, 430000);
  await page.keyboard.press('Escape');
  assert.equal(await panel.isVisible(), false);
  assert.equal(await gear.evaluate(node => node === document.activeElement), true);
  await gear.click(); await entry.click(); await input.waitFor();
  assert.equal(await input.inputValue(), '430000', 'reopening reads persisted settings');
  // The second current setting is editable through its own writer, with the same refusal.
  const library = page.locator('[data-setting="library"]');
  await library.getByLabel('Library', { exact: true }).selectOption('cloudsql');
  await library.getByLabel('Instance connection name').fill('broken');
  await library.getByLabel('Google account email').fill('you@example.com');
  await library.getByRole('button', { name: 'Save', exact: true }).click();
  await library.getByRole('alert').filter({ hasText: 'not written project:region:instance' }).waitFor();
  await library.getByLabel('Instance connection name').fill('my-project:australia-southeast1:my-instance');
  await library.getByRole('button', { name: 'Save', exact: true }).click();
  await library.getByRole('status').filter({ hasText: 'Saved' }).waitFor();
  assert.equal(readSettings(temporary).library.location, 'cloudsql');
  await library.getByLabel('Library', { exact: true }).selectOption('local');
  await library.getByRole('button', { name: 'Save', exact: true }).click();
  await library.getByRole('status').filter({ hasText: 'Saved' }).waitFor();
  assert.equal(readSettings(temporary).library.location, 'local');
  // A slow save cannot take focus back from another setting the user has moved to.
  deferSave = true;
  await input.fill('440000'); await save.click();
  await row.getByRole('status').filter({ hasText: 'Saving…' }).waitFor();
  const libraryChoice = library.getByLabel('Library', { exact: true });
  await libraryChoice.focus();
  releaseSave();
  await row.getByRole('status').filter({ hasText: 'Saved' }).waitFor();
  assert.equal(await libraryChoice.evaluate(node => node === document.activeElement), true);
  // Read failure exposes no fabricated defaults, and retry reuses the actual reader.
  await page.getByRole('button', { name: 'Close settings' }).click();
  failRead = true;
  await gear.click(); await entry.click();
  await panel.getByRole('alert').filter({ hasText: 'Temporary settings read failure' }).waitFor();
  assert.equal(await panel.locator('form').count(), 0);
  failRead = false;
  await panel.getByRole('button', { name: 'Retry', exact: true }).click(); await input.waitFor();
  await page.setViewportSize({ width: 360, height: 640 });
  const narrowBox = await panel.boundingBox();
  assert.ok(narrowBox.x >= 0 && narrowBox.x + narrowBox.width <= 360 && narrowBox.height <= 592);
  assert.equal(await panel.evaluate(node => node.scrollWidth <= node.clientWidth), true, 'no horizontal scrolling');
  await page.getByRole('button', { name: 'Close settings' }).click();
  assert.deepEqual(smokeProblems('ready', tree, await page.getAttribute('body', 'data-drew')), []);
  assert.deepEqual(errors, []);
  const result = { snapshot: snapshotPath, records: snapshot.records.length, panelBox, inputBox, narrowBox, errors,
    passed: ['Settings enabled', 'all reader settings', 'default value/source/meaning', 'values on the right', 'keyboard save', 'source changes on save', 'CLI refusal text and unchanged bytes', 'transport retry', 'reopen persisted value', 'Cloud SQL fields, refusal and save', 'slow save preserves subsequent focus', 'read retry without fabricated defaults', 'native dialog focus and Escape return', 'narrow viewport', 'forest smoke census'] };
  writeFileSync(path.join(output, 'capture.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await reads?.close(); await store?.close(); await pg?.stop();
  rmSync(temporary, { recursive: true, force: true });
}
