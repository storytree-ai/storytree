// Usage: node measure.mjs <dist> <out-prefix> [library|forest] [seconds]
// The actual desktop page over the library-dots-clickable seed with one session reading notes (its glow animates).
// Counts, over a run of frames, how often three.js re-derives a shader program (getProgram -> getParameters, which
// calls material.customProgramCacheKey every time), by material; then CPU-profiles the page for SECONDS.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withCapture } from '../../../../../../apps/desktop/src/capture/index.ts'; // run with node --import tsx
const here = path.dirname(fileURLToPath(import.meta.url));
const [dist, outPrefix, mode = 'library', secondsArg = '20'] = process.argv.slice(2).filter(arg => arg !== '--retake');
const ROOT = process.env.ROOT ?? path.resolve(here, '../../../../../..');
const survey = JSON.parse(readFileSync(path.join(ROOT, 'packages/forest/src/view/evidence/session-tints/survey.json'), 'utf8'));
const seed = JSON.parse(readFileSync(path.join(ROOT, 'packages/forest/src/view/evidence/library-dots-clickable/seed.json'), 'utf8'));
const forest = seed.tree.stories.find(item => item.title === 'The forest');
const covers = [...new Set(seed.changes.changes.filter(c => c.record.fields?.frontCoverOf).map(c => c.recordId))].sort();
const NOW = Date.now();
const lines = [];
const line = (session, minutes, fields) => lines.push({ project: 'storytree', source: 'hook', harness: 'claude-code', session, seq: lines.length + 1, at: new Date(NOW - minutes * 60_000).toISOString(), ...fields });
for (const [s, session] of ['builder', 'reviewer'].entries()) {
  line(session, 30, { kind: 'session-started' });
  line(session, 20, { kind: 'claimed', source: 'tool', capability: forest.capabilities[s].id, reason: 'Build' });
  covers.slice(s * 6, s * 6 + 6).forEach((note, i) => line(session, 15 - i, { kind: 'note-read', source: 'tool', note, found: 'search', read: 'whole', agent: 'orchestrator' }));
}
seed.lines = { lines, cursor: lines.length };
const opens = Object.fromEntries(['builder', 'reviewer'].map((session, s) => [session, covers.slice(s * 6, s * 6 + 6).map((id, i) => ({ kind: 'note', id, call: `c${i}`, tool: 'mcp__storytree__open', resident: true }))]));
seed.tree.arcs = [];
await withCapture({ folder: here, dist }, async ({ browser, origin, out }) => {
  const outputPrefix = path.join(out, path.basename(outPrefix ?? 'capture'));
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, colorScheme: 'dark', reducedMotion: process.env.STILL ? 'reduce' : 'no-preference' });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(({ seed, now }) => {
    window.__unknown = new Set();
    const copy = v => structuredClone(v);
    const known = {
      projectSelection: async () => ({ projects: seed.projects, current: 'storytree' }),
      chooseProject: async () => ({ projects: seed.projects, current: 'storytree' }),
      listProjects: async () => copy(seed.projects),
      projectTree: async () => copy(seed.tree),
      changesSince: async (_, cursor) => ({ changes: copy(seed.changes.changes.filter(c => c.seq > cursor)), cursor: seed.changes.changes.at(-1)?.seq ?? cursor }),
      linesSince: async (_, cursor) => ({ lines: copy(seed.lines.lines.filter(l => l.seq > cursor)), cursor: seed.lines.lines.at(-1)?.seq ?? cursor }),
      frontCovers: async (_, id) => copy(seed.covers?.[id] ?? []), relatedNotes: async () => [],
      arcView: async () => null, arcViews: async () => [], codeSurvey: async () => survey, holds: async () => ({ waits: {}, heldOn: {} }), waitHolds: async () => [], heldOnQuestion: async () => [],
      readSurfaces: async () => ({ ok: false }), readSignIn: async () => ({ on: false }), agentConnections: async () => [],
      windowReadings(project, sessions) { return Promise.all(sessions.map(one => this.windowReading(project, one))); },
      windowReading: async (_, session) => ({ session, at: new Date().toISOString(), compactions: 0, inView: [], glimpses: [], opens: copy(opens[session] ?? []) }), contextReadings: async () => [], idleAfterMs: async () => 3600000, leaveAfterMs: async () => 3600000,
      checkForUpdates: async () => ({ state: 'idle' }),
    };
    window.storytree = new Proxy(known, { get: (t, m) => m === 'then' ? undefined : (t[m] ?? (window.__unknown.add(String(m)), async () => undefined)) });
  }, { seed, now: NOW, survey, opens });
  await page.goto(`${origin}/index.html`, { timeout: 180000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.dataset.state === 'ready' && window.__globe, undefined, { timeout: 120000 });
  for (const name of ['Close help', 'Close app menu']) { const b = page.getByRole('button', { name, exact: true }); if (await b.isVisible().catch(() => false)) await b.click(); }
  await page.evaluate(() => { for (const m of document.querySelectorAll('[popover]')) if (m.matches(':popover-open')) m.hidePopover(); });
  if (mode === 'library') await page.locator('button[data-forest-mode="library"]').click();
  await page.waitForFunction(() => { let n = 0; window.__globe.scene.traverse(o => { if (o.name.startsWith('knowledge-glow:') && o.visible) n++; }); return n > 0; }, undefined, { timeout: 60000 })
    .catch(() => console.error('no visible glow'));
  await page.waitForTimeout(4000);
  if (process.env.STILL) {
    await page.waitForFunction(() => { let n = 0; window.__globe.scene.traverse(o => { if (o.userData?.lit) n++; }); return n > 0; }, undefined, { timeout: 60000 });
    await page.waitForTimeout(3000);
    const png = await page.evaluate(() => { const { gl, scene, camera } = window.__globe; gl.render(scene, camera); return gl.domElement.toDataURL('image/png').split(',')[1]; });
    writeFileSync(`${outputPrefix}-${mode}-still.png`, Buffer.from(png, 'base64'));
    console.log('still written'); return;
  }
  await page.screenshot({ path: `${outputPrefix}-${mode}.png` });
  const counts = await page.evaluate(async () => {
    const { scene, gl } = window.__globe;
    const calls = new Map(), owners = new Map();
    const wrap = () => scene.traverse(o => {
      for (const m of [o.material ?? []].flat()) {
        const label = `${m.type}${m.name ? ':' + m.name : ''}`;
        const who = o.name || o.parent?.name || o.parent?.parent?.name || o.type;
        if (!owners.has(m)) owners.set(m, new Set());
        owners.get(m).add(`${o.type}:${who.replace(/:.*/, ':*')}`);
        if (m.__counted) continue;
        const inner = m.customProgramCacheKey;
        m.customProgramCacheKey = function () { calls.set(m, (calls.get(m) ?? 0) + 1); return inner.call(this); };
        m.__counted = true;
      }
    });
    wrap();
    const context = gl.getContext(); const create = context.createBuffer.bind(context); let buffers = 0; context.createBuffer = () => { buffers++; return create(); };
    let frames = 0; const t0 = performance.now();
    const programs0 = gl.info.programs.length;
    while (performance.now() - t0 < 3000) { window.__globe.invalidate(); await new Promise(requestAnimationFrame); frames++; wrap(); }
    const byLabel = new Map();
    for (const [m, n] of calls) { const k = `${m.type} <- ${[...owners.get(m)].slice(0, 3).join(', ')}`; byLabel.set(k, (byLabel.get(k) ?? 0) + n); }
    let objects = 0; scene.traverse(() => objects++);
    return { frames, buffersPerFrame: +(buffers / frames).toFixed(1), programsPerFrame: +([...calls.values()].reduce((a, b) => a + b, 0) / frames).toFixed(1), programsCompiled: gl.info.programs.length - programs0,
      objects, top: [...byLabel].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => `${(n / frames).toFixed(1)}/frame  ${k}`) };
  });
  const cdp = await page.context().newCDPSession(page);
  await page.evaluate(() => { const { gl } = window.__globe; const render = gl.render.bind(gl); window.__render = { ms: 0, n: 0 };
    gl.render = (...a) => { const t = performance.now(); render(...a); window.__render.ms += performance.now() - t; window.__render.n++; }; });
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start');
  await page.waitForTimeout(Number(secondsArg) * 1000);
  const { profile } = await cdp.send('Profiler.stop');
  const render = await page.evaluate(() => window.__render);
  const self = new Map(); let total = 0;
  const byId = new Map(profile.nodes.map(n => [n.id, n]));
  profile.samples.forEach((id, i) => { const t = profile.timeDeltas[i] ?? 0; total += t; const f = byId.get(id).callFrame; const k = f.functionName || '(anon)'; self.set(k, (self.get(k) ?? 0) + t); });
  const share = k => +(((self.get(k) ?? 0) / total)).toFixed(3);
  const result = { mode, ...counts, renders: render.n, renderMsPerFrame: +(render.ms / render.n).toFixed(2), profileSeconds: +(total / 1e6).toFixed(1), idleShare: share('(idle)'), getParametersShare: share('getParameters'), getProgramShare: share('getProgram'),
    topSelf: [...self].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, t]) => `${(t / total * 100).toFixed(1)}% ${k}`), errors, unknown: await page.evaluate(() => [...window.__unknown]) };
  writeFileSync(`${outputPrefix}-${mode}.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await page.screenshot({ path: `${outputPrefix}-${mode}-end.png` });
});
