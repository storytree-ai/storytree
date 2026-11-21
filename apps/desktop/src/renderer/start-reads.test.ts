// Capability 2 · Storytree projects
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import { buildCapture, captureSeed, fakeBridge, withCapture } from "../capture/index.js";

const FIRST_DRAW_READS: readonly string[] = ["projectSelection", "readSurfaces", "projectTree", "changesSince", "linesStart", "codeSurvey"];
const READ_BESIDE_THE_DRAW: readonly string[] = ["factoryFolder", "readInstallChoice", "checkForUpdates", "readReleaseChannel", "readSignIn", "readJourney", "feedbackSetup", "projectSentence", "startMark", "ciTimes", "pins", "arcViews"];
const START_NAMES: readonly string[] = [...FIRST_DRAW_READS, ...READ_BESIDE_THE_DRAW];

const answeringOnly = (answered: readonly string[]): string => `(() => {
  const answered = ${JSON.stringify(answered)};
  const asked = [];
  window.storytreeStartAsks = asked;
  window.storytreeAnswers = new Proxy({}, { get: (_, method) => typeof method !== "string" ? undefined : (...args) => {
    const settled = document.body?.dataset.start === "settled";
    if (!settled) asked.push(method);
    if (!settled && !answered.includes(method)) return new Promise(() => {});
    return window.storytreeFakeBridge(method, args);
  } });
})();`;

test("2.67 · opening the app asks the library, before its start settles, only the reads the start names, and settles with every other read unanswered", { timeout: 600_000 }, async () => {
  const dist = mkdtempSync(path.join(tmpdir(), "storytree-start-reads-"));
  try {
    await buildCapture({ dist, entryPoints: [new URL("./renderer.ts", import.meta.url)] });
    const { seed } = captureSeed("forest");
    const bridge = fakeBridge({
      projectSelection: async () => ({ projects: seed.projects, current: seed.projects[0] }),
      listProjects: async () => seed.projects,
      projectTree: async () => seed.tree,
      changesSince: async (_, cursor) => cursor === 0 ? seed.changes : { changes: [], cursor: seed.changes.cursor },
      linesSince: async (_, cursor) => cursor === 0 ? seed.lines : { lines: [], cursor: seed.lines.cursor },
      frontCovers: async (_, id) => seed.covers[id] ?? [],
    });
    process.env.CAPTURE_CHANNEL ??= "chrome";
    await withCapture({ folder: dist, dist }, async ({ browser, origin }) => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, colorScheme: "dark" });
      await bridge.install(page);
      await page.addInitScript(answeringOnly(FIRST_DRAW_READS));
      const asked = async () => [...new Set(await page.evaluate(() => (window as unknown as { storytreeStartAsks: string[] }).storytreeStartAsks.slice()))];
      await page.goto(`${origin}/index.html`, { waitUntil: "domcontentloaded", timeout: 180_000 });
      const settled = await page.waitForFunction(() => document.body.dataset.start === "settled", undefined, { timeout: 120_000 }).then(() => true, () => false);
      const before = await asked();
      assert.ok(settled, `the start settles with only its first draw's reads answered; it stayed unsettled holding ${before.filter((method) => !FIRST_DRAW_READS.includes(method)).join(", ")} unanswered`);
      assert.equal(await page.evaluate(() => document.body.dataset.state), "ready", "the forest is drawn when the start settles");
      const outside = before.filter((method) => !START_NAMES.includes(method));
      assert.deepEqual(outside, [], `the start asked the library for reads it does not name before it settled: ${outside.join(", ")}`);
      await page.close();
    });
  } finally {
    await removeTemp(dist);
  }
});
