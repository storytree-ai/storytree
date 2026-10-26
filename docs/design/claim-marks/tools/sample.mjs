// Reads colours off the real captures and crops today's band, so the mock-ups start from what the site draws.
// Run from the checkout root: node docs/design/claim-marks/tools/sample.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
// The website package is the one that depends on the browser driver.
const { chromium } = createRequire(resolve('packages/website/package.json'))('playwright-core');

const root = 'packages/website/evidence/';
const shots = {
  claimed: root + 'recorded-claims/1440-checkout-claimed.png',
  health: root + 'review-2026-10-08/after/chapters/1440-map-health.png',
  phone: root + 'recorded-claims/390-checkout-claimed.png',
};
const probes = {
  claimed: { ground: [935, 285], globe: [700, 300], globeNearIsland: [1040, 500], band: [913, 141], band2: [962, 150], ring: [1008, 147], path: [891, 420], page: [300, 300], dotArea: [940, 490] },
  health: { green: [1012, 250], green2: [985, 635], yellow: [985, 124], yellow2: [1010, 130] },
};
const crops = {
  'today-1440': { shot: 'claimed', x: 868, y: 104, w: 160, h: 84 },
  'today-390': { shot: 'phone', x: 150, y: 124, w: 90, h: 44 },
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const out = {};
mkdirSync('docs/design/claim-marks/stills', { recursive: true });
for (const [name, file] of Object.entries(shots)) {
  const url = 'data:image/png;base64,' + readFileSync(file).toString('base64');
  const result = await page.evaluate(async ({ url, probes, crops }) => {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const colours = {};
    for (const [key, [x, y]] of Object.entries(probes ?? {})) {
      // The commonest colour in a 5 by 5 patch, so one antialiased pixel does not decide it.
      const data = ctx.getImageData(x - 2, y - 2, 5, 5).data;
      const seen = new Map();
      for (let i = 0; i < data.length; i += 4) { const k = `${data[i]},${data[i + 1]},${data[i + 2]}`; seen.set(k, (seen.get(k) ?? 0) + 1); }
      colours[key] = [...seen].sort((a, b) => b[1] - a[1])[0][0];
    }
    const cut = {};
    for (const [key, { x, y, w, h }] of Object.entries(crops)) {
      const piece = document.createElement('canvas');
      piece.width = w; piece.height = h;
      piece.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, w, h);
      cut[key] = piece.toDataURL('image/png');
    }
    return { size: [image.width, image.height], colours, cut };
  }, { url, probes: probes[name], crops: Object.fromEntries(Object.entries(crops).filter(([, c]) => c.shot === name)) });
  out[name] = { size: result.size, colours: result.colours };
  for (const [key, data] of Object.entries(result.cut)) writeFileSync(`docs/design/claim-marks/stills/${key}.png`, Buffer.from(data.split(',')[1], 'base64'));
}
await browser.close();
console.log(JSON.stringify(out, null, 1));
