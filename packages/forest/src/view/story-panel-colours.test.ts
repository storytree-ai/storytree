/** Capability 4 · Drill-down: the selected capability's word, in Chrome with the forest's own styles, draws in its status's colour. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { chromium } from "playwright-core";

import type { CapabilityLine, StoryPanel } from "@storytree/forest";

import { renderStoryPanel } from "./story-panel.js";

const statuses = ["proposed", "healthy", "unhealthy", "untested"] as const satisfies readonly CapabilityLine["status"][];

function panelFor(status: CapabilityLine["status"]): StoryPanel {
  return { story: "s", title: "Story s", description: "What s is.",
    capabilities: [{ id: status, title: `The ${status}`, description: "What it does.", reported: "passing", status, contracts: [] }] };
}

/** A light host's palette, as the desktop's own light theme gives it; the dark one is the forest's opt-in `data-theme="dark"`. */
const lightHost = "--surface:#ffffff;--text:#1d1f23;--muted:#5d636d;--pass-text:#146c2e;--fail-text:#a61b1b;--none-text:#4e545d";

/** WCAG contrast of two `rgb(r, g, b)` colours. */
function contrast(a: string, b: string): number {
  const luminance = (rgb: string): number => {
    const [r, g, bl] = rgb.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number).map(c => c / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

test("4.43 the capability selected's word draws in its own colour, each status apart from the others and from the panel's grey, readable on the panel in light and dark", async t => {
  // Chrome is installed on the three CI runner images; no browser download during tests.
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  const css = await readFile(path.join(import.meta.dirname, "styles.css"), "utf8");
  for (const [theme, attributes] of [["light", `style="${lightHost}"`], ["dark", `data-theme="dark"`]] as const) {
    const panels = statuses.map(status => `<div class="story-panel" data-status="${status}">${renderStoryPanel(panelFor(status), status)}</div>`).join("");
    await page.setContent(`<style>${css}</style><div class="forest-workspace" ${attributes}>${panels}</div>`);
    const seen = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".story-panel")].map(panel => {
      const word = panel.querySelector<HTMLElement>(".panel-state")!;
      const muted = document.createElement("span");
      muted.className = "panel-muted";
      panel.append(muted);
      return { status: panel.dataset.status!, word: getComputedStyle(word).color, muted: getComputedStyle(muted).color, surface: getComputedStyle(panel).backgroundColor };
    }));
    assert.deepEqual(seen.map(each => each.status), [...statuses], `${theme}: every status draws its word`);
    assert.equal(new Set(seen.map(each => each.word)).size, statuses.length, `${theme}: four statuses, four colours (${seen.map(each => `${each.status} ${each.word}`).join(", ")})`);
    for (const each of seen) {
      assert.notEqual(each.word, each.muted, `${theme}: ${each.status} is not the panel's inherited grey`);
      assert.ok(contrast(each.word, each.surface) >= 4.5, `${theme}: ${each.status} (${each.word}) is readable on the panel (${each.surface}): ${contrast(each.word, each.surface).toFixed(2)}`);
    }
  }
});
