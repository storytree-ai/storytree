// The globe at "idle with agents active": the actual desktop page (built by the session-tints evidence build.mjs
// into DIST), the knowledge-under-islands seed, and a stand-in bridge whose log grows by one line every read, so
// every 2 s poll carries news but nothing drawn changes. Records Long Animation Frames for SECONDS and a screenshot.
// Usage: node idle.mjs <dist> <out-prefix> [seconds]
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const [dist, outPrefix, secondsArg] = process.argv.slice(2);
const SECONDS = Number(secondsArg ?? 40);
const { chromium } = await import('/home/mickh/code/storytree03/node_modules/.pnpm/node_modules/playwright-core/index.mjs');
const ev = process.env.EVIDENCE ?? path.resolve(dist, '..', '..');
const seed = JSON.parse(readFileSync(path.join(ev, 'knowledge-under-islands/seed.json'), 'utf8'));
const survey = JSON.parse(readFileSync(path.join(ev, 'session-tints/survey.json'), 'utf8'));
const server = createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1);
  try { res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html'); res.end(readFileSync(path.join(dist, name))); }
  catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const NOW = Date.parse('2026-10-01T12:00:00.000Z');
const A = '3b229329-6239-408a-a88c-2669d839ca45';
const base = [
  { kind: 'session-started', source: 'hook' }, { kind: 'prompt-submitted', source: 'hook' },
  { kind: 'claimed', source: 'tool', capability: 'capability_4da153322012', reason: 'tool call arguments' },
].map((l, i) => ({ ...l, session: A, harness: 'claude-code', project: 'storytree', seq: i + 1, at: new Date(NOW - 60_000 * (10 - i)).toISOString() }));
const browser = await chromium.launch({ executablePath: '/home/mickh/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell',
  headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, colorScheme: 'dark' });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(({ data, survey, base, now, A }) => {
    const RealDate = Date;
    class FixedDate extends RealDate { constructor(...a) { if (a.length === 0) super(now); else super(...a); } static now() { return now; } }
    globalThis.Date = FixedDate;
    const copy = v => structuredClone(v);
    const lines = [...base];
    window.__reads = { lines: 0, trees: 0 };
    const known = {
      projectSelection: async () => copy({ projects: data.projects, current: 'storytree' }),
      chooseProject: async () => copy({ projects: data.projects, current: 'storytree' }),
      listProjects: async () => copy(data.projects), projectTree: async () => { window.__reads.trees++; return copy(data.tree); },
      changesSince: async (_, cursor) => cursor === 0 ? copy(data.changes) : { changes: [], cursor: data.changes.cursor },
      // Every read after the first carries one new line: an agent at work, nothing on the globe changing.
      linesSince: async (_, cursor) => {
        window.__reads.lines++;
        if (cursor > 0) lines.push({ kind: 'file-edited', source: 'hook', files: ['packages/agent-link/src/tools.ts'], session: A, harness: 'claude-code', project: 'storytree', seq: lines.length + 1, at: new Date(now).toISOString() });
        return { lines: copy(lines.slice(cursor)), cursor: lines.length };
      },
      frontCovers: async () => [], relatedNotes: async () => [], readSurfaces: async () => undefined,
      codeSurvey: async () => copy(survey),
      readSignIn: async () => ({ on: false }), agentConnections: async () => [], windowReadings: async () => [], contextReadings: async () => [], idleAfterMs: async () => 3600000, leaveAfterMs: async () => 3600000,
      windowReading: async (_, session) => ({ session, at: new Date(now).toISOString(), turns: [], lines: [], opens: [] }), checkForUpdates: async () => ({ state: 'idle' }),
    };
    window.__unknown = new Set();
    window.storytree = new Proxy(known, { get: (t, m) => m === 'then' ? undefined : (t[m] ?? (async () => { window.__unknown.add(String(m)); return undefined; })) });
  }, { data: seed, survey, base, now: NOW, A });
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { timeout: 180000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.dataset.state === 'ready' && window.__globe, undefined, { timeout: 120000 }).catch(async e => { console.error(await page.evaluate(() => document.body.dataset.state + ' | ' + document.body.innerText.slice(0, 500)), errors); throw e; });
  await page.waitForFunction(() => { let f = 0; window.__globe.scene.traverse(o => { if (o.name.startsWith('file:')) f++; }); return f > 0; }, undefined, { timeout: 60000 });
  await page.evaluate(() => { for (const m of document.querySelectorAll('[popover]')) if (m.matches(':popover-open')) m.hidePopover(); });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${outPrefix}-front.png` });
  const result = await page.evaluate(async seconds => {
    const loaf = [];
    const po = new PerformanceObserver(list => { for (const e of list.getEntries()) loaf.push({ start: e.startTime, duration: e.duration, blocking: e.blockingDuration }); });
    po.observe({ type: 'long-animation-frame', buffered: false });
    const reads0 = { ...window.__reads };
    const t0 = performance.now();
    await new Promise(r => setTimeout(r, seconds * 1000));
    po.disconnect();
    const elapsed = performance.now() - t0;
    const total = loaf.reduce((s, e) => s + e.duration, 0);
    return { seconds: elapsed / 1000, lineReads: window.__reads.lines - reads0.lines, longFrames: loaf.length, longFrameMsTotal: Math.round(total),
      blockedShare: +(total / elapsed).toFixed(3), longestFrameMs: Math.round(Math.max(0, ...loaf.map(e => e.duration))), blockingMsTotal: Math.round(loaf.reduce((s, e) => s + e.blocking, 0)) };
  }, SECONDS);
  await page.screenshot({ path: `${outPrefix}-after-polls.png` });
  result.errors = errors; result.unknownCalls = await page.evaluate(() => [...window.__unknown]);
  writeFileSync(`${outPrefix}.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); server.close(); }
