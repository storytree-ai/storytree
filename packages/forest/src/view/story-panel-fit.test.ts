/** Capability 4 · Drill-down: a capability's contract rows, in Chrome with the panel's own styles, put their icons in one column. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { chromium } from "playwright-core";

import type { CapabilityLine, StoryPanel } from "@storytree/forest";

import { renderStoryPanel } from "./story-panel.js";

const short = (id: string, title: string): CapabilityLine["contracts"][number] => ({ id, title, reported: "passing", trail: "green only", gear: { state: "passing" } });
const capability: CapabilityLine = {
  id: "cap", title: "The cap", description: "What cap does.", reported: "passing", status: "healthy",
  contracts: [
    short("one-line", "6.1 · Saved"),
    short("wraps", "6.2 · A contract whose title runs long enough that it wraps onto a second line, and a third, in the panel's width"),
    { ...short("two-marks", "6.3 · Accepted"), acceptance: "passed" },
  ],
};
const panel: StoryPanel = { story: "s", title: "Story s", description: "What s is.", capabilities: [capability] };

test("4.53 every contract row's icons end at one right edge, whether its title fits one line or wraps", async t => {
  // Chrome is installed on the three CI runner images; no browser download during tests.
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  const css = await readFile(path.join(import.meta.dirname, "styles.css"), "utf8");
  await page.setContent(`<style>${css}</style><aside class="story-panel">${renderStoryPanel(panel, "cap")}</aside>`);
  const rows = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("li[data-contract-id]")].map(item => {
    const said = item.querySelector(".panel-contract-said")!.getBoundingClientRect();
    const marks = item.querySelector(".panel-marks")!.getBoundingClientRect();
    return { id: item.dataset.contractId!, height: Math.round(said.height), right: Math.round(marks.right), left: Math.round(marks.left), saidRight: Math.round(said.right) };
  }));
  const [one, wraps, two] = rows;
  assert.ok(wraps!.height > one!.height * 1.5, `the long title wraps (${JSON.stringify(wraps)})`);
  assert.equal(one!.right, wraps!.right, "a one-line title's icons end where a wrapping title's do");
  assert.equal(two!.right, wraps!.right, "a row with two icons ends there too");
  for (const each of rows) assert.ok(each.left >= each.saidRight, `the icons sit after the title, never over it (${JSON.stringify(each)})`);
});
