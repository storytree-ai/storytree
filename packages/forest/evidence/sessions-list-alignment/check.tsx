// Bounded browser check for increment_8935a131987d: every row's context bar and total share one column.
// Renders the real SessionsList with the forest stylesheet in Chromium, with rows of differing labels and badges,
// at desktop and narrow widths. Run from packages/forest: node --import tsx evidence/sessions-list-alignment/check.tsx
// (PLANET_PLAYWRIGHT locates playwright-core, PLANET_CHROMIUM a Chromium binary).
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionsList } from "../../src/view/sessions-list.js";
import type { SessionRow } from "../../src/sessions-list/sessions-list.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.join(here, "../../src/view/styles.css"), "utf8");
const base = { agent: "Claude Code", state: "active", needsYou: false, totalTokens: undefined,
  stories: [], files: [], offPlan: [], children: [] } as unknown as SessionRow;
const rows: SessionRow[] = [
  { ...base, id: "short", label: "Fix" },
  { ...base, id: "long", label: "Build the running sessions list and its context bar for the owner's look", totalTokens: 412_000 },
  { ...base, id: "badges", label: "Hosted library: a library location setting and Cloud SQL support", needsYou: true, children: [{ ...base, id: "lane", label: "Lane" }],
    files: ["a.ts", "b.ts"], offPlan: [{ at: new Date(0).toISOString(), files: ["a.ts", "b.ts"] }] } as SessionRow,
  { ...base, id: "needs", label: "Wisps orbit their islands", needsYou: true, totalTokens: 1_200_000 },
];
const html = renderToStaticMarkup(createElement(SessionsList, { rows, onHighlight() {} }));
const playwright = process.env.PLANET_PLAYWRIGHT
  ?? "C:/code/storytree/node_modules/.pnpm/playwright-core@1.60.0/node_modules/playwright-core/index.mjs";
const { chromium } = await import(pathToFileURL(playwright).href);
const browser = await chromium.launch({ executablePath: process.env.PLANET_CHROMIUM, headless: true });
const results: Record<string, unknown> = {};
try {
  for (const width of [1440, 420]) {
    const page = await browser.newPage({ viewport: { width, height: 700 }, colorScheme: "dark" });
    await page.setContent(`<style>${css}</style><body style="margin:0;background:#101518;height:700px">${html}</body>`);
    const edges: { id: string; slotLeft: number; slotWidth: number; totalRight: number }[] =
      await page.$$eval(".session-row", (list: HTMLElement[]) => list.map(row => {
        const slot = row.querySelector(".session-context-slot")!.getBoundingClientRect();
        const total = row.querySelector(".session-total")!.getBoundingClientRect();
        return { id: row.dataset.sessionId!, slotLeft: Math.round(slot.left), slotWidth: Math.round(slot.width), totalRight: Math.round(total.right) };
      }));
    const box = await page.$eval(".sessions-list", (el: HTMLElement) => {
      const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    await page.screenshot({ path: path.join(here, `rows-${width}.png`), clip: box });
    results[width] = edges;
    await page.close();
    assert.equal(new Set(edges.map(e => e.slotLeft)).size, 1, `bars start at different x at ${width}px: ${JSON.stringify(edges)}`);
    assert.equal(new Set(edges.map(e => e.totalRight)).size, 1, `totals end at different x at ${width}px: ${JSON.stringify(edges)}`);
    assert.ok(edges.every(e => e.slotWidth > 0), `a bar collapsed at ${width}px`);
  }
} finally {
  writeFileSync(path.join(here, "edges.json"), JSON.stringify(results, null, 2) + "\n");
  await browser.close();
}
console.log("aligned", JSON.stringify(results));
