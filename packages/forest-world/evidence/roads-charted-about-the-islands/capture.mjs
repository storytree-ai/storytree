// The world 6.14: storytree's own globe (the code-rows seed, laid out by snapshot.mts), each shot facing one island,
// pictured in real Chromium from two checkouts at the same turn.
// node --import tsx packages/forest-world/evidence/roads-charted-about-the-islands/snapshot.mts <globe.json>
// node packages/forest-world/evidence/roads-charted-about-the-islands/capture.mjs <globe.json> <before-checkout> [after-checkout]
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'out');
const snapshot = path.resolve(process.argv[2]);
const after = path.resolve(process.argv[4] ?? path.join(here, '../../../..'));
const before = path.resolve(process.argv[3] ?? after);
const VIEW = { width: 1200, height: 800 };
// The island each shot faces, and how far past it (degrees, along the way to `toward`) the view's middle sits.
const SHOTS = [
  { name: 'the-world', story: 'The world', toward: 'The librarian', past: 0 },
  { name: 'the-librarian', story: 'The librarian', toward: 'The world', past: 0 },
  { name: 'between', story: 'The world', toward: 'The librarian', past: 45 },
];

const page = (root) => `
import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Quaternion, Vector3 } from 'three';
import { PlanetWorldCanvas, SHIPPED_ELEVATION_DEG } from './planet/PlanetWorldCanvas.js';
import saved from ${JSON.stringify(snapshot.replaceAll('\\', '/'))};

const query = new URLSearchParams(location.search);
const spots = new Map(saved.spots);
const at = title => { const s = spots.get(saved.scene.islands.find(i => i.title === title).story); return new Vector3(s.x, s.y, s.z).normalize(); };
const from = at(query.get('story')), toward = at(query.get('toward'));
const axis = from.clone().cross(toward).normalize(), middle = from.clone().applyAxisAngle(axis, Number(query.get('past')) * Math.PI / 180);
const e = SHIPPED_ELEVATION_DEG * Math.PI / 180;
const q = new Quaternion().setFromUnitVectors(middle, new Vector3(0, Math.sin(e), Math.cos(e))).toArray();
function Ready() { useEffect(() => { setTimeout(() => { window.roadsProof = { checkout: ${JSON.stringify(root)} }; }, 1500); }, []); return null; }
createRoot(document.getElementById('globe')).render(<PlanetWorldCanvas scene={saved.scene} spots={spots} radius={saved.radius}
  rotation={q} framing={1.18} orbit={false}><Ready /></PlanetWorldCanvas>);
`;

async function bundle(root, label) {
  mkdirSync(path.join(out, label), { recursive: true });
  await build({
    stdin: { contents: page(root), resolveDir: path.join(root, 'packages/forest-world/src'), loader: 'tsx', sourcefile: 'page.tsx' },
    outfile: path.join(out, label, 'bundle.js'), bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic',
    loader: { '.json': 'json' }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'error',
  });
}

let browser, server;
try {
  await bundle(before, 'before');
  await bundle(after, 'after');
  server = createServer((req, res) => {
    const [file] = req.url.split('?');
    const bundleOf = file.match(/^\/(before|after)\/bundle\.js$/);
    if (bundleOf) { res.setHeader('Content-Type', 'text/javascript'); res.end(readFileSync(path.join(out, bundleOf[1], 'bundle.js'))); return; }
    const label = file.split('/')[1];
    res.setHeader('Content-Type', 'text/html');
    res.end(`<!doctype html><style>html,body{margin:0;background:#101418}#globe{width:100vw;height:100vh}</style><div id="globe"></div><script src="/${label}/bundle.js"></script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const shot of SHOTS) for (const label of ['before', 'after']) {
    const tab = await browser.newPage({ viewport: VIEW, deviceScaleFactor: 1 });
    const errors = [];
    tab.on('pageerror', error => errors.push(error.message));
    await tab.goto(`${url}/${label}/?story=${encodeURIComponent(shot.story)}&toward=${encodeURIComponent(shot.toward)}&past=${shot.past}`);
    await tab.waitForFunction(() => window.roadsProof !== undefined, null, { timeout: 180_000 });
    await tab.screenshot({ path: path.join(out, `${shot.name}-${label}.png`) });
    if (errors.length) throw new Error(`${label} ${shot.name}: ${errors.join('; ')}`);
    await tab.close();
  }
  // One sheet per shot: before on the left, after on the right.
  for (const shot of SHOTS) {
    const tab = await browser.newPage({ viewport: { width: VIEW.width * 2 + 24, height: VIEW.height + 56 }, deviceScaleFactor: 0.5 });
    const img = label => `data:image/png;base64,${readFileSync(path.join(out, `${shot.name}-${label}.png`)).toString('base64')}`;
    const where = shot.past ? `${shot.past}° from ${shot.story} toward ${shot.toward}` : `facing ${shot.story}`;
    await tab.setContent(`<body style="margin:0;background:#101418;color:#ccd;font:22px system-ui;display:flex;gap:24px">${['before', 'after'].map(label =>
      `<figure style="margin:0"><figcaption style="padding:14px 18px">${label}: ${where}</figcaption><img src="${img(label)}"></figure>`).join('')}</body>`);
    await tab.screenshot({ path: path.join(here, `${shot.name}-before-after.png`) });
    await tab.close();
  }
} finally {
  await browser?.close();
  server?.close();
  rmSync(out, { recursive: true, force: true });
}
