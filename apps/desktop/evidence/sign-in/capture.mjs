// The gear's real Updates section and the real sign-in decision (lifecycle 1.12), with a throwaway
// home and a fake of Electron's login item: no app, no library. Pictures of the switch on and off.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const require = createRequire(path.join(root, 'apps/desktop/package.json'));
const { build } = require('esbuild');
const { chromium } = require('playwright-core');
const { signIn } = await import(path.join(root, 'packages/app/src/lifecycle/sign-in.ts'));
const home = mkdtempSync(path.join(tmpdir(), 'sign-in-capture-'));
let browser;
try {
  const bundle = await build({ stdin: { contents: `import { mountAppMenu } from './packages/app/src/view/index.ts';
    mountAppMenu(document.querySelector('#gear'), {background:document.querySelector('main'),chooseProject:async()=>{},onChosen:()=>{},onError:console.error,onSurfacesChanged:()=>{},
    mountHelp:()=>({open(){},close(){},stop(){}}),checkForUpdates:async()=>({phase:'up-to-date',runningBuild:'v0.3.402'}),
    signIn:{read:()=>window.readSignIn(),set:on=>window.setSignIn(on)}});`, resolveDir: root }, bundle: true, platform: 'browser', format: 'iife', write: false });
  browser = await chromium.launch({ executablePath: process.env.STORYTREE_CHROMIUM ?? path.join(process.env.HOME, '.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell'), headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, colorScheme: 'dark' });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  const calls = [];
  const signingIn = signIn({ installed: true, file: path.join(home, 'sign-in.json'), loginItems: { set: item => calls.push(item) } });
  signingIn.apply();
  await page.exposeFunction('readSignIn', () => signingIn.read());
  await page.exposeFunction('setSignIn', on => signingIn.set(on));
  await page.exposeFunction('readSettings', async () => ({ ok: false, error: 'not under test' }));
  await page.exposeFunction('readSurfaces', async () => ({ ok: true, value: [] }));
  await page.setContent('<style>body{margin:0;background:#101418;color:#eceae3;font:14px system-ui}main{padding:100px 32px;color:#a9b0ba}</style><div id="gear"></div><main>Updates section preview</main>');
  await page.evaluate(() => { window.storytree = { readSettings: window.readSettings, saveSetting: window.readSettings, readSurfaces: window.readSurfaces, saveSurface: window.readSurfaces }; });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.getByRole('button', { name: 'App menu', exact: true }).click();
  await page.getByRole('button', { name: 'Updates', exact: true }).click();
  const box = page.getByRole('checkbox', { name: /Open at sign-in/ });
  await box.waitFor();
  assert.equal(await box.isChecked(), true, 'on by default');
  await page.screenshot({ path: path.join(here, 'updates-sign-in-on.png') });
  await box.click();
  await page.waitForFunction(() => !document.querySelector('[data-app-sign-in] input').disabled);
  assert.equal(await box.isChecked(), false);
  assert.deepEqual(JSON.parse(readFileSync(path.join(home, 'sign-in.json'), 'utf8')), { open: false });
  assert.equal(calls.at(-1).openAtLogin, false);
  await page.screenshot({ path: path.join(here, 'updates-sign-in-off.png') });
  assert.deepEqual(errors, []);
  console.log(`PASS: the Updates section shows Open at sign-in, on by default; unticking it saves {open:false} and asks Electron for ${JSON.stringify(calls.at(-1))}; no browser errors.`);
} finally { await browser?.close(); rmSync(home, { recursive: true, force: true }); }
