/**
 * Capability 2 · Storytree projects: the left rail's own palette. The rail is drawn dark in either OS theme, so the colours the
 * stories' surfaces in its tabs read (`--text`, `--muted`, `--row-hover`, `--line`) are its dark ones, never the light page's.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Window } from "happy-dom";

import { appMenuStyles } from "./styles.js";

/** Relative luminance (WCAG 2) of a computed `rgb(…)` or hex colour. */
function luminance(colour: string): number {
  const hex = /^#([0-9a-f]{6})$/i.exec(colour.trim());
  const parts = hex ? [0, 2, 4].map((at) => parseInt(hex[1]!.slice(at, at + 2), 16)) : colour.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number);
  const [r, g, b] = parts.map((value) => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
const contrast = (a: string, b: string) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi! + 0.05) / (lo! + 0.05); };

test("2.59 · the left rail's tabs read in its own dark palette when the page around it is light, so a label drawn in its text, muted or hover colours reads on it", () => {
  const window = new Window();
  const document = window.document;
  const style = document.createElement("style");
  // The desktop page's light theme (an OS in light mode), then the frame's styles; a tab's label in the rail's colours.
  style.textContent = `:root { --text: #1d1f23; --muted: #5d636d; --row-hover: #f3f4f5; --line: #e2e3e6; } .label { color: var(--muted); } .text { color: var(--text); } .pill { color: var(--text); background: var(--row-hover); }\n${appMenuStyles}`;
  document.head.append(style);
  document.body.innerHTML = `<main><nav class="side-rail"><div class="side-rail-panel"><button class="label">Parked</button><span class="text">Closed</span><button class="pill">Active</button></div></nav></main>`;
  const rail = window.getComputedStyle(document.querySelector(".side-rail")!).backgroundColor;
  for (const name of [".label", ".text"]) {
    const colour = window.getComputedStyle(document.querySelector(name)!).color;
    assert.ok(contrast(colour, rail) >= 4.5, `${name} (${colour}) reads on the rail (${rail}): ${contrast(colour, rail).toFixed(2)}`);
  }
  const pill = window.getComputedStyle(document.querySelector(".pill")!);
  assert.ok(contrast(pill.color, pill.backgroundColor) >= 4.5, `a pressed label (${pill.color} on ${pill.backgroundColor}) reads`);
  assert.ok(luminance(pill.backgroundColor) < 0.2, `a pressed label's ground (${pill.backgroundColor}) stays dark on the dark rail`);
});

test("2.7 · in the gear's section list a row the pointer rests on never looks like the open section's row", () => {
  const window = new Window();
  const document = window.document;
  const style = document.createElement("style");
  // happy-dom keeps no pointer, so each `:hover` rule is read as a `.hovered` one and the row under the pointer carries that class.
  style.textContent = appMenuStyles.replaceAll(":hover", ".hovered");
  document.head.append(style);
  document.body.innerHTML = `<div class="app-menu"><nav class="app-menu-sections"><button aria-pressed="true">Updates</button><button class="hovered" aria-pressed="false">Help</button></nav></div>`;
  const [open, hovered] = [...document.querySelectorAll("button")].map((row) => window.getComputedStyle(row));
  const look = (row: typeof open) => `${row!.backgroundColor} ${row!.boxShadow}`;
  assert.notEqual(look(hovered), look(open), `the hovered row (${look(hovered)}) looks like the open one (${look(open)})`);
});
