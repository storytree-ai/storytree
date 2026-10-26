// Capability 6 · Pixel-art shorts: the first short's script, cast and layout, checked without a browser.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type { CastMap } from "./cast.js";
import { unresolved } from "./cast.js";
import { drawable } from "./font.js";
import { rgbOf } from "./render.js";
import { FIRST_SHORT } from "./root.js";
import { drawScene, focusIn, spritesAt } from "./scene.js";
import { growthProgress } from "@storytree/forest-world/geometry";
import { ASKED, BUBBLE, beats, chatAt, columnsOf, END_CARD, GLYPH, HALF, HALF_WIDTH, layBubble, LENGTH, PAD, POSES, PROPS, readingTime, ROLL, SCREEN, SEAT, SMALL, TITLE,
  type Rect, type Side } from "./script.js";
import { GRAPH, GROUNDING, growthAt, layGraph, MAP_PALETTE, mapProps, PANEL, quantise, risenAt, snapshot, WISHLIST } from "./view.js";
import shop from "../shop-snapshot.json" with { type: "json" };

const sprites = new URL("./public/sprites/", import.meta.url);
const cast = JSON.parse(await readFile(new URL("cast.json", sprites), "utf8")) as CastMap;
const script = beats(GROUNDING);
const sides = Object.keys(script) as Side[];
/** Every frame the short plays before its end card, in seconds. */
const frames = Array.from({ length: END_CARD * FIRST_SHORT.fps }, (_, frame) => frame / FIRST_SHORT.fps);

test("6.3 · the cast's frame map resolves every pose the short's script names, inside the sheet's own picture, and the room's screen is where the scene draws it", async () => {
  const png = await readFile(new URL(cast.image.replace(/^sprites\//, ""), sprites));
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [cast.width, cast.height], "the map's size is the picture's");
  const named = [...new Set(sides.flatMap(side => script[side].map(beat => beat.pose)))].filter(pose => pose !== "gone");
  assert.ok(named.every(pose => (POSES as readonly string[]).includes(pose)));
  assert.deepEqual(unresolved(cast, { poses: named, props: PROPS }), []);
  const hole = cast.holes.screen!;
  assert.deepEqual(SCREEN.room, { x: hole.x, y: hole.y + TITLE, width: hole.w, height: hole.h }, "the screen drawn in the room shows through the set's screen");
});

test("6.4 · every bubble's words fit their box unbroken on their own half, and every word on a full view of Claude fits across it", () => {
  for (const side of sides) for (const beat of script[side]) if (beat.think) {
    const laid = layBubble(side, beat.think);
    assert.equal(laid.lines.join(" "), beat.think, `"${beat.think}" keeps its words whole`);
    assert.ok(laid.lines.length <= BUBBLE.rows, `"${beat.think}" fits ${BUBBLE.rows} lines`);
    assert.ok(laid.lines.every(line => line.length * GLYPH <= BUBBLE.width - 2 * PAD), `"${beat.think}" fits across inside its padding`);
    assert.ok(laid.x >= HALF[side] && laid.x + laid.width <= HALF[side] + HALF_WIDTH, `"${beat.think}" stays on its half`);
  }
  const columns = columnsOf(SCREEN.full.width, SMALL.advance) - 2;
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

test("6.5 · the storytree side's map is the forest's glass sheet of the saved plan, copied onto its screen whenever the screen shows the map, and only then", () => {
  const props = mapProps(undefined);
  assert.equal(props.scene, snapshot.scene, "of the saved plan");
  assert.equal(mapProps(PANEL.story).selected, PANEL.story, "and selects the island he clicks");
  const pixels = new Uint8ClampedArray(Array.from({ length: 4 * 512 }, (_, at) => (at * 37) % 256));
  quantise(pixels);
  const hex = (at: number) => `#${[0, 1, 2].map(c => pixels[at + c]!.toString(16).padStart(2, "0")).join("")}`;
  for (let at = 0; at < pixels.length; at += 4) assert.ok((MAP_PALETTE as readonly string[]).includes(hex(at)) && pixels[at + 3] === 255, "its drawing is put into the short's palette");
  const view = { real: "view" } as unknown as CanvasImageSource, sheet = { cast: "sheet" } as unknown as CanvasImageSource;
  const shown = new Set<string>();
  for (const seconds of frames.filter((_, frame) => frame % 3 === 0)) {
    const { ctx, calls } = recorder();
    drawScene(ctx, { seconds, frames: LENGTH * 30, cast, sheet, view });
    const copies = calls.filter(call => call.name === "drawImage" && call.args[0] === view).map(call => call.args.slice(-4) as number[]);
    const beat = script.with.find(each => seconds >= each.from && seconds < each.to)!;
    if (beat.app !== "map") { assert.deepEqual(copies, [], `no map at ${seconds}s`); continue; }
    const screen = SCREEN[beat.view];
    assert.deepEqual(copies, [[HALF.with + screen.x, screen.y, screen.width, screen.height]], `one copy of the view fills the ${beat.view} screen at ${seconds}s`);
    shown.add(beat.view);
  }
  assert.deepEqual([...shown].sort(), ["full", "room"], "the map shows in the room and in a full view of the screen");
});

test("6.8 · the new story's capability graph names its real parts, and the storytree side's short prompt names one of them while the long one names none", () => {
  assert.equal(PANEL.title, "Wishlist", "the island is the new story's");
  const shown = layGraph({ ...SCREEN.full, x: HALF.with + SCREEN.full.x }).cards.filter(card => card.own).map(card => card.title).sort();
  assert.deepEqual(shown, ["1 · Wishlist store", "2 · Heart button", "3 · Wishlist page", "4 · Move to cart"], "its graph's own cards are its parts");
  assert.deepEqual(PANEL.parts.map(part => part.title), shown, "the parts its island's land is drawn from");
  assert.equal(GROUNDING.capability, "4 · Move to cart");
  const typed = (side: Side) => script[side].flatMap(beat => beat.typed ? [beat.typed.toLowerCase()] : []);
  const named = (prompt: string) => PANEL.parts.filter(part => prompt.includes(part.title.toLowerCase()));
  assert.ok(typed("with").some(prompt => named(prompt).length === 1 && prompt.includes(PANEL.title.toLowerCase())), "a short prompt names the island and one part");
  assert.ok(typed("with").every(prompt => prompt.length <= 60), "every prompt on the storytree side is short");
  assert.ok(typed("without").every(prompt => named(prompt).length === 0), "the other side never names a part");
  assert.ok(Math.max(...typed("without").map(prompt => prompt.length)) > 4 * Math.max(...typed("with").map(prompt => prompt.length)), "its description is far longer");
});

test("6.12 · the storytree side's map is the shop's, with the story he asked for as one new island, and its graph is the app's layout of that story", () => {
  const saved = shop as unknown as typeof snapshot;
  assert.deepEqual(snapshot.scene.islands.slice(0, -1), saved.scene.islands, "every island of the shop, as saved");
  assert.deepEqual(snapshot.scene.islands.map(island => island.title).at(-1), "Wishlist", "and one new island, the wishlist");
  const taken = saved.places.map(place => place.place);
  assert.ok(!taken.includes(WISHLIST.place), "on a place no island of the shop holds, so none moves");
  const typed = script.with.flatMap(beat => beat.typed ? [beat.typed] : []);
  for (const side of sides) assert.equal(script[side].find(beat => beat.typed)!.typed, ASKED, `the ${side} half asks Claude for the shop first`);
  const own = GRAPH.layout.cards.filter(card => card.own).map(card => card.id).sort();
  assert.deepEqual(own, WISHLIST.parts.map(part => part.id).sort(), "the graph's own cards are the new story's parts");
  const outside = GRAPH.layout.cards.filter(card => !card.own).map(card => card.title).sort();
  assert.deepEqual(outside, ["2 · Cart store", "3 · Page shell", "4 · Product page", "6 · Accounts store"], "with the shop's parts they build on");
  const screen = { ...SCREEN.full, x: HALF.with + SCREEN.full.x }, { cards } = layGraph(screen);
  for (const card of cards) {
    assert.ok(card.box.x >= screen.x && card.box.x + card.box.width <= screen.x + screen.width && card.box.y >= screen.y && card.box.y + card.box.height <= screen.y + screen.height, `"${card.title}" fits on the screen`);
    assert.equal(card.lines.join(" "), card.title, `"${card.title}" is drawn whole`);
    for (const other of cards) if (other !== card)
      assert.ok(card.box.x + card.box.width <= other.box.x || other.box.x + other.box.width <= card.box.x || card.box.y + card.box.height <= other.box.y || other.box.y + other.box.height <= card.box.y, `"${card.title}" and "${other.title}" do not overlap`);
  }
  assert.ok(typed.some(prompt => prompt.includes(cards.find(card => card.asked)!.title.toLowerCase())), "the part he asks about is a card he saw in the graph");
});

test("6.23 · the storytree side's map opens on a brand-new project: an empty sheet when it first shows, the shop's islands rising as Claude builds, the wishlist last, each named once risen, the whole shop by the cut to the room", () => {
  const grows = script.with.find(beat => beat.grows)!, before = script.with.slice(0, script.with.indexOf(grows));
  assert.ok(before.length > 0 && before.every(beat => beat.app === "claude"), "it is the first map he sees, straight after asking");
  const islands = snapshot.scene.islands.map(island => island.story);
  const shown = (seconds: number) => {
    const growth = mapProps(undefined, growthAt(script.with, seconds)).growth;
    return islands.filter(story => growth === undefined || growthProgress(growth.plan.islands.get(story), growth.at, false) > 0);
  };
  assert.deepEqual(shown(grows.from), [], "empty when it first shows");
  assert.deepEqual(shown(grows.to), islands, "the whole shop, wishlist included, by the cut");
  const during = frames.filter(seconds => seconds >= grows.from && seconds < grows.to);
  const counts = during.map(seconds => shown(seconds).length);
  assert.ok(counts.every((count, at) => at === 0 || count >= counts[at - 1]!), "an island never sinks again");
  assert.ok(new Set(counts).size >= 4, `it grows in steps a viewer can see: ${[...new Set(counts)].join(", ")}`);
  const wishlist = during.find(seconds => shown(seconds).includes(WISHLIST.story))!;
  assert.equal(shown(wishlist).length, islands.length, "the wishlist rises last");
  for (const seconds of during) {
    const risen = risenAt(script.with, seconds);
    assert.ok(islands.filter(risen).every(story => shown(seconds).includes(story)), `at ${seconds.toFixed(2)} s only an island on the sheet is named`);
  }
  assert.deepEqual(islands.filter(risenAt(script.with, grows.to)), islands, "every island is named once grown");
  assert.deepEqual(islands.filter(risenAt(script.with, grows.from)), [], "and none before");
});

test("6.13 · standing up, his chair rolls back once he is clear of it, and he walks out behind it, never through it", () => {
  const leaving = frames.filter(seconds => { const beat = script.with.find(each => seconds >= each.from && seconds < each.to); return beat?.view === "room" && ["standing", "walking", "gone"].includes(beat.pose); });
  assert.ok(leaving.length > 0);
  let rolled = 0;
  for (const seconds of leaving) {
    const sprites = spritesAt("with", seconds, cast), chair = sprites.find(sprite => sprite.frame === cast.props.chair);
    const pose = script.with.find(beat => seconds >= beat.from && seconds < beat.to)!.pose;
    if (!chair) { assert.equal(pose, "standing", `the chair is drawn apart from ${seconds.toFixed(2)} s on`); continue; }
    assert.equal(sprites.at(-1), chair, `at ${seconds.toFixed(2)} s the chair is drawn in front of him`);
    assert.ok(chair.x - (HALF.with + SEAT.x) >= rolled, `at ${seconds.toFixed(2)} s it never rolls back toward the desk`);
    rolled = chair.x - (HALF.with + SEAT.x);
  }
  assert.equal(rolled, ROLL.x, "it ends rolled back");
  const walking = leaving.filter(seconds => script.with.find(beat => seconds >= beat.from && seconds < beat.to)!.pose === "walking");
  for (const seconds of walking) {
    const [him, chair] = spritesAt("with", seconds, cast);
    assert.ok(him!.y < chair!.y, `at ${seconds.toFixed(2)} s he walks on a line further from the viewer than the rolled-back chair`);
  }
  const last = spritesAt("with", walking.at(-1)!, cast)[0]!;
  assert.ok(last.x + 68 >= HALF.with + HALF_WIDTH, "and he is off his half by the time the walk ends: the mirrored figure starts at its column 68");
});

/** Each stretch of frames a text a viewer must read stays on its side, with its first frame and its last. */
function heldTexts(): { side: Side; text: string; from: number; to: number }[] {
  const held: { side: Side; text: string; from: number; to: number }[] = [];
  for (const side of sides) {
    const open = new Map<string, number>();
    for (const seconds of [...frames, END_CARD]) {
      const now = new Set(focusIn(side, seconds).map(focus => focus.text));
      for (const [text, from] of open) if (!now.has(text)) { held.push({ side, text, from, to: seconds }); open.delete(text); }
      for (const text of now) if (!open.has(text)) open.set(text, seconds);
    }
  }
  return held;
}

test("6.9 · every line a viewer must read is held at least its reading time: about 2.5 words a second, plus a second", () => {
  const held = heldTexts();
  for (const { side, text, from, to } of held)
    assert.ok(to - from >= readingTime(text) - 1e-9, `"${text}" (${side}) shows ${(to - from).toFixed(2)} s from ${from.toFixed(2)} s; it needs ${readingTime(text).toFixed(2)} s`);
  const read = new Set(held.map(({ text }) => text));
  for (const side of sides) for (const beat of script[side]) for (const text of [beat.think, beat.reply])
    if (text) assert.ok(read.has(text), `"${text}" is held on screen to be read`);
  assert.ok(read.has(script.with.find(beat => beat.typed?.includes(GROUNDING.capability.toLowerCase()))!.typed!), "the grounded prompt is held to be read");
  assert.ok(read.has(GROUNDING.capability), "the part he asks about is held in the panel to be read");
});

test("6.10 · the short runs 45 to 60 seconds, its end card after both halves' last beats", () => {
  assert.ok(LENGTH >= 45 && LENGTH <= 60, `${LENGTH} s`);
  for (const side of sides) assert.equal(script[side].at(-1)!.to, END_CARD, `the ${side} half plays until the end card`);
  assert.ok(END_CARD < LENGTH);
});

test("6.11 · no opaque pixel of any sprite lies over a line a viewer must read, in any frame", async () => {
  const sheet = await rgbOf(fileURLToPath(new URL(cast.image.replace(/^sprites\//, ""), sprites)), undefined, "rgba");
  const opaque = (x: number, y: number) => sheet[(y * cast.width + x) * 4 + 3]! >= 128;
  const covers = (sprite: ReturnType<typeof spritesAt>[number], box: Rect) => {
    for (let y = Math.max(box.y, sprite.y); y < Math.min(box.y + box.height, sprite.y + sprite.frame.h); y++)
      for (let x = Math.max(box.x, sprite.x); x < Math.min(box.x + box.width, sprite.x + sprite.frame.w); x++)
        if (opaque(sprite.frame.x + (sprite.mirror ? sprite.frame.w - 1 - (x - sprite.x) : x - sprite.x), sprite.frame.y + y - sprite.y)) return true;
    return false;
  };
  let checked = 0;
  for (const seconds of frames) for (const side of sides) for (const focus of focusIn(side, seconds)) for (const sprite of spritesAt(side, seconds, cast)) {
    checked++;
    assert.ok(!covers(sprite, focus.box), `a sprite covers "${focus.text}" at ${seconds.toFixed(2)} s`);
  }
  assert.ok(checked > 0, "some frame shows a sprite beside a line to read");
});
