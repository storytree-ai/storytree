import assert from "node:assert/strict";
import { test } from "node:test";
import { renderAppMenu, renderSwitcher } from "./render.js";

// App capability 2: the gear and project switcher (pending contracts in evidence/gear/library-update).
test("the gear names and controls an initially closed, light-dismiss menu with help and reserved actions", () => {
  const html = renderAppMenu();
  assert.match(html, /<button[^>]*aria-label="App menu"[^>]*popovertarget="app-menu"/);
  assert.match(html, /id="app-menu"[^>]*popover="auto"/);
  assert.match(html, /data-app-help/);
  assert.match(html, /<button[^>]*disabled[^>]*>Check for updates<\/button>/);
  assert.match(html, /data-app-settings/);
  assert.doesNotMatch(html, /<button[^>]*disabled[^>]*>Settings<\/button>/);
});

test("the project switcher lists every project, selects the current one and escapes names", () => {
  const html = renderSwitcher(["app", "storytree", '<odd> & "quoted"'], "storytree");
  assert.match(html, /<label[^>]*>Project/);
  assert.match(html, /<select[^>]*id="project"/);
  assert.match(html, /<option value="storytree" selected>storytree<\/option>/);
  assert.match(html, /<option value="app">app<\/option>/);
  assert.match(html, /&lt;odd&gt; &amp; &quot;quoted&quot;/);
});
