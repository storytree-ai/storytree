// The globe at "idle with agents active": the actual desktop page (built by the session-tints evidence build.mjs
// into DIST), the knowledge-under-islands seed, and a stand-in bridge whose log grows by one line every read, so
// every 2 s poll carries news but nothing drawn changes. Records Long Animation Frames for SECONDS and a screenshot.
// Usage: node idle.mjs <dist> <out-prefix> [seconds]
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withCapture } from '../../../../../../apps/desktop/src/capture/index.ts'; // run with node --import tsx
const here = path.dirname(fileURLToPath(import.meta.url));
const [dist, outPrefix, secondsArg] = process.argv.slice(2).filter(arg => arg !== '--retake');
const SECONDS = Number(secondsArg ?? 40);
// MODE: idle (nothing on show changes), island (one island's title changes every poll), wisps (a claim comes and goes every poll).
const MODE = process.env.MODE ?? 'idle';
const ev = process.env.EVIDENCE ?? path.resolve(dist, '..', '..');
const seed = JSON.parse(readFileSync(path.join(ev, 'knowledge-under-islands/seed.json'), 'utf8'));
const survey = JSON.parse(readFileSync(path.join(ev, 'session-tints/survey.json'), 'utf8'));
await withCapture({ folder: here, dist }, async ({ browser, origin, out }) => {
  const outputPrefix = path.join(out, path.basename(outPrefix ?? 'capture'));
const NOW = Date.parse('2026-10-01T12:00:00.000Z');
const A = '3b229329-6239-408a-a88c-2669d839ca45';
const base = [
  { kind: 'session-started', source: 'hook' }, { kind: 'prompt-submitted', source: 'hook' },
  { kind: 'claimed', source: 'tool', capability: 'capability_4da153322012', reason: 'tool call arguments' },
].map((l, i) => ({ ...l, session: A, harness: 'claude-code', project: 'storytree', seq: i + 1, at: new Date(NOW - 60_000 * (10 - i)).toISOString() }));
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, colorScheme: 'dark' });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(({ data, survey, base, now, A, mode }) => {
    const RealDate = Date;
    class FixedDate extends RealDate { constructor(...a) { if (a.length === 0) super(now); else super(...a); } static now() { return now; } }
    globalThis.Date = FixedDate;
    const copy = v => structuredClone(v);
    const lines = [...base];
    window.__reads = { lines: 0, trees: 0 };
    const known = {
      projectSelection: async () => copy({ projects: data.projects, current: 'storytree' }),
      chooseProject: async () => copy({ projects: data.projects, current: 'storytree' }),
      listProjects: async () => copy(data.projects),
      projectTree: async () => {
        window.__reads.trees++;
        const tree = copy(data.tree);
        if (mode === 'island' && window.__live) { const librarian = tree.stories.find(s => s.id === 'story_69d0ee10bbe7'); librarian.title += ' ' + window.__reads.trees % 7; }
        return tree;
      },
      changesSince: async (_, cursor) => {
        if (cursor === 0) return copy(data.changes);
        if (mode !== 'island' || !window.__live) return { changes: [], cursor };
        const record = copy(data.changes.changes.find(c => c.recordId === 'story_69d0ee10bbe7').record);
        return { changes: [{ seq: cursor + 1, recordId: record.id, type: 'story', action: 'updated', record }], cursor: cursor + 1 };
      },
      // Every read after the first carries one new line: an agent at work, nothing on the globe changing.
      linesSince: async (_, cursor) => {
        window.__reads.lines++;
        const line = mode === 'wisps' && window.__live ? (window.__reads.lines % 2 ? { kind: 'claimed', source: 'tool', capability: 'capability_9f02379a2e1a', reason: 'territory colours' } : { kind: 'released', source: 'tool', capability: 'capability_9f02379a2e1a' })
          : { kind: 'file-edited', source: 'hook', files: ['packages/agent-link/src/tools.ts'] };
        if (cursor > 0) lines.push({ ...line, session: A, harness: 'claude-code', project: 'storytree', seq: lines.length + 1, at: new Date(now).toISOString() });
        return { lines: copy(lines.slice(cursor)), cursor: lines.length };
      },
      frontCovers: async () => [], relatedNotes: async () => [], readSurfaces: async () => undefined,
      codeSurvey: async () => copy(survey),
      readSignIn: async () => ({ on: false }), agentConnections: async () => [], windowReadings: async () => [], contextReadings: async () => [], idleAfterMs: async () => 3600000, leaveAfterMs: async () => 3600000,
      windowReading: async (_, session) => ({ session, at: new Date(now).toISOString(), turns: [], lines: [], opens: [] }), checkForUpdates: async () => ({ state: 'idle' }),
    };
    window.__unknown = new Set();
    window.storytree = new Proxy(known, { get: (t, m) => m === 'then' ? undefined : (t[m] ?? (async () => { window.__unknown.add(String(m)); return undefined; })) });
  }, { data: seed, survey, base, now: NOW, A, mode: MODE });
  await page.goto(`${origin}/index.html`, { timeout: 180000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.dataset.state === 'ready' && window.__globe, undefined, { timeout: 120000 }).catch(async e => { console.error(await page.evaluate(() => document.body.dataset.state + ' | ' + document.body.innerText.slice(0, 500)), errors); throw e; });
  await page.waitForFunction(() => { let f = 0; window.__globe.scene.traverse(o => { if (o.name.startsWith('file:')) f++; }); return f > 0; }, undefined, { timeout: 60000 });
  await page.evaluate(() => { for (const m of document.querySelectorAll('[popover]')) if (m.matches(':popover-open')) m.hidePopover(); });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${outputPrefix}-front.png` });
  const cdp = process.env.PROFILE ? await page.context().newCDPSession(page) : undefined;
  if (cdp) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start'); }
  const result = await page.evaluate(async seconds => {
    const loaf = [];
    const po = new PerformanceObserver(list => { for (const e of list.getEntries()) loaf.push({ start: e.startTime, duration: e.duration, blocking: e.blockingDuration }); });
    po.observe({ type: 'long-animation-frame', buffered: false });
    window.__live = true;
    const reads0 = { ...window.__reads };
    const t0 = performance.now();
    await new Promise(r => setTimeout(r, seconds * 1000));
    po.disconnect();
    window.__live = false;
    const elapsed = performance.now() - t0;
    const total = loaf.reduce((s, e) => s + e.duration, 0);
    return { seconds: elapsed / 1000, lineReads: window.__reads.lines - reads0.lines, treeReads: window.__reads.trees - reads0.trees, librarianLabel: [...document.querySelectorAll('*')].filter(e => e.childElementCount === 0 && e.textContent.startsWith('The librarian')).map(e => e.textContent).join('|'), longFrames: loaf.length, longFrameMsTotal: Math.round(total),
      blockedShare: +(total / elapsed).toFixed(3), longestFrameMs: Math.round(Math.max(0, ...loaf.map(e => e.duration))), blockingMsTotal: Math.round(loaf.reduce((s, e) => s + e.blocking, 0)) };
  }, SECONDS);
  if (cdp) {
    const { profile } = await cdp.send('Profiler.stop');
    const self = new Map(), byId = new Map(profile.nodes.map(n => [n.id, n]));
    const dt = new Map(); profile.samples.forEach((id, i) => dt.set(id, (dt.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0)));
    // inclusive time per function name
    const parent = new Map(); for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
    const incl = new Map();
    for (const [id, t] of dt) { const seen = new Set(); for (let at = id; at !== undefined; at = parent.get(at)) { const f = byId.get(at).callFrame; const k = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber}`; if (!seen.has(k)) { seen.add(k); incl.set(k, (incl.get(k) ?? 0) + t); } }
      const f = byId.get(id).callFrame; const k = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber}`; self.set(k, (self.get(k) ?? 0) + t); }
    const top = m => [...m].sort((a, b) => b[1] - a[1]).slice(0, 45).map(([k, t]) => `${(t / 1000).toFixed(0).padStart(7)} ms  ${k}`).join('\n');
    writeFileSync(path.join(out, path.basename(process.env.PROFILE)), `INCLUSIVE\n${top(incl)}\n\nSELF\n${top(self)}\n`);
  }
  await page.screenshot({ path: `${outputPrefix}-after-polls.png` });
  if (process.env.HOVER) {
    let shown = 0, tried = 0;
    for (let x = 640; x <= 820 && shown < 3; x += 6) for (let y = 460; y <= 600 && shown < 3; y += 6) {
      tried++;
      await page.mouse.move(x, y);
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      const tip = await page.evaluate(() => document.querySelector('[role=tooltip]')?.textContent);
      if (tip) { shown++; result.hover = [...(result.hover ?? []), tip]; }
    }
    result.hoverTried = tried;
  }
  result.errors = errors; result.unknownCalls = await page.evaluate(() => [...window.__unknown]);
  writeFileSync(`${outputPrefix}.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
});
