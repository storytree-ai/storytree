import assert from "node:assert/strict";
import { test } from "node:test";

import { CLEAR_FIRST_LAUNCH } from "./smoke-first-launch.js";

test("1.48 · before its screenshot the smoke check closes the first-run guide's menu and declines the tour, as a person would", () => {
  const clicked: string[] = [];
  const buttons: Record<string, string> = { "[data-app-close]": "close the menu", '[data-tour="no"]': "decline the tour" };
  const document = { querySelector: (selector: string) => buttons[selector] === undefined ? null : { click: () => { clicked.push(buttons[selector]!); } } };
  new Function("document", CLEAR_FIRST_LAUNCH)(document);
  assert.deepEqual(clicked, ["close the menu", "decline the tour"]);
});
