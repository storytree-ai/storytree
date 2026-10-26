/**
 * The Surfaces menu in Settings (ADR-0750), as HTML: every surface with its name and description,
 * a switch where it can be switched off, and its own settings beneath it. Read without a browser.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { Window } from "happy-dom";

import type { SurfaceReading } from "../surfaces/switches.js";
import { mountSurfaces, renderSurfaces } from "./surfaces.js";

const zoom = { id: "opening-zoom", name: "Opening zoom", meaning: "How close it opens.", default: "whole", choices: [{ id: "whole", name: "Whole" }, { id: "close", name: "Close up" }] };
const readings: SurfaceReading[] = [
  { id: "globe", name: "Globe", description: "The <planet>.", switchable: false, on: true, source: "default", settings: [{ ...zoom, value: "close", source: "set" }] },
  { id: "panel", name: "Panel", description: "The panel.", switchable: false, on: true, source: "default", settings: [] },
  { id: "tree", within: "panel", name: "Tree", description: "The tree.", switchable: true, on: false, source: "set", settings: [] },
  { id: "details", within: "panel", follows: "tree", name: "Details", description: "Picked in the tree.", switchable: false, on: false, source: "default", settings: [] },
  { id: "sessions", name: "Sessions", description: "Who is working.", switchable: true, on: true, source: "default", settings: [] },
];

/** The HTML of the one surface `id`, its group's members excluded. */
function row(html: string, id: string): string {
  const found = new RegExp(`<div class="surface"[^>]*data-surface="${id}"[\\s\\S]*?<!-- /${id} -->`).exec(html)?.[0];
  assert.ok(found !== undefined, `a row for ${id}`);
  return found;
}

test("3.7 the Surfaces menu lists every surface by name and description, with a switch showing whether it is on where it can be switched off", () => {
  const html = renderSurfaces(readings);
  for (const surface of readings) {
    assert.match(row(html, surface.id), new RegExp(surface.name));
  }
  assert.match(row(html, "globe"), /The &lt;planet&gt;\./, "words are text, never HTML");
  assert.match(row(html, "sessions"), /<input type="checkbox" role="switch"[^>]*data-switch="sessions"[^>]*checked/);
  assert.match(row(html, "tree"), /<input type="checkbox" role="switch"[^>]*data-switch="tree"/);
  assert.doesNotMatch(row(html, "tree"), /checked/, "the tree is off");
  assert.doesNotMatch(row(html, "globe"), /role="switch"/, "the globe is always on");
  assert.match(row(html, "globe"), /Always on/);
  assert.match(row(html, "details"), /Off with Tree/, "details follow the tree");
});

test("3.7 the Story panel is a group holding its own surfaces, and each surface's settings sit beneath it as named choices, the current one selected", () => {
  const html = renderSurfaces(readings);
  const group = /<section class="surface-group"[^>]*data-surface-group="panel"[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
  assert.match(group, /data-surface="tree"/);
  assert.match(group, /data-surface="details"/);
  assert.doesNotMatch(group, /data-surface="sessions"/);
  assert.match(row(html, "globe"), /<select[^>]*data-setting="globe opening-zoom"[\s\S]*<option value="whole">Whole<\/option>[\s\S]*<option value="close" selected>Close up<\/option>/);
  assert.match(row(html, "globe"), /Opening zoom/);
});

test("3.20 a Surfaces menu that cannot read or save the surfaces says so and writes the failure to the console (app.log)", async (t) => {
  const window = new Window();
  const host = window.document.createElement("div");
  const logged: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => { logged.push(args); });
  const unsaved = new Error("settings.json is read-only");
  const menu = mountSurfaces(host as unknown as HTMLElement, {
    readSurfaces: async () => ({ ok: false, error: "settings.json is not JSON" }),
    saveSurface: async () => { throw unsaved; },
  }, () => {});
  const status = () => host.querySelector("[data-surfaces-status]")!.textContent;
  menu.open();
  await setImmediate();
  assert.match(status(), /Couldn’t read the surfaces: settings.json is not JSON/);
  assert.ok(logged.some((args) => args.some((arg) => arg instanceof Error && /not JSON/.test(arg.message))), "the failed read reaches the console");

  const list = host.querySelector("[data-surfaces]")!;
  list.innerHTML = `<input type="checkbox" data-switch="sessions">`;
  list.querySelector("input")!.dispatchEvent(new window.Event("change", { bubbles: true }));
  await setImmediate();
  assert.ok(logged.some((args) => args.includes(unsaved)), "the failed save reaches the console");
  menu.stop();
});
