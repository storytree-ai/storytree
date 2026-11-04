/** Capability 7 · Sessions list: a row's machine name, in Chrome with the list's own styles, shows only while the row has room for it. */
import { createElement } from "react";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright-core";
import { SessionsList } from "./sessions-list.js";
import type { SessionRow } from "../sessions-list/sessions-list.js";

const row: SessionRow = { id: "lane", label: "Session row labels where owner chose", agent: "Claude Code", state: "working", idle: false,
  lastSeenAt: "2026-11-04T12:00:00Z", totalTokens: 120_000, stories: [], worktrees: [], description: [], children: [], machine: "mint" };
const { machine: _, ...plain } = { ...row, id: "plain" };

/** With the list `width` wide: whether the machine is in sight inside its row, that row's name and context bar widths, and the name's width on the same row without a machine. */
type Fit = { machineShown: boolean; label: number; plainLabel: number; context: number };

test("7.13 a row's machine name shows beside its name while the row has room; on a narrow row it is the first thing dropped, before the name or the context bar are cut", async t => {
  // Chrome is installed on the three CI runner images; no browser download during tests.
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  const css = await readFile(path.join(import.meta.dirname, "styles.css"), "utf8");
  await page.setContent(`<style>${css}</style><div id="rail" style="width:384px;height:400px">${renderToStaticMarkup(createElement(SessionsList, { rows: [row, plain], onHighlight() {} }))}</div>`);
  const fit = (width: number): Promise<Fit> => page.evaluate(width => {
    document.querySelector<HTMLElement>("#rail")!.style.width = `${width}px`;
    // No named helper in here: the test runner's transform would name it with a function the page does not have.
    const [rowBox, machine, label, context, plainLabel] = [".session-row", ".session-machine", ".session-label", ".session-context-slot",
      '[data-session-id="plain"] .session-label'].map(selector => document.querySelector(selector)!.getBoundingClientRect());
    return { machineShown: machine!.width > 0 && machine!.top >= rowBox!.top && machine!.bottom <= rowBox!.bottom && machine!.right <= rowBox!.right,
      label: label!.width, plainLabel: plainLabel!.width, context: context!.width };
  }, width);
  const wide = await fit(384);
  assert.ok(wide.machineShown, "the rail at its widest has room for the machine");
  assert.ok(wide.label >= 100, `the name keeps its room beside it (${wide.label}px)`);
  const narrow = await fit(290);
  assert.equal(narrow.machineShown, false, "a narrow row drops the machine");
  assert.equal(narrow.label, narrow.plainLabel, "the name takes the room the machine gave up");
  assert.equal(narrow.context, wide.context, "the context bar is never cut");
  const anyWidth = await Promise.all([300, 320, 340, 360].map(fit));
  for (const each of anyWidth) assert.ok(!each.machineShown || each.label >= 100, `the machine shows only while the name keeps 100px (${each.label}px)`);
});

test("7.1, 7.13 a row working in two worktrees counts them by a number beside a small icon, so at the rail's default width its machine name still shows", async t => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  const css = await readFile(path.join(import.meta.dirname, "styles.css"), "utf8");
  // At the rail's default width (the app's RAIL_DEFAULT, 432px): a name of the longest a row runs (40 characters), a machine name like the laptop's, and a total.
  const trees: SessionRow = { ...row, label: "A session row counts its worktrees by a…", machine: "MicksMSpro", totalTokens: 412_000,
    worktrees: [{ path: "/code/storytree03/.claude/worktrees/one", branches: [] }, { path: "/code/storytree03/.claude/worktrees/two", branches: [] }] };
  await page.setContent(`<style>${css}</style><div style="width:432px;height:400px">${renderToStaticMarkup(createElement(SessionsList, { rows: [trees], onHighlight() {} }))}</div>`);
  const seen = await page.evaluate(() => {
    const [rowBox, machine] = [".session-row", ".session-machine"].map(selector => document.querySelector(selector)!.getBoundingClientRect());
    const badge = document.querySelector(".session-worktrees")!;
    return { machineShown: machine!.width > 0 && machine!.top >= rowBox!.top && machine!.bottom <= rowBox!.bottom && machine!.right <= rowBox!.right,
      text: badge.textContent, icon: badge.querySelector("svg") !== null, label: badge.getAttribute("aria-label"), title: badge.getAttribute("title") };
  });
  assert.ok(seen.machineShown, "the machine name shows beside the badge");
  assert.equal(seen.text, "2");
  assert.ok(seen.icon, "the number sits beside an icon");
  assert.equal(seen.label, "works in 2 worktrees");
  assert.equal(seen.title, "/code/storytree03/.claude/worktrees/one\n/code/storytree03/.claude/worktrees/two");
});
