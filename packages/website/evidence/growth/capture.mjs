// World 7: replay the shop's recorded growth and storytree's saved reading in real Chromium, in the shipped engine.
// Writes a frame strip per map, a clip of each playing, the frame rate while it plays, and the reduced-motion check.
// node packages/website/evidence/growth/capture.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'out');
// The forest's own styles, for the nameplates PlanetView draws.
const forestCss = readFileSync(path.join(here, '../../../forest/src/view/styles.css'), 'utf8');
mkdirSync(out, { recursive: true });
const SECONDS = 15;
const VIEW = { width: 1440, height: 900 };
let browser, server;
try {
  await build({
    entryPoints: [path.join(here, 'page.tsx')], outfile: path.join(out, 'bundle.js'),
    bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', loader: { '.json': 'json', '.glb': 'binary', '.png': 'file', '.webp': 'file' },
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  server = createServer((req, res) => {
    const file = req.url.split('?')[0];
    if (file === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(readFileSync(path.join(out, 'bundle.js'))); return; }
    if (file.endsWith('.png')) { res.setHeader('Content-Type', 'image/png'); res.end(readFileSync(path.join(here, path.basename(file)))); return; }
    res.setHeader('Content-Type', 'text/html');
    res.end(`<!doctype html><style>${forestCss}</style><style>html,body{margin:0;background:#101418}#globe{width:100vw;height:100vh}</style><div id="globe"></div><script src="/bundle.js"></script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [];
  const open = async (query, options = {}) => {
    const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1, ...options });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`${url}/?seconds=${SECONDS}&${query}`);
    await page.waitForFunction(() => window.growthProof?.snapshot().draws > 0, null, { timeout: 120_000 });
    return { page, context };
  };
  const snap = page => page.evaluate(() => window.growthProof.snapshot());
  const result = { capturedAt: new Date().toISOString(), browser: browser.version(), renderer: 'SwiftShader', viewport: VIEW, seconds: SECONDS, maps: {} };
  for (const map of ['shop', 'storytree']) {
    const record = result.maps[map] = { frames: [] };
    // The strip: fixed moments through the growth, each drawn by the shipped canvas.
    const moments = [0.4, 0.08, 0.16, 0.26, 0.38, 0.5, 0.64, 0.8, 1].map((f, i) => i === 0 ? f : +(f * SECONDS).toFixed(2));
    for (const [i, at] of moments.entries()) {
      const { page, context } = await open(`map=${map}&at=${at}`);
      await page.waitForTimeout(400);
      const seen = await snap(page);
      record.plan ??= await page.evaluate(() => window.growthProof.plan);
      const file = `${map}-${String(i).padStart(2, '0')}.png`;
      await page.screenshot({ path: path.join(here, file) });
      record.frames.push({ at, file, visiblePlates: seen.visiblePlates, plates: seen.plates, visibleNotes: seen.visibleNotes, notes: seen.notes,
        visibleTerritories: seen.visibleTerritories, territories: seen.territories, visibleFiles: seen.visibleFiles, files: seen.files, sessions: seen.sessions });
      await context.close();
    }
    const visible = record.frames.map(f => f.visiblePlates);
    assert.equal(visible[0], 0, `${map}: nothing has risen while the globe is still a point`);
    assert.ok(visible.every((n, i) => i === 0 || n >= visible[i - 1]), `${map}: islands only ever rise`);
    assert.equal(visible.at(-1), record.frames.at(-1).plates, `${map}: every island has risen by the end`);
    // The knowledge core grows with it, where the recording has notes: none at first, only ever more, all by the end.
    const notes = record.frames.map(f => f.visibleNotes);
    assert.equal(notes[0], 0, `${map}: no note shows while the globe is still a point`);
    assert.ok(notes.every((n, i) => i === 0 || n >= notes[i - 1]), `${map}: notes only ever appear`);
    assert.equal(notes.at(-1), record.frames.at(-1).notes, `${map}: every note shows by the end`);
    // Territories and file circles fill in behind their islands: none at first, only ever more, all by the end.
    for (const kind of ['visibleTerritories', 'visibleFiles']) {
      const shown = record.frames.map(f => f[kind]);
      assert.equal(shown[0], 0, `${map}: no ${kind} while the globe is a point`);
      assert.ok(shown.every((n, i) => i === 0 || n >= shown[i - 1]), `${map}: ${kind} only ever fill in`);
      const total = record.frames.at(-1)[kind === 'visibleFiles' ? 'files' : 'territories'];
      assert.equal(shown.at(-1), total, `${map}: every one of ${kind} filled in by the end`);
      assert.ok(total > 0, `${map}: the reading has code to fill in`);
    }
    // Sessions outline the territories they held where the recording carries them (the shop's does): some moment shows
    // one, and the end shows what the recording ends with, nobody (forest 5.7, ADR-0923 D3).
    if (map === 'shop') {
      assert.ok(record.frames.some(f => f.sessions.length > 0), `${map}: a recorded session outlines a territory it held`);
      assert.deepEqual(record.frames.at(-1).sessions, [], `${map}: the recording ends with no territory claimed`);
    }
    // The strip, laid out by the browser.
    const strip = await browser.newPage({ viewport: { width: 1800, height: 420 }, deviceScaleFactor: 1 });
    await strip.goto(`${url}/blank`);
    await strip.setContent(`<body style="margin:0;background:#101418;font:14px sans-serif;color:#d8dde3;display:flex;flex-wrap:wrap;gap:4px;padding:4px">${
      record.frames.map(f => `<figure style="margin:0;width:352px"><img src="${url}/${f.file}" style="width:352px;display:block"><figcaption>${f.at}s · ${f.visiblePlates}/${f.plates} islands${f.notes ? ` · ${f.visibleNotes}/${f.notes} notes` : ''}${f.visibleFiles ? ` · ${f.visibleTerritories} territories · ${f.visibleFiles} files` : ''}${f.sessions.length ? ` · ${f.sessions.length} claimed territor${f.sessions.length > 1 ? 'ies' : 'y'} outlined` : ''}</figcaption></figure>`).join('')}</body>`);
    await strip.waitForLoadState('networkidle');
    await strip.screenshot({ path: path.join(here, `${map}-strip.png`), fullPage: true });
    await strip.close();
    // The clip, recorded on its own run: recording costs frames.
    const video = path.join(out, map);
    const clip = await open(`map=${map}`, { recordVideo: { dir: video, size: { width: 960, height: 600 } } });
    await clip.page.waitForTimeout((SECONDS + 1.5) * 1000);
    await clip.context.close();
    renameSync(await clip.page.video().path(), path.join(here, `${map}-growth.webm`));
    // The frame rate while it plays on the canvas's own clock.
    const { page, context } = await open(`map=${map}`);
    await page.evaluate(() => window.growthProof.frames());
    await page.waitForTimeout((SECONDS + 1.5) * 1000);
    const intervals = await page.evaluate(() => window.growthProof.frames());
    const end = await snap(page);
    await context.close();
    const sorted = [...intervals].sort((a, b) => a - b);
    const playing = intervals.length;
    record.play = { framesDrawn: playing, meanFps: +(1000 / (intervals.reduce((s, x) => s + x, 0) / playing)).toFixed(2),
      p95FrameMs: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1), visiblePlatesAtEnd: end.visiblePlates, plates: end.plates,
      visibleNotesAtEnd: end.visibleNotes, notes: end.notes };
    assert.equal(end.visiblePlates, end.plates, `${map}: played through, every island has risen`);
    assert.equal(end.visibleNotes, end.notes, `${map}: played through, every note shows`);
    // The same globe, no growth, redrawn every frame for as long: what the growth's frame rate is read against.
    const still = await open(`map=${map}&baseline=1`);
    await still.page.evaluate(() => window.growthProof.frames());
    await still.page.waitForTimeout((SECONDS + 1.5) * 1000);
    const base = await still.page.evaluate(() => window.growthProof.frames());
    await still.context.close();
    const baseSorted = [...base].sort((a, b) => a - b);
    record.baseline = { framesDrawn: base.length, meanFps: +(1000 / (base.reduce((s, x) => s + x, 0) / base.length)).toFixed(2),
      p95FrameMs: +baseSorted[Math.floor(baseSorted.length * 0.95)].toFixed(1) };
    // Reduced motion: the end state at once.
    const reduced = await open(`map=${map}`, { reducedMotion: 'reduce' });
    await reduced.page.waitForTimeout(300);
    const at0 = await snap(reduced.page);
    await reduced.page.screenshot({ path: path.join(here, `${map}-reduced-motion.png`) });
    await reduced.page.waitForTimeout(1000);
    const later = await snap(reduced.page);
    await reduced.context.close();
    record.reducedMotion = { visiblePlatesAt300ms: at0.visiblePlates, plates: at0.plates, visibleNotesAt300ms: at0.visibleNotes, notes: at0.notes,
      drawsIn1sAfter: later.draws - at0.draws };
    assert.equal(at0.visiblePlates, at0.plates, `${map}: reduced motion shows every island at once`);
    assert.equal(at0.visibleNotes, at0.notes, `${map}: reduced motion shows every note at once`);
    record.reducedMotion.visibleTerritoriesAt300ms = at0.visibleTerritories;
    record.reducedMotion.visibleFilesAt300ms = at0.visibleFiles;
    assert.equal(at0.visibleTerritories, record.frames.at(-1).visibleTerritories, `${map}: reduced motion shows every territory at once`);
    assert.equal(at0.visibleFiles, record.frames.at(-1).visibleFiles, `${map}: reduced motion shows every file circle at once`);
  }
  result.errors = errors;
  writeFileSync(path.join(here, 'measurements.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
  assert.deepEqual(errors, [], 'the renderer has no errors');
  console.log('PASS world 7: growth replayed from the recordings, islands only rise and notes only appear, all there by the end; reduced motion shows the end at once');
} finally {
  await browser?.close();
  await new Promise(resolve => server ? server.close(resolve) : resolve());
  rmSync(out, { recursive: true, force: true });
}
