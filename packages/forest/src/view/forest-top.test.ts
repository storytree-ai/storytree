/** Capability 3 · Story node render: the lanes notice (3.103) and the open work's count (3.108) in the map's top row, in Chrome with the page's own styles. */
import { createElement } from "react";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright-core";
import { ForestTop } from "./forest-top.js";
import { sheetFaces } from "./globe-switches.js";
import { openWorkCount } from "./open-work.js";
import { CONCEPTS } from "@storytree/shown-words";

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

test("3.108 with an arc selected, the top row says how many capabilities and links its open work rings, a capability in the shown words' word (ADR-1322 D1), inside the band no nameplate opens in, left of the compass and an open panel", async t => {
  // The arc names part a; part b holds a contract it links; one edge holds a linked contract, the other none.
  const scene = { contracts: [{ capability: "b", contracts: ["c1"] }, { capability: "d", contracts: ["c9"] }],
    edges: [{ from: "s1", to: "s2", contracts: ["c2"] }, { from: "s2", to: "s3", contracts: ["c9"] }] };
  assert.deepEqual(openWorkCount(scene, ["a"], ["c1", "c2"]), { parts: 2, links: 1 });
  assert.deepEqual(openWorkCount(scene, [], []), { parts: 0, links: 0 });
  assert.equal(openWorkCount(scene, undefined, undefined), undefined, "no arc selected, no count");
  const caption = (rings: { parts: number; links: number } | undefined) => renderToStaticMarkup(createElement(ForestTop,
    { layers: sheetFaces("stories", true), onTurn() {}, islands: [], notice: undefined, aside: 0, rings }));
  assert.ok(!caption(undefined).includes("open work"), "with no arc selected there is no caption");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1008, height: 700 } });
  const css = await readFile(path.join(import.meta.dirname, "styles.css"), "utf8");
  for (const [faces, aside, rings, words] of [
    [sheetFaces("stories", true), 0, { parts: 3, links: 1 }, `The arc's open work rings 3 ${CONCEPTS.capability.many} and 1 link.`],
    [sheetFaces("stories", true), 492, { parts: 1, links: 2 }, `The arc's open work rings 1 ${CONCEPTS.capability.one} and 2 links.`],
    [sheetFaces("library", true), 492, { parts: 0, links: 0 }, `The arc's open work rings no ${CONCEPTS.capability.one} and no link.`],
  ] as const) {
    const top = renderToStaticMarkup(createElement(ForestTop, { layers: faces, onTurn() {}, islands: [], notice: undefined, aside, rings }));
    const compass = `<button class="planet-mini-globe" style="margin-right:${aside}px"><svg width="64" height="64"></svg></button>`;
    await page.setContent(`<style>${css}</style><div class="forest" style="width:1008px;height:700px">${top}${compass}</div>`);
    const seen = await page.evaluate(() => {
      const count = document.querySelector<HTMLElement>(".forest-open-work")!;
      const box = count.getBoundingClientRect(), compassBox = document.querySelector(".planet-mini-globe")!.getBoundingClientRect();
      return { text: count.textContent, whole: count.scrollWidth <= count.clientWidth && count.scrollHeight <= count.clientHeight,
        right: box.right, bottom: box.bottom, compassLeft: compassBox.left };
    });
    const at = `${faces.mode}, panel ${aside}px`;
    assert.equal(seen.text, words, at);
    assert.ok(seen.whole, `its words are not cut (${at})`);
    assert.ok(seen.bottom <= CLEAR_TOP, `it stays in the top band, its bottom at ${seen.bottom}px (${at})`);
    assert.ok(seen.right < seen.compassLeft, `it ends left of the compass (${at})`);
    assert.ok(seen.right <= 1008 - aside, `it ends left of the panel (${at})`);
  }
});
