/** Marketing artifacts 1.1–2.2, the mark: the master drawing in the caller's colours, its named colourways, and the fixed-colour files generated from it. */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

import { COLOURWAYS, ICNS_TYPES, ICO_SIZES, PNG_SIZES, iconPath, markSvg, readIcns, readIco, readPng, renderMark } from "./index.js";

const roles = { edge: "var(--o)", sheet: "var(--l)", tree: "var(--t)", leaf: "var(--f)" };

/** Every element that paints, with the colour it paints in and the slant it is drawn under. */
function painted(svg: string): { tag: string; colour: string; slant: string | undefined }[] {
  const out: { tag: string; colour: string; slant: string | undefined }[] = [];
  for (const [, tag, attrs] of svg.matchAll(/<(\w+)([^>]*?)\/?>/g)) {
    const colour = /(?:fill|stroke)="([^"]+)"/.exec(attrs ?? "")?.[1];
    if (tag !== "svg" && colour !== undefined) out.push({ tag: tag!, colour, slant: /transform="([^"]+)"/.exec(attrs ?? "")?.[1] });
  }
  return out;
}

test("1.1 · given four role colours, the SVG fills each role's shapes with its colour and carries no other colour", () => {
  const svg = markSvg(roles);
  assert.match(svg, /viewBox="0 0 104 104"/);
  const shapes = painted(svg);
  const of = (colour: string, tag: string) => shapes.filter((s) => s.colour === colour && s.tag === tag);
  assert.equal(of(roles.edge, "path").length, 1, "the sheet's edge is the edge role");
  assert.equal(of(roles.sheet, "path").length, 1, "the map sheet is the sheet role");
  assert.equal(of(roles.tree, "path").length, 1, "the trunk is tree");
  assert.equal(of(roles.leaf, "circle").length, 4, "the canopy's four circles are leaf");
  assert.equal(shapes.length, 7, "nothing else is drawn");
  assert.doesNotMatch(svg, /<rect/, "no tile without a canvas: the only rectangle the mark ever draws is the tile");
  assert.deepEqual(shapes.map((s) => s.colour).slice(0, 2), [roles.edge, roles.sheet], "the edge lies under the sheet, the tree on top");

  // The tree is drawn on the sheet: trunk and canopy lie under the sheet's own slant, and the edge under another.
  const slant = of(roles.sheet, "path")[0]!.slant;
  assert.match(slant ?? "", /^matrix\(/, "the sheet lies at a slant");
  for (const s of [...of(roles.tree, "path"), ...of(roles.leaf, "circle")]) assert.equal(s.slant, slant, `the ${s.tag} lies on the sheet`);
  assert.notEqual(of(roles.edge, "path")[0]!.slant, slant);

  const colours = [...svg.matchAll(/(?:fill|stroke)="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(new Set(colours), new Set(Object.values(roles)), "no colour the caller did not give");
  assert.doesNotMatch(svg, /#[0-9a-f]{3,8}\b|rgb\(/i);

  assert.throws(() => markSvg({ edge: "#000", sheet: "#111", tree: "#222" } as never), /leaf/);
});

test("1.2 · given a canvas or a named colourway, the SVG draws the tile in the canvas colour and the mark in that colourway's roles", () => {
  const tiled = painted(markSvg({ ...roles, canvas: "var(--c)" }));
  assert.equal(tiled.length, 8);
  assert.deepEqual(tiled[0], { tag: "rect", colour: "var(--c)", slant: undefined }, "the tile is drawn first, behind the mark, upright");
  assert.match(markSvg({ ...roles, canvas: "var(--c)" }), /<rect[^>]*width="104"[^>]*height="104"[^>]*rx="24"/);

  assert.deepEqual(Object.keys(COLOURWAYS).sort(), ["day", "night"]);
  for (const [name, way] of Object.entries(COLOURWAYS)) {
    const shapes = painted(markSvg(name));
    assert.equal(shapes[0]!.colour, way.canvas);
    assert.equal(shapes[2]!.colour, way.sheet, `${name}: the sheet`);
    assert.deepEqual(new Set(shapes.map((s) => s.colour)), new Set([way.canvas, way.sheet, way.edge, way.tree, way.leaf]));
  }
  assert.throws(() => markSvg("dusk"), /day.*night/);
});

test("2.1 · each committed PNG holds the mark rendered at its size in its colourway", () => {
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
    // At 16 pixels the one drawing still reads: the trunk keeps at least one pixel that is nearly the tree's colour.
    const far = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
    const tiny = renderMark(name, 16);
    const nearest = Math.min(...Array.from({ length: 256 }, (_, i) => far([...tiny.subarray(i * 4, i * 4 + 3)], hex(way.tree))));
    assert.ok(nearest <= 0.25 * far(hex(way.sheet), hex(way.tree)), `${name}: at 16 the trunk is a smudge, ${Math.round(nearest)} from the tree's colour`);
    // What the render shows, at points of the 104 box: transparent beyond the tile's rounded corner, canvas above the sheet,
    // and on the slanted sheet its own colour, the canopy and the trunk, with the edge showing below it.
    const big = renderMark(name, 1024);
    const at = (x: number, y: number) => {
      const [px, py] = [Math.round((x * 1024) / 104), Math.round((y * 1024) / 104)];
      return [...big.subarray((py * 1024 + px) * 4, (py * 1024 + px) * 4 + 4)];
    };
    assert.equal(at(0.2, 0.2)[3], 0, `${name}: the corner is transparent`);
    assert.deepEqual(at(52, 4), [...hex(way.canvas), 255], `${name}: the tile is canvas`);
    assert.deepEqual(at(18.25, 35.15), [...hex(way.sheet), 255], `${name}: the sheet's near corner`);
    assert.deepEqual(at(47.2, 37.2), [...hex(way.leaf), 255], `${name}: the canopy`);
    assert.deepEqual(at(58, 66), [...hex(way.tree), 255], `${name}: the trunk`);
    assert.deepEqual(at(50.5, 85.4), [...hex(way.edge), 255], `${name}: the edge below the sheet`);
  }
});

test("2.2 · each colourway's .ico and .icns hold the committed PNGs at the sizes Windows and macOS read", () => {
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

function hex(colour: string): number[] {
  return [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16));
}
