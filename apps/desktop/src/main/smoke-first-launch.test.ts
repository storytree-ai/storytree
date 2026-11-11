import assert from "node:assert/strict";
import { test } from "node:test";

import { CLEAR_FIRST_LAUNCH } from "./smoke-first-launch.js";

/** A page holding the settings menu (open or not) with its close button, and the tour's offer when `tour`. */
function page({ open, tour }: { open: boolean; tour: boolean }) {
  const clicked: string[] = [];
  const button = (name: string) => ({ click: () => { clicked.push(name); } });
  const close = button("close the menu");
  const menu = { matches: (selector: string) => selector === ":popover-open" && open, querySelector: (selector: string) => selector === "[data-app-close]" ? close : null };
  const document = {
    querySelector: (selector: string) => selector === "[data-app-close]" ? { ...close, closest: (s: string) => s === "[popover]" ? menu : null }
      : selector === '[data-tour="no"]' && tour ? button("decline the tour") : null,
  };
  new Function("document", CLEAR_FIRST_LAUNCH)(document);
  return clicked;
}

test("1.48 · before its screenshot the smoke check closes the first-run guide's open menu and declines the tour, as a person would", () => {
  assert.deepEqual(page({ open: true, tour: true }), ["close the menu", "decline the tour"]);
});

test("1.48 · a page with the menu closed and no tour offered is left as it is", () => {
  assert.deepEqual(page({ open: false, tour: false }), []);
});
