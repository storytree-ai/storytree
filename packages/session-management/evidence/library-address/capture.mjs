// Settings 10.13 (ADR-0846 D1): the Library tab's third location, a Postgres address, captured
// through the real panel code (mountSettings, bundled for the browser) and the real settings
// writers on a throwaway storytree home. No library, no Postgres: the panel reads and writes
// settings.json only. Run: node --import tsx packages/session-management/evidence/library-address/capture.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { settingsActions } from '@storytree/session-management/settings';
import { buildSettingsPanel } from './build.mjs';

const { chromium } = await import(process.env.STORYTREE_PLAYWRIGHT ?? '/home/mickh/code/Storytree/node_modules/.pnpm/playwright-core@1.60.0/node_modules/playwright-core/index.mjs');
const output = path.dirname(fileURLToPath(import.meta.url));
const home = mkdtempSync(path.join(tmpdir(), 'storytree-library-address-'));
const settings = settingsActions(home);
const bundled = await buildSettingsPanel();
const browser = await chromium.launch({ executablePath: process.env.STORYTREE_CHROMIUM ?? '/home/mickh/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 560 }, colorScheme: 'dark', deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', (error) => errors.push(String(error)));
  await page.exposeFunction('settingsCall', (method, args) => settings[method](...args));
  await page.setContent(`<!doctype html><html><head><style>body { margin: 0; padding: 24px; background: #15181d; color: #e6e9ee; font: 14px system-ui, sans-serif; }</style></head><body><div id="host"></div><button id="gear" hidden>gear</button></body></html>`);
  await page.addScriptTag({ content: bundled });
  await page.evaluate(() => {
    const bridge = { readSettings: () => window.settingsCall('readSettings', []), saveSetting: (...args) => window.settingsCall('saveSetting', args) };
    window.mountSettings(document.getElementById('host'), bridge, { returnFocus: document.getElementById('gear'), embedded: true, group: 'library' }).open();
  });
  const select = page.locator('form[data-setting="library"] select[name="value"]');
  await select.waitFor();
  await select.selectOption('postgres');
  await page.fill('input[name="address"]', 'postgres://me:hunter2@db.example.com:5432/postgres');
  await page.click('form[data-setting="library"] button[type="submit"]');
  await page.locator('.settings-error').filter({ hasText: 'auth set postgres' }).waitFor();
  await page.screenshot({ path: path.join(output, 'address-refused.png') });
  await page.fill('input[name="address"]', 'postgres://me@db.example.com:5432/postgres?sslmode=require');
  await page.click('form[data-setting="library"] button[type="submit"]');
  await page.locator('.settings-saved').filter({ hasText: 'Saved' }).waitFor();
  await page.screenshot({ path: path.join(output, 'address-saved.png') });
  const saved = await settings.readSettings();
  assert.equal(saved.ok && saved.value.library.location, 'postgres');
  assert.deepEqual(errors, []);
  console.log('captured address-refused.png and address-saved.png; saved', JSON.stringify(saved.ok && saved.value.library));
} finally {
  await browser.close();
  rmSync(home, { recursive: true, force: true });
}
