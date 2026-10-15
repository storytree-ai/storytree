// Capability 6 · Pixel-art shorts: the first short's script, cast and layout, checked without a browser.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import type { CastMap } from "./cast.js";
import { unresolved } from "./cast.js";
import { drawScene } from "./scene.js";
import { BUBBLE, beats, columnsOf, END_CARD, GLYPH, HALF, INSET, layBubble, LENGTH, PAD, POSES, PROPS, TERMINAL, type Side } from "./script.js";
import { ISLAND } from "./view.js";

const sprites = new URL("./public/sprites/", import.meta.url);
const cast = JSON.parse(await readFile(new URL("cast.json", sprites), "utf8")) as CastMap;
const script = beats(ISLAND.title);
const sides = Object.keys(script) as Side[];

test("6.3 · the cast's frame map resolves every pose the short's script names, inside the sheet's own picture", async () => {
  const png = await readFile(new URL(cast.image.replace(/^sprites\//, ""), sprites));
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [cast.width, cast.height], "the map's size is the picture's");
  const named = [...new Set(sides.flatMap(side => script[side].map(beat => beat.pose)))];
  assert.ok(named.every(pose => (POSES as readonly string[]).includes(pose)));
  assert.deepEqual(unresolved(cast, { poses: named, props: PROPS }), []);
});

test("6.4 · every bubble's words fit their box unbroken, and every box stays on its own half", () => {
  for (const side of sides) for (const beat of script[side]) {
    if (beat.bubble) {
      const laid = layBubble(side, beat.bubble.text);
      assert.equal(laid.lines.join(" "), beat.bubble.text, `"${beat.bubble.text}" keeps its words whole`);
      assert.ok(laid.lines.length <= BUBBLE.rows, `"${beat.bubble.text}" fits ${BUBBLE.rows} lines`);
      assert.ok(laid.lines.every(line => line.length * GLYPH <= BUBBLE.width - 2 * PAD), `"${beat.bubble.text}" fits across inside its padding`);
      assert.ok(laid.width <= BUBBLE.width, `"${beat.bubble.text}" is drawn no wider than a bubble may be`);
      assert.ok(laid.x >= HALF[side] && laid.x + laid.width <= HALF[side] + 160);
      if (side === "with") assert.ok(laid.x + laid.width < INSET.x, "the bubble leaves the inset clear");
    }
    if (beat.typed) {
      assert.ok(beat.typed.split(/\s+/).every(word => word.length <= columnsOf(TERMINAL[side].width)), `"${beat.typed}" wraps without breaking a word`);
      if (side === "with") assert.ok(HALF.with + TERMINAL.with.x + TERMINAL.with.width < INSET.x, "the terminal leaves the inset clear");
    }
  }
});

/** A canvas context that records what is drawn, for drawing code run outside a browser. */
function recorder() {
  const calls: { name: string; args: unknown[] }[] = [];
  const ctx = new Proxy({}, {
    get: (_, name) => name === "measureText" ? () => ({ width: 0 }) : (...args: unknown[]) => { calls.push({ name: String(name), args }); },
    set: () => true,
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

test("6.5 · the storytree side's inset is the real view, copied into its box on every frame", () => {
  const view = { real: "view" } as unknown as CanvasImageSource, sheet = { cast: "sheet" } as unknown as CanvasImageSource;
  for (const seconds of [0, 3, 8, 12, 16, 20, END_CARD - 0.1]) {
    const { ctx, calls } = recorder();
    drawScene(ctx, { seconds, frames: LENGTH * 30, cast, sheet, view });
    const copies = calls.filter(call => call.name === "drawImage" && call.args[0] === view);
    assert.deepEqual(copies.map(call => call.args.slice(1)), [[INSET.x, INSET.y, INSET.width, INSET.height]], `at ${seconds}s`);
  }
});
