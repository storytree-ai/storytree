/** Capability 3 · Story node render: the real forest view, in Chrome, says when it has painted the scene on show (3.75), and
 * draws an arc's open work on an edge's contracts, and none, without a fault (3.92), and says why a map read with no stories is
 * empty (3.107). */
import assert from "node:assert/strict";
import path from "node:path";
import { after, test } from "node:test";
import { build } from "esbuild";
import { chromium, type Browser, type BrowserServer } from "playwright-core";
import { endChrome } from "./end-chrome.js";
import { scaled } from "@storytree/test-waits";

/** The forest view opened on a two-story plan, the first's two capabilities joined by an edge holding a contract; `__show()`
 * hands it the plan again, `__showEmpty()` a read with no stories, `__guided` counts its first-run guide opened, `__circle(capabilities, contracts)` is its circle(), and `__drawn(ms)` is its drawn(), given up after `ms`. */
function viewBundle(): Promise<string> {
  return bundled ??= bundleView();
}
let bundled: Promise<string> | undefined;

async function bundleView(): Promise<string> {
  const entry = `import { workStates } from "@storytree/arc-surface";
    import { createKnowledgeCore } from "@storytree/knowledge-core/view";
    import { forestScene, storyNodes } from ${JSON.stringify(path.join(import.meta.dirname, "../index.ts"))};
    import { openForestView } from ${JSON.stringify(path.join(import.meta.dirname, "forest-view.tsx"))};
    const health = { reported: { state: "passing" }, verified: { state: "passing" } };
    const capability = id => ({ id: id + "-cap", title: "1 · " + id, dependsOn: [], proposed: false, status: "healthy", contracts: [], health });
    const plan = { arcs: [], stories: ["one", "two"].map(id => ({ id, title: id, health, capabilities: [capability(id)] })) };
    plan.stories[0].capabilities.push({ ...capability("one-next"), dependsOn: ["one-cap"] });
    plan.stories[0].edges = [{ id: "edge-1", from: "one-next-cap", to: "one-cap", contracts: [{ id: "contract_edge", title: "next asks one by id", health }] }];
    const history = ["one", "two"].map((id, index) => ({ seq: index + 1, recordId: id, type: "story", action: "created",
      record: { id, type: "story", version: 1, fields: { title: id }, createdAt: new Date(index).toISOString(), updatedAt: new Date(index).toISOString() } }));
    const places = new Map(storyNodes(plan, history).map(node => [node.id, node.place]));
    globalThis.__painted = 0;
    globalThis.__guided = 0;
    openForestView(document.querySelector("#map"), () => {}, createKnowledgeCore("app"), { library: false, openGuide: () => { globalThis.__guided++; } }).then(view => {
      globalThis.__show = () => view.show(forestScene(plan, history, workStates([])), places);
      globalThis.__showEmpty = () => view.show({ islands: [] }, new Map());
      globalThis.__circle = (capabilities, contracts) => view.circle(capabilities, contracts);
      globalThis.__drawn = ms => Promise.race([view.drawn().then(() => { globalThis.__painted++; }),
        new Promise((_, no) => setTimeout(() => no(new Error("the globe said nothing of its frame in " + ms / 1000 + " s")), ms))]);
      globalThis.__ready = true;
    });`;
  const result = await build({
    stdin: { contents: entry, resolveDir: import.meta.dirname, loader: "js" }, bundle: true, write: false, format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' }, loader: { ".glb": "binary", ".css": "empty" },
  });
  return result.outputFiles[0]!.text;
}

/** One browser for the file, launched on first use; each test opens its page in a context of its own. */
let server: Promise<BrowserServer> | undefined;
let launched: Promise<Browser> | undefined;
// Ended without waiting on Chrome's pipes, which a loaded Windows runner left open after the last test, so the file never exited
// (PR #695, then PR #720 when awaiting the server's kill hung the same way; 3.100).
after(async () => { endChrome(await server, await launched); });
async function freshPage(t: { after(run: () => Promise<void>): void }) {
  // Chrome is installed on the three CI runner images; no browser download during tests.
  server ??= chromium.launchServer({ channel: "chrome", headless: true });
  launched ??= server.then(running => chromium.connect(running.wsEndpoint()));
  const page = await (await launched).newPage({ viewport: { width: 800, height: 600 } });
  t.after(() => page.context().close());
  return page;
}

type Page = { __show(): void; __showEmpty(): void; __guided: number; __circle(capabilities: string[] | undefined, contracts: string[] | undefined): void; __drawn(ms: number): Promise<void>; __painted: number; __ready?: boolean };

test("3.75 · the globe says when it has painted a frame of the scene on show, including a show that changed nothing", async t => {
  const page = await freshPage(t);
  await page.setContent(`<div id="map" style="position:fixed;inset:0"></div>`);
  await page.addScriptTag({ content: await viewBundle() });
  await page.waitForFunction(() => (window as unknown as Page).__ready === true, undefined, { timeout: 60_000 });
  // A loaded Windows runner paints its first frame in software, slower than Linux by the environment's factor (ADR-1156).
  const frame = scaled(20_000);
  await page.evaluate(ms => { const win = window as unknown as Page; win.__show(); return win.__drawn(ms); }, frame);
  assert.ok(await page.evaluate(() => document.querySelector("#map canvas") !== null), "the globe is on the page once its scene is drawn");
  // The same plan again is a scene equal to the one on show: it is drawn as soon as that one's frame is.
  await page.evaluate(ms => { const win = window as unknown as Page; win.__show(); return win.__drawn(ms); }, frame);
  assert.equal(await page.evaluate(() => (window as unknown as Page).__painted), 2);
});

test("3.92 · the forest view draws an arc's open work on an edge's contracts, and no arc, without a fault", async t => {
  const page = await freshPage(t);
  const faults: string[] = [];
  page.on("pageerror", error => faults.push(error.message));
  await page.setContent(`<div id="map" style="position:fixed;inset:0"></div>`);
  await page.addScriptTag({ content: await viewBundle() });
  await page.waitForFunction(() => (window as unknown as Page).__ready === true, undefined, { timeout: 60_000 });
  const frame = scaled(20_000);
  await page.evaluate(ms => { const win = window as unknown as Page; win.__show(); return win.__drawn(ms); }, frame);
  for (const [capabilities, contracts] of [[[], ["contract_edge"]], [undefined, undefined]] as const) {
    await page.evaluate(([given, ms]) => { const win = window as unknown as Page; win.__circle(given[0], given[1]); win.__show(); return win.__drawn(ms); },
      [[capabilities === undefined ? undefined : [...capabilities], contracts === undefined ? undefined : [...contracts]], frame] as const);
  }
  assert.deepEqual(faults, [], "the page drew both with no error");
  assert.ok(await page.evaluate(() => document.querySelector("#map canvas") !== null));
});

test("3.107 · the map says why it is empty once a read finds no stories, its button opens the first-run guide, and it goes when stories arrive", async t => {
  const page = await freshPage(t);
  await page.setContent(`<div id="map" style="position:fixed;inset:0"></div>`);
  // The forest's own stylesheet, as the app loads it: the box is placed over the canvas by it.
  await page.addStyleTag({ path: path.join(import.meta.dirname, "styles.css") });
  await page.addScriptTag({ content: await viewBundle() });
  await page.waitForFunction(() => (window as unknown as Page).__ready === true, undefined, { timeout: 60_000 });
  const box = page.locator("#map .forest-empty-map");
  await page.waitForFunction(() => document.querySelector("#map .forest-views") !== null, undefined, { timeout: 60_000 });
  assert.equal(await box.count(), 0, "nothing before the project is read");
  await page.evaluate(ms => { const win = window as unknown as Page; win.__showEmpty(); return win.__drawn(ms); }, scaled(20_000));
  await box.waitFor({ timeout: 10_000 });
  assert.match(await box.innerText(), /Nothing on the map yet/);
  if (process.env.STORYTREE_EMPTY_MAP_PICTURE) await page.screenshot({ path: process.env.STORYTREE_EMPTY_MAP_PICTURE });
  await box.getByRole("button", { name: "First-run guide" }).click();
  assert.equal(await page.evaluate(() => (window as unknown as Page).__guided), 1, "the button opens the guide");
  await page.evaluate(ms => { const win = window as unknown as Page; win.__show(); return win.__drawn(ms); }, scaled(20_000));
  assert.equal(await box.count(), 0, "gone once stories are on the map");
});
