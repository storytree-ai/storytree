// Captures the stills kept beside the claim mark alternatives page, at named moments of a claim's life.
// Run from the checkout root: node docs/design/claim-marks/tools/shots.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
// The website package is the one that depends on the browser driver.
const { chromium } = createRequire(resolve('packages/website/package.json'))('playwright-core');

const dir = 'docs/design/claim-marks/';
// The published page is wrapped in a document skeleton; this is the same wrapping for a local look.
const body = readFileSync(dir + 'claim-marks.html', 'utf8');
writeFileSync(dir + 'preview.html', `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style></head><body>${body}</body></html>`);
mkdirSync(dir + 'stills', { recursive: true });

/** Seconds on the page's 20-second clock, per scene. */
const moments = {
  neighbours: { 'arriving-third': 5.0, held: 8, quiet: 11.6 },
  first: { held: 8.6 },
};
const browser = await chromium.launch({ headless: true });
const errors = [];
async function open(width, height, scale, keepBar = false) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(pathToFileURL(resolve(dir + 'preview.html')).href);
  await page.waitForFunction(() => window.claimMarks !== undefined);
  // The sticky clock bar would sit over whatever a capture scrolls to.
  if (!keepBar) await page.addStyleTag({ content: '.transport{position:static!important}' });
  return page;
}
const at = (page, t, scene, still = false) => page.evaluate(({ t, scene, still }) => window.claimMarks.set(t, { scene, still }), { t, scene, still });
const shot = (page, selector, name) => page.locator(selector).screenshot({ path: `${dir}stills/${name}.png` });

// The strip of all seven, at twice the pixels so the small islands can be read.
const strip = await open(1440, 900, 2);
for (const name of Object.keys(moments.neighbours)) { await at(strip, moments.neighbours[name], 'neighbours'); await shot(strip, '#strip', `strip-neighbours-${name}`); }
await at(strip, moments.neighbours.held, 'neighbours', true); await shot(strip, '#strip', 'strip-neighbours-held-still');
await at(strip, moments.first.held, 'first'); await shot(strip, '#strip', 'strip-first-held');

// Today's band and the chosen flag at the page's own pixel sizes.
const rows = await open(1440, 900, 1);
await at(rows, moments.neighbours.held, 'neighbours'); await shot(rows, '#alt-band .stages', 'band-held');
for (const name of Object.keys(moments.neighbours)) { await at(rows, moments.neighbours[name], 'neighbours'); await shot(rows, '#alt-flag .stages', `flag-${name}`); }
await at(rows, moments.first.held, 'first'); await shot(rows, '#alt-flag .stages', 'flag-first-island-held');

const top = await open(1440, 900, 1, true);
await at(top, moments.neighbours.held, 'neighbours');
await top.screenshot({ path: `${dir}stills/page-top-1440.png` });
const phone = await open(390, 844, 1, true);
console.log('phone horizontal overflow px:', await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth));
await browser.close();
console.log(errors.length ? 'page errors:\n' + errors.join('\n') : 'no page errors');
