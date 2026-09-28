// Help contracts 3–5: actual desktop renderer, isolated library, fake OS browser/clipboard.
// Run from repo root under flock /tmp/storytree-heavy.lock with STORYTREE_PLAYWRIGHT set to
// an installed playwright-core/index.mjs (and STORYTREE_CHROMIUM if needed). No issue is submitted.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { start } from '@storytree/local-postgres';
import { connect } from '@storytree/library';
import { findProject, setUpProject } from '@storytree/agent-link';
import { setupHelpActions } from '../../src/index.ts';

const root = fileURLToPath(new URL('../../../..', import.meta.url));
const desktop = createRequire(path.join(root, 'apps/desktop/package.json'));
const { pageReads, projectSelection } = await import(desktop.resolve('@storytree/app'));
const { chromium } = await import(process.env.STORYTREE_PLAYWRIGHT ?? 'playwright-core');
const out = process.env.STORYTREE_HELP_OUT ?? path.join(root, 'packages/app-setup/evidence/help/capture');
mkdirSync(out, { recursive: true });
assert.equal(spawnSync(process.execPath, ['apps/desktop/build.mjs'], { cwd: root, stdio: 'inherit' }).status, 0);
const home = mkdtempSync(path.join(tmpdir(), 'storytree-help-'));
const licenseFile = path.join(home, 'LICENSE');
const license = readFileSync(path.join(root, 'LICENSE'), 'utf8');
writeFileSync(licenseFile, readFileSync(path.join(root, 'apps/desktop/dist/LICENSE')));
assert.equal(readFileSync(licenseFile, 'utf8'), license);
const folders = ['first', 'second'].map(name => { const folder = path.join(home, name); mkdirSync(folder); return folder; });
const opened = [], copied = [], errors = [], passed = [], calls = {};
let pg, library, reads, browser, server;
let folder, failBrowser = true, failCopy = false;
try {
  pg = await start({ dataDir: path.join(home, 'pgdata'), owner: 'setup help acceptance' });
  library = await connect({ url: pg.url });
  reads = pageReads({ storytree: library });
  const selection = projectSelection({ file: path.join(home, 'project-choice.json'), listProjects: () => library.listProjects() });
  const help = setupHelpActions({
    licenseFile, storytreeHome: home, chooseFolder: async () => folder,
    openExternal: async url => { if (failBrowser) throw new Error('fake browser failure'); opened.push(url); },
    copyText: async text => { if (failCopy) throw new Error('fake clipboard failure'); copied.push(text); },
  });
  server = createServer((req, res) => {
    const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
    if (!['index.html', 'renderer.js', 'renderer.js.map', 'styles.css', 'arc-surface.css', 'app-setup.css'].includes(name)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(readFileSync(path.join(root, 'apps/desktop/dist/renderer', name)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({
    ...(process.env.STORYTREE_CHROMIUM ? { executablePath: process.env.STORYTREE_CHROMIUM } : {}), headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({ viewport: { width: 1120, height: 860 } });
  context.setDefaultTimeout(30_000);
  await context.exposeBinding('bridge', async (_source, method, args) => {
    calls[method] = (calls[method] ?? 0) + 1;
    if (method in help) return help[method](...args);
    if (method === 'projectSelection') return selection.read();
    if (method === 'chooseProject') return selection.choose(...args);
    return reads[method](...args);
  });
  await context.addInitScript(() => {
    window.storytree = Object.fromEntries(['readSetupLicense', 'checkSetupFolder', 'openFeedbackDraft', 'copyHelpText', 'projectSelection', 'chooseProject', 'listProjects', 'projectTree', 'changesSince', 'linesSince', 'frontCovers', 'relatedNotes', 'arcView', 'waitHolds', 'heldOnQuestion'].map(name => [name, (...args) => window.bridge(name, args)]));
  });
  context.on('page', page => page.on('pageerror', error => errors.push(error.stack ?? String(error))));
  const page = await context.newPage();
  const url = `http://127.0.0.1:${server.address().port}/`;
  await page.goto(url);
  await page.waitForFunction(() => document.body.dataset.state === 'empty');
  assert.equal(await page.locator('#setup-help-panel').isVisible(), true);
  await page.screenshot({ path: path.join(out, 'first-run.png') });
  await page.getByRole('button', { name: 'Check a folder…', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-check-status]').textContent.includes('cancelled'));
  folder = folders[0];
  await page.getByRole('button', { name: 'Check a folder…', exact: true }).click();
  await page.locator('[data-diagnostics]').waitFor({ state: 'visible' });
  assert.ok(await page.locator('[data-diagnostics] li').count() > 0);
  assert.equal(findProject(folder).project, undefined);
  assert.deepEqual(await library.listProjects(), []);
  await page.getByRole('button', { name: 'Copy request for your agent' }).click();
  await page.waitForFunction(() => document.querySelector('[data-check-status]').textContent.startsWith('Copied'));
  assert.ok(copied[0].includes('check_setup'));
  await page.screenshot({ path: path.join(out, 'diagnostics.png') });
  passed.push('3.1 first-run guide without project', '3.2 folder diagnostics/cancel/recovery through public agent-link API; no project created');

  await page.locator('[data-page=license]').click();
  await page.waitForFunction(() => document.querySelector('[data-license]').textContent.length > 0);
  assert.equal(await page.locator('[data-license]').textContent(), license);
  await context.setOffline(true);
  writeFileSync(licenseFile, license + '\n'); // resource replaced by an update, at the same installed path
  await page.locator('[data-page=guide]').click();
  await page.locator('[data-page=license]').click();
  await page.waitForFunction(text => document.querySelector('[data-license]').textContent === text, license + '\n');
  await page.screenshot({ path: path.join(out, 'offline-license.png') });
  rmSync(licenseFile);
  await page.locator('[data-page=guide]').click();
  await page.locator('[data-page=license]').click();
  await page.locator('[data-license-retry]').waitFor({ state: 'visible' });
  writeFileSync(licenseFile, license);
  await page.locator('[data-license-retry]').click();
  await page.waitForFunction(text => document.querySelector('[data-license]').textContent === text, license);
  await context.setOffline(false);
  passed.push('4.1/4.2 offline shipped license; replacement resource read; missing-resource retry (not a real release update)');

  await page.locator('[data-page=feedback]').click();
  await page.getByLabel('Title', { exact: true }).fill('Help & ideas 🌳');
  await page.getByLabel('Message', { exact: true }).fill('My reviewed message\n<project details deliberately omitted>');
  await page.getByRole('button', { name: 'Close help' }).click();
  assert.equal(opened.length, 0);
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await page.getByRole('button', { name: 'Open GitHub draft', exact: true }).click();
  await page.getByRole('button', { name: 'Retry opening draft', exact: true }).waitFor();
  const message = await page.getByLabel('Message', { exact: true }).inputValue();
  await page.getByRole('button', { name: 'Copy prepared text', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-feedback-status]').textContent.startsWith('Copied'));
  assert.equal(copied.at(-1), 'Help & ideas 🌳\n\n' + message);
  failCopy = true;
  await page.getByRole('button', { name: 'Copy prepared text', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-feedback-status]').getAttribute('role') === 'alert');
  failBrowser = false;
  await page.getByRole('button', { name: 'Retry opening draft', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-feedback-status]').textContent.startsWith('Opened a draft'));
  assert.deepEqual([...new URL(opened[0]).searchParams], [['title', 'Help & ideas 🌳'], ['body', message]]);
  await page.screenshot({ path: path.join(out, 'feedback-draft.png') });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#setup-help-panel').isVisible(), false);
  assert.equal(await page.getByRole('button', { name: 'Help', exact: true }).evaluate(node => node === document.activeElement), true);
  await page.reload();
  await page.waitForFunction(() => document.body.dataset.state === 'empty');
  assert.equal(await page.locator('#setup-help-panel').isVisible(), false);
  passed.push('5.1–5.4 empty-app composer: cancel, editable text, browser failure, retry, copy/copy failure, exact draft payload and honest handoff status', '3.1 reopen guide; dismiss persists and Escape restores focus');

  // Fixture setup represents two explicit yes answers. Real harness consent belongs to Windows acceptance.
  for (const [index, folder] of folders.entries()) {
    const name = index === 0 ? 'first-project' : 'second-project';
    await setUpProject({ folder, project: name, storytree: library, storytreeHome: home });
    const project = await library.openProject(name);
    const story = await project.addStory({ title: index === 0 ? 'First project' : 'Second project' });
    await project.addCapability({ story: story.id, title: 'A first piece of work' });
    await project.close();
    await page.waitForFunction(name => document.body.dataset.project === name && document.body.dataset.state === 'ready', name);
  }
  assert.equal(await page.locator('#project option').count(), 2);
  for (const name of ['first-project', 'second-project']) {
    await page.selectOption('#project', name);
    await page.waitForFunction(name => document.body.dataset.project === name && document.body.dataset.state === 'ready', name);
    await page.getByRole('button', { name: 'Help', exact: true }).click();
    await page.locator('[data-page=feedback]').click();
    await page.getByLabel('Title', { exact: true }).fill('Feedback from either forest');
    await page.getByLabel('Message', { exact: true }).fill('Only my words');
    await page.getByRole('button', { name: 'Open GitHub draft', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-feedback-status]').textContent.startsWith('Opened a draft'));
    await page.locator('[data-page=guide]').click();
    const handle = await page.locator('[data-open-arcs]').boundingBox();
    const hit = await page.evaluate(({x,y,width,height}) => document.elementFromPoint(x + width / 2, y + height / 2)?.closest('[data-open-arcs]') !== null, handle);
    assert.equal(hit, true, 'Help must not cover the arc handle');
    await page.screenshot({ path: path.join(out, name + '.png') });
    await page.keyboard.press('Escape');
  }
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await page.setViewportSize({ width: 640, height: 480 });
  const panel = await page.locator('#setup-help-panel').boundingBox();
  assert.ok(panel.x >= 0 && panel.x + panel.width <= 640 && panel.y + panel.height <= 480);
  const handle = await page.locator('[data-open-arcs]').boundingBox();
  assert.equal(await page.evaluate(({x,y,width,height}) => Boolean(document.elementFromPoint(x + width / 2, y + height / 2)?.closest('[data-open-arcs]')), handle), true);
  await page.screenshot({ path: path.join(out, 'small-window.png') });
  passed.push('3.3 app-side only: two setup fixtures appear through normal refresh and both forests selectable', '5.1 feedback over both forests', 'Help leaves arc handle clickable at normal and minimum window sizes');
  await page.setViewportSize({ width: 1120, height: 860 });
  await page.goto(url + '?problem=Library%20unavailable');
  await page.waitForFunction(() => document.body.dataset.state === 'error');
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  assert.equal(await page.locator('#setup-help-panel').isVisible(), true);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: path.join(out, 'library-error-dark.png') });
  passed.push('Help remains available on database error; dark theme');
  assert.deepEqual(errors, []);
  const result = { passed, calls, opened, errors, limits: 'Fake OS opener/clipboard; fixture setup yes; no Windows installer, real harness approvals, actual GitHub submission, arm64 launch or real release update.' };
  writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await reads?.close(); await library?.close(); await pg?.stop();
  rmSync(home, { recursive: true, force: true });
}
