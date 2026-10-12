// Opening the app shows a bar until the globe is settled (increment_5ea28f356e00, 7.31): the desktop page on storytree's own
// library snapshot over the stand-in bridge, its code survey held back, so the start is caught settling (the fresh tree drawn, the
// survey still coming, the bar along the window's top), then let through, so it is caught settled (the bar gone).
//   node --import tsx apps/desktop/evidence/start-progress/capture.mjs [--retake]
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildCapture, captureOutput, captureSeed, fakeBridge, withCapture } from "../../src/capture/index.js";

const folder = path.dirname(fileURLToPath(import.meta.url));
const out = captureOutput(folder);
const dist = mkdtempSync(path.join(tmpdir(), "start-progress-page-"));
const { seed, survey } = captureSeed("code-rows");
let land = () => {};
const surveyed = new Promise((resolve) => { land = resolve; });
const bridge = fakeBridge({
  projectSelection: async () => ({ projects: seed.projects, current: seed.projects[0] }),
  listProjects: async () => seed.projects,
  projectTree: async () => seed.tree,
  changesSince: async (_, cursor) => (cursor === 0 ? seed.changes : { changes: [], cursor: seed.changes.cursor }),
  linesSince: async (_, cursor) => (cursor === 0 ? seed.lines : { lines: [], cursor: seed.lines.cursor }),
  frontCovers: async (_, id) => seed.covers[id] ?? [],
  codeSurvey: async () => { await surveyed; return survey; },
});
await buildCapture({ dist });
await withCapture({ folder: out, dist }, async ({ browser, origin, settle }) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, colorScheme: "dark" });
  await bridge.install(page);
  await page.goto(`${origin}/index.html?lag-recorder=off`, { waitUntil: "domcontentloaded" });
  const mark = () => page.evaluate(() => ({ state: document.body.dataset.state, start: document.body.dataset.start,
    bar: !document.getElementById("start-progress").hidden }));
  await page.waitForFunction(() => document.body.dataset.state === "ready", null, { timeout: 180_000 });
  await settle(page);
  const settling = await mark();
  assert.deepEqual(settling, { state: "ready", start: "settling", bar: true }, "the fresh tree is drawn and the survey is still coming");
  await page.screenshot({ path: path.join(out, "1-settling.png") });
  await page.screenshot({ path: path.join(out, "1b-settling-top.png"), clip: { x: 0, y: 0, width: 1440, height: 120 } });
  land();
  await page.waitForFunction(() => document.body.dataset.start === "settled", null, { timeout: 180_000 });
  await settle(page);
  const settled = await mark();
  assert.deepEqual(settled, { state: "ready", start: "settled", bar: false });
  await page.screenshot({ path: path.join(out, "2-settled.png") });
  await page.screenshot({ path: path.join(out, "2b-settled-top.png"), clip: { x: 0, y: 0, width: 1440, height: 120 } });
  console.log(JSON.stringify({ settling, settled }));
});
