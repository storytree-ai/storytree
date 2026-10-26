import assert from "node:assert/strict";
import { test } from "node:test";
import { Window } from "happy-dom";

import { renderAppMenu, renderNoProjects } from "../view/render.js";
import { appNamedSurfaces, MENU_TABS } from "./named.js";

test("3.15 · each gear menu tab, and the page with no projects, carries the surface id the app declares for it", () => {
  const { document } = new Window();
  document.body.innerHTML = renderAppMenu() + renderNoProjects();
  const declared = new Set(appNamedSurfaces.map(({ id }) => id));
  const marked = [...document.querySelectorAll("[data-surface-id]")].map((node) => node.getAttribute("data-surface-id"));
  assert.deepEqual(marked.filter((id) => !declared.has(id!)), [], "every mark is a declared id");
  for (const label of MENU_TABS) {
    const tab = label.toLowerCase();
    assert.equal(document.getElementById(`app-${tab}`)?.getAttribute("data-surface-id"), `menu:${tab}`, `the ${label} tab is named`);
    assert.ok(document.querySelector(`[data-app-section="${tab}"]`), `the ${label} tab has its button`);
  }
  assert.equal(document.querySelector(".empty")?.getAttribute("data-surface-id"), "no-projects");
});
