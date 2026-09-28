import assert from "node:assert/strict";
import { test } from "node:test";
import { renderAppMenu, renderSwitcher } from "./render.js";

// App capability 2: the gear and project switcher (pending contracts in evidence/top-bars/library-update).
test("2.6–2.8 the app bar holds only the gear and opens a sectioned overlay", () => {
  const html = renderAppMenu();
  const bar = html.match(/<header class="app-bar">([\s\S]*?)<\/header>/)?.[1];
  assert.ok(bar, "the gear has its own app bar");
  assert.equal((bar.match(/<button/g) ?? []).length, 1);
  assert.match(bar, /aria-label="App menu"[^>]*popovertarget="app-menu"/);
  assert.match(html, /id="app-menu"[^>]*popover="auto"/);
  assert.match(html, /role="dialog"[^>]*aria-modal="true"/);
  assert.match(html, /aria-label="Close app menu"/);
  for (const section of ["projects", "settings", "updates", "help"]) {
    assert.match(html, new RegExp(`data-app-section="${section}"`));
    assert.match(html, new RegExp(`id="app-${section}"`));
  }
  assert.match(html, /data-app-help/);
  assert.match(html, /data-app-settings/);
  assert.match(html, /<button(?![^>]*disabled)[^>]*data-app-updates[^>]*>Check for updates<\/button>/);
  assert.match(html, /role="status"[^>]*aria-live="polite"/);
});

test("the project switcher lists every project, selects the current one and escapes names", () => {
  const html = renderSwitcher(["app", "storytree", '<odd> & "quoted"'], "storytree");
  assert.match(html, /<label[^>]*>Project/);
  assert.match(html, /<select[^>]*id="project"/);
  assert.match(html, /<option value="storytree" selected>storytree<\/option>/);
  assert.match(html, /<option value="app">app<\/option>/);
  assert.match(html, /&lt;odd&gt; &amp; &quot;quoted&quot;/);
});
