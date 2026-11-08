// The selected capability's word in its status's colour (4.43): the story panel as renderStoryPanel draws it, under the
// desktop's own stylesheet and the forest's, once for each of the four words, in the OS's light and dark themes. With
// --before, the forest's stylesheet is main's (`git show origin/main:…`) instead of this checkout's.
// `node --import tsx capture.mjs [--before] <folder>` writes status-words-<theme>[-before].png into <folder> and prints, for
// each word, the colour Chrome computed and its contrast with the panel.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { renderStoryPanel } from '../../../src/view/story-panel.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '../../../../..');
const before = process.argv.includes('--before');
const out = process.argv.slice(2).find(arg => !arg.startsWith('--'));
if (out === undefined) throw new Error('name the folder to write the pictures into');
const host = readFileSync(path.join(root, 'apps/desktop/src/renderer/styles.css'), 'utf8');
const forest = before
  ? execFileSync('git', ['show', 'origin/main:packages/forest/src/view/styles.css'], { cwd: root, encoding: 'utf8' })
  : readFileSync(path.join(root, 'packages/forest/src/view/styles.css'), 'utf8');
const reasons = { proposed: 'Planned, not yet built.', healthy: 'Its contracts pass.', unhealthy: 'A contract fails.', untested: 'Built; nothing has run its tests.' };
const panels = Object.entries(reasons).map(([status, description]) => renderStoryPanel({
  story: status, title: `A capability, ${status}`, description: 'The story it sits in.',
  capabilities: [{ id: status, title: `The ${status} one`, description, reported: status === 'unhealthy' ? 'failing' : 'passing', status, contracts: [] }],
}, status, { details: true })).map(html => `<div class="story-panel" style="position:static;width:22rem">${html}</div>`).join('');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
for (const colorScheme of ['light', 'dark']) {
  const page = await browser.newPage({ viewport: { width: 760, height: 520 }, colorScheme });
  await page.setContent(`<style>${host}</style><style>${forest}</style><div class="forest-workspace" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:12px">${panels}</div>`);
  const seen = await page.evaluate(() => [...document.querySelectorAll('.story-panel')].map(panel => ({
    word: panel.querySelector('.panel-state').textContent, colour: getComputedStyle(panel.querySelector('.panel-state')).color, surface: getComputedStyle(panel).backgroundColor })));
  const name = `status-words-${colorScheme}${before ? '-before' : ''}.png`;
  await page.locator('.forest-workspace').screenshot({ path: path.join(out, name) });
  console.log(name, JSON.stringify(seen));
}
await browser.close();
