/** Capability 2 · Fixed-colour icon files: where they live in the repo, and writing them all from the master. */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { COLOURWAYS, markSvg } from "./drawing.js";
import { ICNS_TYPES, ICO_SIZES, PNG_SIZES, writeIcns, writeIco, writePng } from "./files.js";
import { renderMark } from "./raster.js";

/** A fixed-colour file of a colourway: packages/mark/icons/<colourway>/<file>. */
export function iconPath(colourway: string, file: string): string {
  return fileURLToPath(new URL(`../icons/${colourway}/${file}`, import.meta.url));
}

/** Writes every colourway's SVG, PNGs, .ico and .icns from the master drawing. */
export function writeIcons(): string[] {
  const written: string[] = [];
  const put = (path: string, data: string | Buffer) => { writeFileSync(path, data); written.push(path); };
  for (const name of Object.keys(COLOURWAYS)) {
    mkdirSync(iconPath(name, ""), { recursive: true });
    put(iconPath(name, "mark.svg"), markSvg(name));
    const pngs = new Map(PNG_SIZES.map((size) => [size, writePng(renderMark(name, size), size)]));
    for (const [size, png] of pngs) put(iconPath(name, `${size}.png`), png);
    put(iconPath(name, "mark.ico"), writeIco(ICO_SIZES.map((size) => ({ size, png: pngs.get(size)! }))));
    put(iconPath(name, "mark.icns"), writeIcns(Object.entries(ICNS_TYPES).map(([type, size]) => ({ type, png: pngs.get(size)! }))));
  }
  return written;
}
