// Picture for increment_c0b7832e991c (contract 9.17): a fan-out session's row in the sessions list, its subagents' bars filled.
// The readings are real: this increment's own lane session and the two change-reviewer subagents it started, read on
// 2026-10-16 from the shared log by storedContextReading, the reading the app's contextReadings answers with. Only the
// lines placing the rows are written here. Run through `node "<checkout>/packages/dev-loop/src/heavy-lock.mjs" --`
// (absolute checkout path) with `node --import tsx`; --retake writes the picture into this folder.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapture, captureSeed, fakeBridge, withCapture } from '../../../../apps/desktop/src/capture/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, 'dist');
await buildCapture({ dist });
const { seed } = captureSeed('forest');
const parent = '70ff0b94-4da7-4c3e-ae0a-6bf082e4acfd';
const guidance = { value: 600_000, source: 'default', position: 'under' };
const readings = [
  { session: parent, tokens: 130_587, composition: { injected: 45_828, grounding: 24_381, implementation: 34_447, other: 23_305, unsorted: [], charsPerToken: 3.8 } },
  { session: 'a561f4e60aa1ea2ce', tokens: 49_162, composition: { injected: 33_383, grounding: 8_927, implementation: 7_928, other: 1_117, unsorted: [], charsPerToken: 3.8 } },
  { session: 'a1108fd6439a2a61a', tokens: 50_169, composition: { injected: 33_370, grounding: 15_096, implementation: 2_672, other: 1_099, unsorted: [], charsPerToken: 3.8 } },
].map(reading => ({ ...reading, harness: 'claude-code', guidance, at: '2026-10-16T06:00:00.000Z' }));
const now = Date.now();
const at = minutes => new Date(now - minutes * 60_000).toISOString();
const lines = [];
function line(minutes, fields) {
  lines.push({ project: 'storytree', source: 'hook', harness: 'claude-code', session: parent, seq: lines.length + 1, at: at(minutes), folder: '/home/me/code/storytree03', ...fields });
}
line(40, { kind: 'session-started' });
line(38, { kind: 'claimed', source: 'tool', increment: 'increment_c0b7832e991c', reason: 'Subagent context from own transcript' });
line(12, { kind: 'subagent-started', subagent: readings[1].session, type: 'change-reviewer', task: 'Review increment change' });
line(6, { kind: 'subagent-started', subagent: readings[2].session, type: 'change-reviewer', task: 'Second review of increment' });
line(1, { kind: 'prompt-submitted' });
seed.lines = { lines, cursor: lines.length };
seed.tree.arcs = [];

await withCapture({ folder: here, dist }, async ({ browser, origin, out }) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 2, colorScheme: 'dark' });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  const bridge = fakeBridge({});
  await bridge.install(page);
  await page.addInitScript(data => {
    const copy = value => structuredClone(value);
    window.storytreeAnswers = {
      projectSelection: async () => ({ projects: data.seed.projects, current: 'storytree' }),
      projectTree: async () => copy(data.seed.tree),
      changesSince: async (_, cursor) => ({ changes: [], cursor }),
      linesSince: async (_, cursor) => ({ lines: copy(data.seed.lines.lines.filter(item => item.seq > cursor)), cursor: data.seed.lines.cursor }),
      frontCovers: async () => [], relatedNotes: async () => [], arcView: async () => null, waitHolds: async () => [], heldOnQuestion: async () => [],
      contextReadings: async (_, sessions) => data.readings.filter(reading => sessions.includes(reading.session)),
      idleAfterMs: async () => 60 * 60_000,
      readSurfaces: async () => ({ ok: false }), holds: async () => [],
      windowReadings: async (_, sessions) => sessions.map(session => ({ session, at: new Date().toISOString(), absent: 'not read for this picture' })),
    };
  }, { seed, readings });
  await page.goto(`${origin}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.dataset.state === 'ready', null, { timeout: 15000 });
  const closeHelp = page.getByRole('button', { name: /^Close/ }).first();
  if (await closeHelp.isVisible()) await closeHelp.click();
  const list = page.getByRole('complementary', { name: 'Running sessions', exact: true });
  await list.locator(`.session-row[data-session-id="${parent}"]`).waitFor();
  const toggle = list.locator('.session-children-toggle').first();
  if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
  for (const { session } of readings) await list.locator(`.session-row[data-session-id="${session}"]`).waitFor();
  await page.waitForTimeout(12_000); // The list asks for readings every 10 seconds.
  await list.screenshot({ path: path.join(out, 'subagent-bars.png') });
  console.log(JSON.stringify({ errors, rows: await list.locator('.session-row').evaluateAll(rows => rows.map(row => row.innerText.replace(/\s+/g, ' ').slice(0, 160))) }, null, 1));
});
