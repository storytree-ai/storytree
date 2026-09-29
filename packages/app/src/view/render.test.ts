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
  const sections = [...html.matchAll(/data-app-section="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(sections, ["projects", "sessions", "library", "surfaces", "updates", "help"], "no catch-all Settings tab");
  for (const section of sections) assert.match(html, new RegExp(`id="app-${section}"`));
  assert.doesNotMatch(html, /<h1/, "the tab on show is the heading");
  assert.match(html, /role="dialog"[^>]*aria-label="App menu"/);
  assert.match(html, /id="app-sessions"[^>]*>\s*<div data-app-settings="sessions">/);
  assert.match(html, /id="app-library"[^>]*>\s*<div data-app-settings="library">/);
  assert.match(html, /id="app-surfaces"[^>]*>\s*<div data-app-surfaces>/);
  assert.match(html, /data-app-help/);
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
