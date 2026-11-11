/** Capability 3 · Story node render: the lanes notice in the map's top row, in Chrome with the page's own styles (3.103). */
import { createElement } from "react";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright-core";
import { ForestTop } from "./forest-top.js";
import { sheetFaces } from "./globe-switches.js";

const notice = { text: "Some lanes could not be drawn. Island health and selection are still available.", issue: "the router gave up" };
/** The band at the sheet's top its opening keeps clear of nameplates (sheet-navigation's CLEAR_TOP). */
const CLEAR_TOP = 85;

test("3.103 the lanes notice sits in the map's top row, inside the band no nameplate opens in, whole, and left of the compass and of an open story panel", async t => {
  // Chrome is installed on the three CI runner images; no browser download during tests.
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1008, height: 700 } });
  const css = await readFile(path.join(import.meta.dirname, "styles.css"), "utf8");
  for (const [faces, aside] of [[sheetFaces("stories", true), 0], [sheetFaces("stories", true), 492], [sheetFaces("library", true), 492]] as const) {
    const top = renderToStaticMarkup(createElement(ForestTop, { layers: faces, onTurn() {}, islands: [], notice, aside }));
    // The compass as planet-view draws it: 64px, moved aside by the panel's width.
    const compass = `<button class="planet-mini-globe" style="margin-right:${aside}px"><svg width="64" height="64"></svg></button>`;
    await page.setContent(`<style>${css}</style><div class="forest" style="width:1008px;height:700px">${top}${compass}</div>`);
    const seen = await page.evaluate(() => {
      const alert = document.querySelector<HTMLElement>('[role="alert"]')!;
      const box = alert.getBoundingClientRect(), compassBox = document.querySelector(".planet-mini-globe")!.getBoundingClientRect();
      return { text: alert.textContent, whole: alert.scrollWidth <= alert.clientWidth && alert.scrollHeight <= alert.clientHeight,
        left: box.left, right: box.right, bottom: box.bottom, compassLeft: compassBox.left };
    });
    const at = `${faces.mode}, panel ${aside}px`;
    assert.equal(seen.text, notice.text, at);
    assert.ok(seen.whole, `its words are not cut (${at})`);
    assert.ok(seen.bottom <= CLEAR_TOP, `it stays in the top band, its bottom at ${seen.bottom}px (${at})`);
    assert.ok(seen.right < seen.compassLeft, `it ends left of the compass, at ${seen.right}px against ${seen.compassLeft}px (${at})`);
    assert.ok(seen.right <= 1008 - aside, `it ends left of the panel (${at})`);
  }
});
