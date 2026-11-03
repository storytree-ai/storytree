/** Capability 3 · Story node render: the real forest view, in Chrome, says when it has painted the scene on show. */
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright-core";

/** The forest view opened on a two-story plan; `__show()` hands it the plan again and `__drawn()` is its drawn(). */
async function viewBundle(): Promise<string> {
  const entry = `import { workStates } from "@storytree/arc-surface";
    import { createKnowledgeCore } from "@storytree/knowledge-core/view";
    import { forestScene, storyNodes } from ${JSON.stringify(path.join(import.meta.dirname, "../index.ts"))};
    import { openForestView } from ${JSON.stringify(path.join(import.meta.dirname, "forest-view.tsx"))};
    const health = { reported: { state: "passing" }, verified: { state: "passing" } };
    const capability = id => ({ id: id + "-cap", title: "1 · " + id, dependsOn: [], proposed: false, status: "healthy", contracts: [], health });
    const plan = { arcs: [], stories: ["one", "two"].map(id => ({ id, title: id, health, capabilities: [capability(id)] })) };
    const history = ["one", "two"].map((id, index) => ({ seq: index + 1, recordId: id, type: "story", action: "created",
      record: { id, type: "story", version: 1, fields: { title: id }, createdAt: new Date(index).toISOString(), updatedAt: new Date(index).toISOString() } }));
    const places = new Map(storyNodes(plan, history).map(node => [node.id, node.place]));
    globalThis.__painted = 0;
    openForestView(document.querySelector("#map"), () => {}, createKnowledgeCore("app"), { library: false }).then(view => {
      globalThis.__show = () => view.show(forestScene(plan, history, workStates([])), places);
      globalThis.__drawn = () => Promise.race([view.drawn().then(() => { globalThis.__painted++; }),
        new Promise((_, no) => setTimeout(() => no(new Error("the globe said nothing of its frame in 20 s")), 20_000))]);
      globalThis.__ready = true;
    });`;
  const result = await build({
    stdin: { contents: entry, resolveDir: import.meta.dirname, loader: "js" }, bundle: true, write: false, format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' }, loader: { ".glb": "binary", ".css": "empty" },
  });
  return result.outputFiles[0]!.text;
}

type Page = { __show(): void; __drawn(): Promise<void>; __painted: number; __ready?: boolean };

test("3.75 · the globe says when it has painted a frame of the scene on show, including a show that changed nothing", async t => {
  // Chrome is installed on the three CI runner images; no browser download during tests.
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.setContent(`<div id="map" style="position:fixed;inset:0"></div>`);
  await page.addScriptTag({ content: await viewBundle() });
  await page.waitForFunction(() => (window as unknown as Page).__ready === true, undefined, { timeout: 60_000 });
  await page.evaluate(() => { const win = window as unknown as Page; win.__show(); return win.__drawn(); });
  assert.ok(await page.evaluate(() => document.querySelector("#map canvas") !== null), "the globe is on the page once its scene is drawn");
  // The same plan again is a scene equal to the one on show: it is drawn as soon as that one's frame is.
  await page.evaluate(() => { const win = window as unknown as Page; win.__show(); return win.__drawn(); });
  assert.equal(await page.evaluate(() => (window as unknown as Page).__painted), 2);
});
