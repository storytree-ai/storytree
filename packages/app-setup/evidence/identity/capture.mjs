// Real feedback component in Chromium; identity and browser actions are explicit fixtures.
// No provider sign-in and no GitHub issue submission. Run: node packages/app-setup/evidence/identity/capture.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { acquireHeavyLock } from '../../../dev-loop/src/heavy-lock.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const desktop = createRequire(path.join(root, 'apps/desktop/package.json'));
const { build } = desktop('esbuild');
const { chromium } = desktop('playwright-core');
const out = fileURLToPath(new URL('.', import.meta.url));
const release = await acquireHeavyLock({ root, what: 'optional feedback capture' });
const temporary = await mkdtemp(path.join(tmpdir(), 'storytree-feedback-capture-'));
let browser, server;
try {
  const fixture = `import { mountSetupHelp } from ${JSON.stringify(path.join(root, 'packages/app-setup/src/view/mount.ts'))};
  window.sent = []; window.signIns = 0;
  const user = { id: '76c80829-6cfd-4f1e-95e8-9a9c781529ce', email: 'reader@example.test' };
  const help = mountSetupHelp(document.querySelector('main'), {
    agentConnections: async () => [],
    feedbackIdentity: { status: async () => null, signIn: async () => { window.signIns++; return user; }, signOut: async () => {} },
    openFeedbackDraft: async draft => { window.sent.push(draft); return { status: 'opened' }; },
    copyHelpText: async text => { window.copied = text; },
  }, { embedded: true }); help.open();`;
  await build({ stdin: { contents: fixture, resolveDir: root }, bundle: true, platform: 'browser', outfile: path.join(temporary, 'preview.js') });
  const css = await readFile(path.join(root, 'apps/desktop/src/renderer/styles.css'), 'utf8') + await readFile(path.join(root, 'packages/app-setup/src/view/styles.css'), 'utf8');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}main{max-width:600px;padding:24px}</style></head><body><main></main><script src="/preview.js"></script></body></html>`;
  server = createServer(async (req, res) => { res.setHeader('Content-Type', req.url === '/preview.js' ? 'text/javascript' : 'text/html'); res.end(req.url === '/preview.js' ? await readFile(path.join(temporary, 'preview.js')) : html); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ executablePath: process.env.STORYTREE_CHROMIUM ?? '/home/mickh/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 660, height: 900 }, colorScheme: 'light' });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('[data-page=feedback]').click();
  await page.getByLabel('Title', { exact: true }).fill('Keep the story list open after switching projects');
  await page.getByLabel('Message', { exact: true }).fill('I would like the story list to stay open when I switch projects.');
  assert.equal(await page.evaluate(() => window.signIns), 0);
  await page.screenshot({ path: path.join(out, 'signed-out.png'), fullPage: true });
  await page.locator('[data-feedback-sign-in]').click();
  await page.locator('[data-feedback-include-identity]').click();
  await page.screenshot({ path: path.join(out, 'reviewed-account.png'), fullPage: true });
  const reviewed = await page.getByLabel('Message', { exact: true }).inputValue();
  await page.getByRole('button', { name: 'Open GitHub draft', exact: true }).click();
  assert.equal(await page.evaluate(() => window.sent[0].body), reviewed);
  await page.getByLabel('Message', { exact: true }).fill('I removed my account details before sharing.');
  await page.getByRole('button', { name: 'Open GitHub draft', exact: true }).click();
  assert.equal(await page.evaluate(() => window.sent[1].body), 'I removed my account details before sharing.');
  await page.setViewportSize({ width: 380, height: 820 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: path.join(out, 'narrow.png'), fullPage: true });
  console.log('PASS: signed-out draft, explicit sign-in, reviewed attribution, removal, and narrow layout. Fixture identity; no external submission.');
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
  release();
}
