import assert from "node:assert/strict";
import { test } from "node:test";
import { renderAppMenu, renderNoProjects, renderSwitcher } from "./render.js";

test("2.5: the empty page explains adding a project from the gear menu or the command line", () => {
  const html = renderNoProjects();
  assert.match(html, /<h1>No projects yet<\/h1>/);
  assert.match(html, /Add a folder as a project from the gear menu: Projects → Add project…/);
  assert.match(html, /<code>storytree doctor --set-up &lt;name&gt;<\/code> in the folder/);
});

// App capability 2: the gear and project switcher (pending contracts in evidence/top-bars/library-update).
test("2.6–2.8 the app bar holds only the gear and opens a sectioned overlay", () => {
  const html = renderAppMenu();
  const bar = html.match(/<header class="app-bar">([\s\S]*?)<\/header>/)?.[1];
  assert.ok(bar, "the gear has its own app bar");
  assert.equal((bar.match(/<button/g) ?? []).length, 1);
  assert.match(bar, /aria-label="App menu"[^>]*popovertarget="app-menu"/);
  assert.match(html, /id="app-menu"[^>]*popover="auto"/);
  assert.match(html, /role="dialog"[^>]*aria-modal="true"/);
  // Close ends the tab row; no strip of its own above the tabs.
  assert.match(html, /<nav class="app-menu-sections"[\s\S]*data-app-section="help"[\s\S]*aria-label="Close app menu"[\s\S]*<\/nav>/);
  assert.doesNotMatch(html, /app-menu-header/);
  const sections = [...html.matchAll(/data-app-section="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(sections, ["projects", "sessions", "library", "surfaces", "updates", "help"], "no catch-all Settings tab");
  for (const section of sections) assert.match(html, new RegExp(`id="app-${section}"`));
  assert.doesNotMatch(html, /<h1/, "the tab on show is the heading");
  assert.match(html, /role="dialog"[^>]*aria-label="App menu"/);
  assert.match(html, /id="app-sessions"[^>]*>\s*<div data-app-settings="sessions">/);
  assert.match(html, /<div data-app-settings="sessions"><\/div><div data-app-decision-rights><\/div><\/section>/, "who decides what sits below the Sessions settings");
  assert.match(html, /id="app-library"[^>]*>\s*<div data-app-settings="library">/);
  assert.match(html, /id="app-surfaces"[^>]*>\s*<div data-app-surfaces>/);
  assert.match(html, /data-app-help/);
  assert.match(html, /<button(?![^>]*disabled)[^>]*data-app-updates[^>]*>Check for updates<\/button>/);
  assert.match(html, /role="status"[^>]*aria-live="polite"/);
});

test("2.1 the project list names every project, with the one on show selected and every name escaped", () => {
  const html = renderSwitcher(["app", "storytree", '<odd> & "quoted"'], "storytree");
  assert.match(html, /<label[^>]*>Project/);
  assert.match(html, /<select[^>]*id="project"/);
  assert.match(html, /<option value="storytree" selected>storytree<\/option>/);
  assert.match(html, /<option value="app">app<\/option>/);
  assert.match(html, /&lt;odd&gt; &amp; &quot;quoted&quot;/);
});
