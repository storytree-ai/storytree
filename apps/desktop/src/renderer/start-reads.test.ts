// Capability 2 · Storytree projects
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import type { Page } from "playwright-core";

import { removeTemp } from "@storytree/test-waits";

import { buildCapture, captureSeed, fakeBridge, withCapture } from "../capture/index.js";
import type { FakeBridge } from "../capture/index.js";
import type { StorytreeBridge } from "../bridge.js";

const FIRST_DRAW_READS: readonly string[] = ["projectSelection", "readSurfaces", "projectTree", "changesSince", "linesStart", "codeSurvey"];
const READ_BESIDE_THE_DRAW: readonly string[] = ["factoryFolder", "readInstallChoice", "checkForUpdates", "readReleaseChannel", "readSignIn", "readJourney", "feedbackSetup", "projectSentence", "startMark", "ciTimes", "pins", "arcViews"];
const START_NAMES: readonly string[] = [...FIRST_DRAW_READS, ...READ_BESIDE_THE_DRAW];
const WARM_FIRST_DRAW_READS: readonly string[] = [...FIRST_DRAW_READS, "linesSince"];
const WARM_START_NAMES: readonly string[] = [...WARM_FIRST_DRAW_READS, ...READ_BESIDE_THE_DRAW];

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

type Lines = Awaited<ReturnType<StorytreeBridge["linesSince"]>>;

let dist: string;

before(async () => {
  dist = mkdtempSync(path.join(tmpdir(), "storytree-start-reads-"));
  await buildCapture({ dist, entryPoints: [new URL("./renderer.ts", import.meta.url)] });
  process.env.CAPTURE_CHANNEL ??= "chrome";
}, { timeout: 600_000 });

after(async () => {
  await removeTemp(dist);
});

function forestBridge(lines?: Lines): { bridge: FakeBridge; project: string } {
  const { seed } = captureSeed("forest");
  const told = lines ?? seed.lines;
  const bridge = fakeBridge({
    projectSelection: async () => ({ projects: seed.projects, current: seed.projects[0] }),
    listProjects: async () => seed.projects,
    projectTree: async () => seed.tree,
    changesSince: async (_, cursor) => cursor === 0 ? seed.changes : { changes: [], cursor: seed.changes.cursor },
    linesSince: async (_, cursor) => cursor === 0 ? told : { lines: [], cursor: told.cursor },
    frontCovers: async (_, id) => seed.covers[id] ?? [],
  });
  return { bridge, project: seed.projects[0]! };
}

async function startAsksOnlyItsNames(page: Page, origin: string, firstDraw: readonly string[], names: readonly string[]): Promise<void> {
  await page.addInitScript(answeringOnly(firstDraw));
  const asked = async () => [...new Set(await page.evaluate(() => (window as unknown as { storytreeStartAsks: string[] }).storytreeStartAsks.slice()))];
  await page.goto(`${origin}/index.html`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  const settled = await page.waitForFunction(() => document.body.dataset.start === "settled", undefined, { timeout: 120_000 }).then(() => true, () => false);
  const before = await asked();
  assert.ok(settled, `the start settles with only its first draw's reads answered; it stayed unsettled holding ${before.filter((method) => !firstDraw.includes(method)).join(", ")} unanswered`);
  assert.equal(await page.evaluate(() => document.body.dataset.state), "ready", "the forest is drawn when the start settles");
  const outside = before.filter((method) => !names.includes(method));
  assert.deepEqual(outside, [], `the start asked the library for reads it does not name before it settled: ${outside.join(", ")}`);
}

test("2.67 · opening the app asks the library, before its start settles, only the reads the start names, and settles with every other read unanswered", { timeout: 600_000 }, async () => {
  const { bridge } = forestBridge();
  await withCapture({ folder: dist, dist }, async ({ browser, origin }) => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, colorScheme: "dark" });
    await bridge.install(page);
    await startAsksOnlyItsNames(page, origin!, FIRST_DRAW_READS, START_NAMES);
    await page.close();
  });
});

test("2.67 · opening the app again after a start kept its tree, drawing, page reading and session rows asks, before its start settles, only the reads the start names, and settles with every other read unanswered", { timeout: 600_000 }, async () => {
  const { seed } = captureSeed("forest");
  const project = seed.projects[0]!;
  const lines: Lines = { lines: [{ project, seq: 1, at: new Date().toISOString(), session: "warm-session", harness: "claude-code", source: "hook", kind: "session-started" }], cursor: 1 };
  const { bridge } = forestBridge(lines);
  await withCapture({ folder: dist, dist }, async ({ browser, origin }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, colorScheme: "dark" });
    const first = await context.newPage();
    await bridge.install(first);
    await first.goto(`${origin}/index.html`, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await first.waitForFunction((project) => {
      const page = window as unknown as { storytreeKeptPieces?: number; storytreeCounting?: boolean };
      if (document.body.dataset.start !== "settled") return false;
      const rows: unknown = JSON.parse(localStorage.getItem(`storytree.forest.sessions.v1:${project}`) ?? "null");
      if (!Array.isArray(rows) || rows.length === 0) return false;
      if (localStorage.getItem(`storytree.forest.tree.v1:${project}`) === null || localStorage.getItem(`storytree.forest.drawing.v1:${project}`) === null) return false;
      if ((page.storytreeKeptPieces ?? 0) > 0) return true;
      if (page.storytreeCounting === true) return false;
      page.storytreeCounting = true;
      void indexedDB.databases().then(async (databases) => {
        if (!databases.some(({ name }) => name === "storytree.kept-readings")) return 0;
        const database = await new Promise<IDBDatabase>((resolve, reject) => { const asked = indexedDB.open("storytree.kept-readings"); asked.onsuccess = () => resolve(asked.result); asked.onerror = () => reject(asked.error); });
        try {
          if (!database.objectStoreNames.contains("pieces")) return 0;
          return await new Promise<number>((resolve, reject) => { const asked = database.transaction("pieces").objectStore("pieces").index("reading").count(`storytree.page-reading.v1:${project}`); asked.onsuccess = () => resolve(asked.result); asked.onerror = () => reject(asked.error); });
        } finally { database.close(); }
      }).then((count) => { page.storytreeKeptPieces = count; }, () => {}).finally(() => { page.storytreeCounting = false; });
      return false;
    }, project, { timeout: 120_000, polling: 250 });
    const kept = await first.evaluate((project) => JSON.parse(localStorage.getItem(`storytree.forest.sessions.v1:${project}`) ?? "null") as { id: string }[], project);
    assert.deepEqual(kept.map(({ id }) => id), ["warm-session"], "the first start kept the sessions list's rows, so the warm start mounts holding them");
    await first.close();
    const again = await context.newPage();
    await bridge.install(again);
    await startAsksOnlyItsNames(again, origin!, WARM_FIRST_DRAW_READS, WARM_START_NAMES);
    await again.close();
    await context.close();
  });
});
