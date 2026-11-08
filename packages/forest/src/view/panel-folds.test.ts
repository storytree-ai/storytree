/**
 * Capability 4 · Drill-down: the panel's folds as the user works them (ADR-1287, narrowing ADR-1284 D1). A single click on
 * a handle opens its fold and another closes it; the keyboard opens, moves and closes; the kinds the user opened
 * stay open on later picks until Escape with no fold focused. Read in happy-dom, as the page would draw it.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Window } from "happy-dom";

import type { CapabilityLine, StoryPanel } from "@storytree/forest";

import { panelFolds } from "./panel-folds.js";
import { renderStoryPanel } from "./story-panel.js";

const capability = (id: string): CapabilityLine => ({
  id,
  title: `The ${id}`,
  description: `What ${id} does.\n\nHow ${id} works.`,
  reported: "passing",
  status: "healthy",
  contracts: [{ id: `${id}-k`, title: `${id} keeps its promise`, reported: "passing", trail: "green only" }],
  openWork: [{ increment: `${id}-i`, title: `Work on ${id}` }],
});

const story: StoryPanel = { story: "s", title: "Story s", description: "What s is.\n\nWhy it is.", capabilities: [capability("one"), capability("two")] };

function page() {
  const window = new Window();
  const host = window.document.createElement("aside") as unknown as HTMLElement;
  window.document.body.appendChild(host as never);
  const folds = panelFolds();
  /** Draw the panel for `selected` as the page does: its HTML, then its folds. */
  const draw = (selected: string): void => {
    host.innerHTML = renderStoryPanel(story, selected);
    folds.draw(host);
  };
  const handle = (kind: string, nth = 0): HTMLButtonElement => [...host.querySelectorAll<HTMLButtonElement>(`[data-fold="${kind}"] > .panel-handle`)][nth]!;
  const open = (kind: string, nth = 0): boolean => {
    const button = handle(kind, nth);
    const body = button.nextElementSibling as HTMLElement;
    assert.equal(button.getAttribute("aria-expanded") === "true", !body.hidden, "the handle says what its fold shows");
    return !body.hidden;
  };
  const mouse = (target: Element, type: "click"): void => {
    target.dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true, detail: 1 }) as unknown as Event);
  };
  const key = (target: Element, name: string): KeyboardEvent => {
    const event = new window.KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }) as unknown as KeyboardEvent;
    target.dispatchEvent(event);
    return event;
  };
  const focused = (): Element | null => window.document.activeElement as unknown as Element | null;
  return { window, host, draw, handle, open, mouse, key, focused };
}

test("4.41 a single click on a handle opens its fold and another closes it", () => {
  const { draw, handle, open, mouse } = page();
  draw("one");
  assert.equal(open("contracts"), false, "every fold starts closed");
  mouse(handle("contracts"), "click");
  assert.equal(open("contracts"), true, "a single click opens it");
  mouse(handle("contracts"), "click");
  assert.equal(open("contracts"), false, "another closes it");
  mouse(handle("contracts"), "click");
  mouse(handle("contract"), "click");
  assert.equal(open("contract"), true, "a contract opens, one level deeper, to its own detail");
});

test("4.41 from the keyboard, Enter or Space opens a handle's fold, the arrow keys move between the handles shown, and Escape closes the fold the focus is in", () => {
  const { draw, handle, open, key, focused } = page();
  draw("one");
  handle("more").focus();
  assert.ok(key(handle("more"), "Enter").defaultPrevented);
  assert.equal(open("more"), true, "Enter opens it");
  key(handle("more"), " ");
  assert.equal(open("more"), false, "Space closes it again");
  key(handle("more"), "ArrowDown");
  assert.ok(focused() === handle("more", 1), "down moves to the next handle shown");
  key(focused()!, "ArrowDown");
  assert.ok(focused() === handle("health"), "past the story's own to the capability's");
  key(focused()!, "ArrowDown");
  assert.ok(focused() === handle("open-work"));
  key(focused()!, "ArrowDown");
  key(focused()!, "ArrowDown");
  assert.equal(focused()?.textContent, "Open all · 6", "a closed fold's handles are skipped: the contract's is not shown");
  key(focused()!, "ArrowUp");
  assert.ok(focused() === handle("contracts"), "up moves back");
  key(handle("contracts"), "Enter");
  handle("contract").focus();
  key(handle("contract"), "Escape");
  assert.equal(open("contracts"), false, "Escape closes the fold the focus is in");
  assert.ok(focused() === handle("contracts"), "and leaves the focus on its handle");
});

test("4.41 Open all · n opens every fold on this panel, both levels, and is not kept", () => {
  const { draw, host, open, mouse } = page();
  draw("one");
  const all = host.querySelector<HTMLButtonElement>("[data-open-all]")!;
  mouse(all, "click");
  for (const kind of ["more", "open-work", "contracts", "contract"]) assert.equal(open(kind), true, `${kind} is open`);
  draw("two");
  assert.equal(open("contracts"), false, "the next pick opens closed: Open all is for this panel only");
});

test("4.42 the kinds of fold the user opened open on every later pick until he closes them; a contract's own never does; Escape with no fold focused forgets them", () => {
  const { draw, host, handle, open, mouse, key } = page();
  draw("one");
  mouse(handle("contracts"), "click");
  mouse(handle("contract"), "click");
  mouse(handle("open-work"), "click");
  draw("two");
  assert.equal(open("contracts"), true, "the contracts the user opened open on the next pick");
  assert.equal(open("open-work"), true);
  assert.equal(open("more"), false, "nothing he has not opened");
  assert.equal(open("contract"), false, "a contract's own fold is never kept");
  mouse(handle("open-work"), "click");
  draw("one");
  assert.equal(open("open-work"), false, "closed, it is no longer kept");
  assert.equal(open("contracts"), true);
  (host.querySelector(".panel-close") as HTMLElement).focus();
  key(host.querySelector(".panel-close")!, "Escape");
  assert.equal(open("contracts"), false, "Escape with no fold focused closes every fold");
  draw("two");
  assert.equal(open("contracts"), false, "and resets the kept depth");
});
