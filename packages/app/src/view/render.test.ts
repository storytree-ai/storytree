import assert from "node:assert/strict";
import { test } from "node:test";
import { renderAppMenu, renderNoProjects, renderProjectPicker } from "./render.js";

test("2.5: the empty page explains adding a project from the bar's project list or the command line", () => {
  const html = renderNoProjects();
  assert.match(html, /<h1>No projects yet<\/h1>/);
  assert.match(html, /New project… in the project list at the top left/);
  assert.match(html, /<code>storytree doctor --set-up &lt;name&gt;<\/code> in the folder/);
});

test("2.11 · the empty page shows storytree's mark in the page theme's colours, with no tile and no file", () => {
  const html = renderNoProjects();
  const mark = html.match(/<svg class="app-mark"[\s\S]*?<\/svg>/)?.[0];
  assert.ok(mark, "the mark is drawn inline, above the heading");
  assert.ok(html.indexOf(mark) < html.indexOf("<h1>"));
  assert.match(mark, /aria-hidden="true"/);
  assert.match(mark, /viewBox="0 0 104 104"/, "the mark's own drawing");
  const colours = [...mark.matchAll(/(?:fill|stroke)="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(new Set(colours), new Set(["var(--mark-ocean)", "var(--mark-land)", "var(--mark-tree)", "var(--mark-leaf)"]), "every role from the theme, no colour of its own");
  assert.doesNotMatch(mark, /<rect/, "the page is the canvas");
});

// App capability 2: the gear and project switcher (pending contracts in evidence/top-bars/library-update).
test("2.6–2.8 the app bar holds the gear, with the project dropdown's place at its left, and opens a sectioned overlay", () => {
  const html = renderAppMenu();
  const bar = html.match(/<header class="app-bar">([\s\S]*?)<\/header>/)?.[1];
  assert.ok(bar, "the gear has its own app bar");
  assert.equal((bar.match(/<button/g) ?? []).length, 1);
  assert.ok(bar.indexOf("data-app-factory") < bar.indexOf("app-gear"), "the dropdown's place comes before the gear");
  assert.match(bar, /data-app-switcher/, "the project dropdown is in the bar, not the overlay");
  assert.doesNotMatch(html.slice(html.indexOf("</header>")), /data-app-switcher/, "one switcher, not two");
  assert.match(bar, /aria-label="App menu"[^>]*popovertarget="app-menu"/);
  assert.match(html, /id="app-menu"[^>]*popover="auto"/);
  assert.match(html, /role="dialog"[^>]*aria-modal="true"/);
  // Close ends the tab row; no strip of its own above the tabs.
  assert.match(html, /<nav class="app-menu-sections"[\s\S]*data-app-section="help"[\s\S]*aria-label="Close app menu"[\s\S]*<\/nav>/);
  assert.doesNotMatch(html, /app-menu-header/);
  const sections = [...html.matchAll(/data-app-section="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(sections, ["projects", "sessions", "sharing", "library", "surfaces", "updates", "help"], "no catch-all Settings tab");
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

test("2.1 the project dropdown names every project, the one on show selected, the factory marked, every name escaped, and ends with New project…", () => {
  const html = renderProjectPicker(["app", "storytree", '<odd> & "quoted"'], "storytree", "app");
  assert.match(html, /<select[^>]*id="project"[^>]*aria-label="Project"/);
  assert.match(html, /<option value="storytree" selected>storytree<\/option>/);
  assert.match(html, /<option value="app" data-app-factory-option>app · your factory<\/option>/);
  assert.match(html, /&lt;odd&gt; &amp; &quot;quoted&quot;/);
  assert.match(html, /<option value="" data-app-new-project>New project…<\/option><\/select>/, "New project… is the last entry");
  assert.equal([...renderProjectPicker([], undefined, undefined).matchAll(/<option/g)].length, 1, "with no projects, just New project…");
});
