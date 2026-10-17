// Capability 6 · Pixel-art shorts: the first short's script, cast and layout, checked without a browser.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import type { CastMap } from "./cast.js";
import { unresolved } from "./cast.js";
import { drawable } from "./font.js";
import { drawScene } from "./scene.js";
import { BUBBLE, beats, chatAt, columnsOf, END_CARD, GLYPH, HALF, layBubble, LENGTH, PAD, POSES, PROPS, SCREEN, SMALL, type Side } from "./script.js";
import { GROUNDING, PANEL, snapshot } from "./view.js";

const sprites = new URL("./public/sprites/", import.meta.url);
const cast = JSON.parse(await readFile(new URL("cast.json", sprites), "utf8")) as CastMap;
const script = beats(GROUNDING);
const sides = Object.keys(script) as Side[];
/** Every tenth of a second the short plays before its end card. */
const moments = Array.from({ length: END_CARD * 10 }, (_, tenth) => tenth / 10);

test("6.3 · the cast's frame map resolves every pose the short's script names, inside the sheet's own picture", async () => {
  const png = await readFile(new URL(cast.image.replace(/^sprites\//, ""), sprites));
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [cast.width, cast.height], "the map's size is the picture's");
  const named = [...new Set(sides.flatMap(side => script[side].map(beat => beat.pose)))].filter(pose => pose !== "gone");
  assert.ok(named.every(pose => (POSES as readonly string[]).includes(pose)));
  assert.deepEqual(unresolved(cast, { poses: named, props: PROPS }), []);
});

test("6.4 · every bubble's words fit their box unbroken on their own half, and every word on a screen fits across it", () => {
  for (const side of sides) for (const beat of script[side]) if (beat.think) {
    const laid = layBubble(side, beat.think);
    assert.equal(laid.lines.join(" "), beat.think, `"${beat.think}" keeps its words whole`);
    assert.ok(laid.lines.length <= BUBBLE.rows, `"${beat.think}" fits ${BUBBLE.rows} lines`);
    assert.ok(laid.lines.every(line => line.length * GLYPH <= BUBBLE.width - 2 * PAD), `"${beat.think}" fits across inside its padding`);
    assert.ok(laid.x >= HALF[side] && laid.x + laid.width <= HALF[side] + 160, `"${beat.think}" stays on its half`);
  }
  const columns = Math.min(...Object.values(SCREEN).map(screen => columnsOf(screen.width, SMALL.advance))) - 2;
  for (const side of sides) for (const said of chatAt(side, script[side], END_CARD)) {
    assert.ok([...said.text].every(drawable), `the screen font draws every character of "${said.text}"`);
    assert.ok(said.text.split(/\s+/).every(word => word.length <= columns), `"${said.text}" wraps on the screen without breaking a word`);
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

test("6.5 · the storytree side's map is the real view, copied onto its screen whenever the screen shows the map, and only then", () => {
  const view = { real: "view" } as unknown as CanvasImageSource, sheet = { cast: "sheet" } as unknown as CanvasImageSource;
  const shown = new Set<string>();
  for (const seconds of moments) {
    const { ctx, calls } = recorder();
    drawScene(ctx, { seconds, frames: LENGTH * 30, cast, sheet, view });
    const copies = calls.filter(call => call.name === "drawImage" && call.args[0] === view).map(call => call.args.slice(-4) as number[]);
    const beat = script.with.find(each => seconds >= each.from && seconds < each.to)!;
    if (beat.app !== "map") { assert.deepEqual(copies, [], `no map at ${seconds}s`); continue; }
    const screen = SCREEN[beat.view ?? "room"];
    assert.equal(copies.length, 1, `one copy of the view at ${seconds}s`);
    const [x, y, width, height] = copies[0]!;
    assert.ok(x! >= HALF.with + screen.x && y! >= screen.y && x! + width! <= HALF.with + screen.x + screen.width && y! + height! <= screen.y + screen.height,
      `the view sits on the ${beat.view ?? "room"} screen at ${seconds}s`);
    shown.add(beat.view ?? "room");
  }
  assert.deepEqual([...shown].sort(), ["full", "room"], "the map shows in the room and in a full view of the screen");
});

test("6.8 · the island's panel lists the real island's parts, and the storytree side's short prompt names one of them while the long one names none", () => {
  const island = (snapshot.scene.islands as unknown as { story: string; title: string; land: { territories: { title: string }[] } }[])
    .find(each => each.story === PANEL.story)!;
  assert.equal(PANEL.title, island.title);
  assert.deepEqual(PANEL.parts.map(part => part.title).sort(), island.land.territories.map(part => part.title).sort());
  const typed = (side: Side) => script[side].flatMap(beat => beat.typed ? [beat.typed.toLowerCase()] : []);
  const named = (prompt: string) => PANEL.parts.filter(part => prompt.includes(part.title.toLowerCase()));
  assert.ok(typed("with").some(prompt => named(prompt).length === 1 && prompt.includes(PANEL.title.toLowerCase())), "a short prompt names the island and one part");
  assert.ok(typed("with").every(prompt => prompt.length <= 60), "every prompt on the storytree side is short");
  assert.ok(typed("without").every(prompt => named(prompt).length === 0), "the other side never names a part");
  assert.ok(Math.max(...typed("without").map(prompt => prompt.length)) > 4 * Math.max(...typed("with").map(prompt => prompt.length)), "its description is far longer");
});
