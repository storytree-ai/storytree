// Real gear/settings components and settings writers, with a throwaway home; no live library.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { settingsActions } from '@storytree/agent-link/settings';
import { buildAppMenu } from './build.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const { chromium } = await import(process.env.STORYTREE_PLAYWRIGHT ?? '/home/mickh/code/Storytree/node_modules/.pnpm/playwright-core@1.60.0/node_modules/playwright-core/index.mjs');
const home = mkdtempSync(path.join(tmpdir(), 'idle-setting-capture-'));
let browser;
try {
  const bundle = await buildAppMenu();
  browser = await chromium.launch({ executablePath: process.env.STORYTREE_CHROMIUM ?? '/home/mickh/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell', headless:true,args:['--no-sandbox'] });
  const page = await browser.newPage({ viewport:{width:1440,height:1000},colorScheme:'dark' });
  const errors=[];
  page.on('pageerror', error=>errors.push(String(error)));
  const bridge=settingsActions(home);
  await page.exposeFunction('readSettings', ()=>bridge.readSettings());
  await page.exposeFunction('saveSetting', (...args)=>bridge.saveSetting(...args));
  await page.setContent('<style>body{margin:0;background:#101418;color:#eceae3;font:14px system-ui}main{padding:100px 32px;color:#a9b0ba}</style><div id="gear"></div><main>Settings component preview</main>');
  await page.evaluate(()=>{window.storytree={readSettings:window.readSettings,saveSetting:window.saveSetting,standingDelegations:async()=>undefined};});
  await page.addScriptTag({content:bundle});
  await page.getByRole('button',{name:'App menu',exact:true}).click();
  await page.getByRole('button',{name:'Sessions',exact:true}).click();
  const row=page.locator('[data-setting="idle-after"]');
  const input=row.locator('input');
  await input.waitFor();
  assert.equal(await input.inputValue(),'30m');
  assert.equal(await input.getAttribute('inputmode'),'text');
  assert.equal(await page.locator('[data-setting="context-guidance"] input').inputValue(),'600000');
  await page.screenshot({path:path.join(here,'settings-default.png')});
  await input.fill('10m');
  await row.getByRole('button',{name:'Save',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-setting="idle-after"] .settings-saved').textContent==='Saved');
  const file=path.join(home,'settings.json');
  const saved=readFileSync(file,'utf8');
  assert.equal(JSON.parse(saved)['idle-after'],'10m');
  await page.screenshot({path:path.join(here,'settings-saved.png')});
  for (const value of ['soon','0m','-5m']) {
    await input.fill(value);
    await row.getByRole('button',{name:'Save',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('[data-setting="idle-after"] .settings-error').textContent.includes('positive duration'));
    assert.equal(readFileSync(file,'utf8'),saved);
  }
  await page.screenshot({path:path.join(here,'settings-refused.png')});
  assert.deepEqual(errors,[]);
  console.log('PASS: actual gear/settings components show 600000 and 30m; save 10m; reject soon, 0m, -5m inline without changing saved bytes; no browser errors. Component preview only; session and claim liveness are verified separately in green.txt.');
} finally { await browser?.close(); rmSync(home,{recursive:true,force:true}); }
