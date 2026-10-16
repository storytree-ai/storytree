/** Website 7.1–8.2, the mark: the master drawing in the caller's colours, its named colourways, and the fixed-colour files generated from it. */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

import { SHAPES, SMALL_SHAPES } from "./drawing.js";
import { COLOURWAYS, ICNS_TYPES, ICO_SIZES, PNG_SIZES, iconPath, markSvg, readIcns, readIco, readPng, renderMark } from "./index.js";

const roles = { ocean: "var(--o)", land: "var(--l)", tree: "var(--t)", leaf: "var(--f)" };

/** Every element that paints, with the colour it paints in (a group's colour belongs to its children). */
function painted(svg: string): { tag: string; colour: string }[] {
  const out: { tag: string; colour: string }[] = [];
  const stack: (string | undefined)[] = [];
  for (const [, close, tag, attrs, selfClosing] of svg.matchAll(/<(\/?)(\w+)([^>]*?)(\/?)>/g)) {
    if (close) { stack.pop(); continue; }
    const own = /(?:fill|stroke)="([^"]+)"/.exec(attrs ?? "")?.[1];
    const colour = own ?? stack.at(-1);
    if (tag !== "g" && tag !== "svg" && colour !== undefined) out.push({ tag: tag!, colour });
    if (!selfClosing) stack.push(colour);
  }
  return out;
}

test("7.1 · given four role colours, the SVG fills each role's shapes with its colour and carries no other colour", () => {
  const svg = markSvg(roles);
  assert.match(svg, /viewBox="0 0 104 104"/);
  const shapes = painted(svg);
  const count = (colour: string, tag?: string) => shapes.filter((s) => s.colour === colour && (tag === undefined || s.tag === tag)).length;
  assert.equal(count(roles.ocean, "circle"), 1, "the globe is ocean");
  assert.equal(count(roles.land), 4, "three islets and the main island are land");
  assert.equal(count(roles.tree, "path"), 4, "the tree's four lines are tree");
  assert.equal(count(roles.tree, "circle"), 2, "the root and the fork are tree");
  assert.equal(count(roles.leaf, "circle"), 3, "the three outer dots are leaf");
  assert.equal(shapes.length, 14, "nothing else is drawn: no tile without a canvas");
  const colours = [...svg.matchAll(/(?:fill|stroke)="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(new Set(colours), new Set(Object.values(roles)), "no colour the caller did not give");
  assert.doesNotMatch(svg, /#[0-9a-f]{3,8}\b|rgb\(/i);

  assert.throws(() => markSvg({ ocean: "#000", land: "#111", tree: "#222" } as never), /leaf/);
});

test("7.2 · given a canvas or a named colourway, the SVG draws the tile in the canvas colour and the mark in that colourway's roles", () => {
  const tiled = painted(markSvg({ ...roles, canvas: "var(--c)" }));
  assert.equal(tiled.length, 15);
  assert.deepEqual(tiled[0], { tag: "rect", colour: "var(--c)" }, "the tile is drawn first, behind the mark");
  assert.match(markSvg({ ...roles, canvas: "var(--c)" }), /<rect[^>]*width="104"[^>]*height="104"[^>]*rx="24"/);

  assert.deepEqual(Object.keys(COLOURWAYS).sort(), ["day", "night"]);
  for (const [name, way] of Object.entries(COLOURWAYS)) {
    const shapes = painted(markSvg(name));
    assert.equal(shapes[0]!.colour, way.canvas);
    assert.equal(shapes.find((s) => s.tag === "circle")!.colour, way.ocean, `${name}: the globe`);
    assert.deepEqual(new Set(shapes.map((s) => s.colour)), new Set([way.canvas, way.ocean, way.land, way.tree, way.leaf]));
  }
  assert.throws(() => markSvg("dusk"), /day.*night/);
});

test("8.1 · each committed PNG holds the mark rendered at its size in its colourway: the small-size drawing at 16, the master at every other size", () => {
  assert.deepEqual(PNG_SIZES, [16, 32, 48, 64, 128, 256, 512, 1024]);
  for (const name of Object.keys(COLOURWAYS)) {
    const way = COLOURWAYS[name]!;
    for (const size of PNG_SIZES) {
      const file = iconPath(name, `${size}.png`);
      assert.ok(existsSync(file), `${file} is missing: run pnpm --filter @storytree/mark icons`);
      const png = readPng(readFileSync(file));
      assert.equal(png.width, size, file);
      assert.equal(png.height, size, file);
      const fresh = renderMark(name, size);
      assert.ok(Buffer.from(png.pixels).equals(Buffer.from(fresh)), `${file} is not the mark's render: run pnpm --filter @storytree/mark icons`);
    }
    // 16 is the small-size drawing (ADR-0999), 32 and up the master: just below the tile's top edge, box y 6.5 to 13, only
    // the small-size globe (radius 50) reaches; the master's (radius 36) leaves canvas there.
    const pixel = (px: Uint8Array, size: number, x: number, y: number) => [...px.subarray((y * size + x) * 4, (y * size + x) * 4 + 4)];
    assert.deepEqual(pixel(renderMark(name, 16), 16, 8, 1), [...hex(way.ocean), 255], `${name}: at 16 the globe fills the tile`);
    assert.deepEqual(pixel(renderMark(name, 32), 32, 17, 2), [...hex(way.canvas), 255], `${name}: at 32 the master's globe leaves the canvas`);
    // What the render shows: transparent beyond the tile's rounded corner, canvas inside the tile, ocean inside the globe.
    const big = renderMark(name, 1024);
    const at = (x: number, y: number) => [...big.subarray((y * 1024 + x) * 4, (y * 1024 + x) * 4 + 4)];
    assert.equal(at(2, 2)[3], 0, `${name}: the corner is transparent`);
    assert.deepEqual(at(512, 40), [...hex(way.canvas), 255], `${name}: the tile is canvas`);
    assert.deepEqual(at(512, 200), [...hex(way.ocean), 255], `${name}: the globe is ocean`);
  }
});

test("8.2 · each colourway's .ico and .icns hold the committed PNGs at the sizes Windows and macOS read", () => {
  assert.deepEqual(ICO_SIZES, [16, 32, 48, 64, 128, 256]);
  assert.deepEqual({ ...ICNS_TYPES }, { icp4: 16, icp5: 32, icp6: 64, ic07: 128, ic08: 256, ic09: 512, ic10: 1024 });
  for (const name of Object.keys(COLOURWAYS)) {
    const ico = readIco(readFileSync(iconPath(name, "mark.ico")));
    assert.deepEqual(ico.map((e) => e.size), ICO_SIZES);
    for (const entry of ico) assert.ok(entry.png.equals(readFileSync(iconPath(name, `${entry.size}.png`))), `${name} .ico ${entry.size}`);

    const icns = readIcns(readFileSync(iconPath(name, "mark.icns")));
    assert.deepEqual(icns.map((e) => e.type), Object.keys(ICNS_TYPES));
    for (const entry of icns) {
      assert.ok(entry.png.equals(readFileSync(iconPath(name, `${ICNS_TYPES[entry.type]}.png`))), `${name} .icns ${entry.type}`);
    }
  }
});

test("8.1 · the small-size drawing is the master's own shapes: the globe fills the tile, the islets go, the island and tree grow 1.75 times and the tree is bolder", () => {
  const globe = (shapes: readonly (typeof SHAPES)[number][]) => shapes.find((s) => s.role === "ocean")!;
  assert.deepEqual(globe(SMALL_SHAPES), { kind: "circle", role: "ocean", cx: 52, cy: 52, r: 50 }, "the globe fills the 104 tile");
  assert.equal(SMALL_SHAPES.filter((s) => s.kind === "ellipse").length, 0, "no islets");
  const island = (shapes: readonly (typeof SHAPES)[number][]) => shapes.find((s) => s.kind === "blob")!;
  const [master, small] = [island(SHAPES), island(SMALL_SHAPES)];
  assert.ok(master.kind === "blob" && small.kind === "blob");
  assert.equal(small.curves, master.curves, "the island is the master's own outline");
  assert.equal(small.frame.s, 1.75 * master.frame.s);
  const roles = (shapes: readonly (typeof SHAPES)[number][]) => shapes.map((s) => `${s.kind}:${s.role}`);
  assert.deepEqual(roles(SMALL_SHAPES), roles(SHAPES).filter((r) => r !== "ellipse:land"), "the master's shapes and roles in the master's order");
  const leaf = (shapes: readonly (typeof SHAPES)[number][]) => shapes.find((s) => s.role === "leaf")!;
  const line = (shapes: readonly (typeof SHAPES)[number][]) => shapes.find((s) => s.kind === "line")!;
  const [ml, sl] = [leaf(SHAPES), leaf(SMALL_SHAPES)];
  assert.ok(ml.kind === "circle" && sl.kind === "circle");
  assert.ok(sl.r > 1.75 * ml.r, "the leaf dots are bolder than the plain 1.75 times");
  const [mw, sw] = [line(SHAPES), line(SMALL_SHAPES)];
  assert.ok(mw.kind === "line" && sw.kind === "line");
  assert.ok(sw.width * sw.frame.s > 1.75 * mw.width * mw.frame.s, "the tree's lines are bolder than the plain 1.75 times");
});

function hex(colour: string): number[] {
  return [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16));
}
