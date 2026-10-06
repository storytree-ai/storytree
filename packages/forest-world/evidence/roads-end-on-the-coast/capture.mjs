// The world 6.12: on the website's own globe (packages/website/src/own-snapshot.json), turn the globe so a road's end
// sits just behind its left edge, and picture it in real Chromium from two checkouts at the same turn.
// node packages/forest-world/evidence/roads-end-on-the-coast/capture.mjs <before-checkout> [after-checkout]
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'out');
const after = path.resolve(process.argv[3] ?? path.join(here, '../../../..'));
const before = path.resolve(process.argv[2] ?? after);
const snapshot = path.join(after, 'packages/website/src/own-snapshot.json');
const VIEW = { width: 1200, height: 800 };
// Each road's end, story by story, put just behind the left edge; then a view of the whole globe.
const SHOTS = [
  { name: 'the-world', story: 'The world', behind: 3, framing: 0.3 },
  { name: 'the-agent-link', story: 'The agent link', behind: 3, framing: 0.3 },
  { name: 'whole', story: 'The world', behind: 3, framing: 1.18 },
];

// The page is built against one checkout: every bare import resolves from its engine, so each build is that checkout's.
const page = (root) => `
import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { PlanetWorldCanvas, SHIPPED_ELEVATION_DEG } from './planet/PlanetWorldCanvas.js';
import { buildPlanetPathways } from './planet/pathways.js';
import saved from ${JSON.stringify(snapshot.replaceAll('\\', '/'))};

const query = new URLSearchParams(location.search);
const spots = new Map(saved.spots);
const island = saved.scene.islands.find(i => i.title === query.get('story'));
const plan = buildPlanetPathways(saved.scene, spots, saved.radius);
const dock = plan.docks.filter(d => d.story === island.story).sort((a, b) => Math.hypot(b.local.x, b.local.z) - Math.hypot(a.local.x, a.local.z))[0];
// The farthest-out dock goes ` + '`behind`' + ` degrees past the left edge, its island further behind, its road coming round to the front.
const e = SHIPPED_ELEVATION_DEG * Math.PI / 180, a = Number(query.get('behind')) * Math.PI / 180;
const view = new Vector3(0, Math.sin(e), Math.cos(e)), left = new Vector3(-1, 0, 0);
const u1 = dock.point.clone().normalize(), centre = new Vector3(spots.get(island.story).x, spots.get(island.story).y, spots.get(island.story).z).normalize();
const u2 = centre.clone().addScaledVector(u1, -centre.dot(u1)).normalize();
const t1 = left.clone().multiplyScalar(Math.cos(a)).addScaledVector(view, -Math.sin(a));
const t2 = left.clone().multiplyScalar(-Math.sin(a)).addScaledVector(view, -Math.cos(a));
const U = new Matrix4().makeBasis(u1, u2, u1.clone().cross(u2)), T = new Matrix4().makeBasis(t1, t2, t1.clone().cross(t2));
const computed = new Quaternion().setFromRotationMatrix(T.multiply(U.transpose()));
const q = query.get('q') ? query.get('q').split(',').map(Number) : computed.toArray();
const framing = Number(query.get('framing'));
const radiusPx = Math.min(innerWidth, innerHeight) / 2 / framing;
const sideOffset = framing < 1 ? radiusPx - innerWidth * 0.3 : 0;
const highest = Math.max(...plan.segments.filter(s => s.island === undefined).flatMap(s => s.points.map(p => p.length() - saved.radius)));
function Ready() { useEffect(() => { setTimeout(() => { window.roadsProof = { q, dockAbove: dock.point.length() - saved.radius, highest, checkout: ${JSON.stringify(root)} }; }, 1500); }, []); return null; }
createRoot(document.getElementById('globe')).render(<PlanetWorldCanvas scene={saved.scene} spots={spots} radius={saved.radius}
  rotation={q} framing={framing} sideOffset={sideOffset} orbit={false}><Ready /></PlanetWorldCanvas>);
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
  const result = { capturedAt: new Date().toISOString(), snapshot: 'packages/website/src/own-snapshot.json', before, after, shots: [] };
  for (const shot of SHOTS) {
    let q;
    // The after build picks the turn; the before build is pictured at exactly that turn.
    for (const label of ['after', 'before']) {
      const tab = await browser.newPage({ viewport: VIEW, deviceScaleFactor: 1 });
      const errors = [];
      tab.on('pageerror', error => errors.push(error.message));
      await tab.goto(`${url}/${label}/?story=${encodeURIComponent(shot.story)}&behind=${shot.behind}&framing=${shot.framing}${q ? `&q=${q.join(',')}` : ''}`);
      await tab.waitForFunction(() => window.roadsProof !== undefined, null, { timeout: 120_000 });
      const proof = await tab.evaluate(() => window.roadsProof);
      q ??= proof.q;
      await tab.screenshot({ path: path.join(out, `${shot.name}-${label}.png`) });
      if (errors.length) throw new Error(`${label} ${shot.name}: ${errors.join('; ')}`);
      result.shots.push({ shot: shot.name, label, dockAboveGlass: +proof.dockAbove.toFixed(2), highestRoadAboveGlass: +proof.highest.toFixed(2) });
      await tab.close();
    }
  }
  // One sheet per shot: before on the left, after on the right.
  for (const shot of SHOTS) {
    const tab = await browser.newPage({ viewport: { width: VIEW.width * 2 + 24, height: VIEW.height + 56 }, deviceScaleFactor: 0.5 });
    const img = label => `data:image/png;base64,${readFileSync(path.join(out, `${shot.name}-${label}.png`)).toString('base64')}`;
    await tab.setContent(`<body style="margin:0;background:#101418;color:#ccd;font:22px system-ui;display:flex;gap:24px">${['before', 'after'].map(label =>
      `<figure style="margin:0"><figcaption style="padding:14px 18px">${label}: ${shot.story}${shot.framing < 1 ? ', its road’s end 3° behind the left edge' : ', the whole globe at that turn'}</figcaption><img src="${img(label)}"></figure>`).join('')}</body>`);
    await tab.screenshot({ path: path.join(here, `${shot.name}-before-after.png`) });
    await tab.close();
  }
  writeFileSync(path.join(here, 'measurements.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result.shots, null, 1));
} finally {
  await browser?.close();
  server?.close();
  rmSync(out, { recursive: true, force: true });
}
