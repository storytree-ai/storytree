/**
 * Capability 1 · Home page. The site wears the mark (story The mark): inline beside its name, where the four roles read the
 * stylesheet's --mark-* colours, and as its favicon, which follows the visitor's light or dark setting.
 */
import { copyFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { COLOURWAYS, iconPath, markSvg, renderMark, writePng } from "@storytree/mark";

const ROLES = ["canvas", "ocean", "land", "tree", "leaf"] as const;
const byVariable = { canvas: "var(--mark-canvas)", ocean: "var(--mark-ocean)", land: "var(--mark-land)", tree: "var(--mark-tree)", leaf: "var(--mark-leaf)" };
/** The fixed-colour fallbacks (.ico, Apple touch icon) use day: its light tile reads on light and dark browser chrome alike. */
const FALLBACK = "day";

/** The mark for a page: no tile, no colour of its own, hidden from screen readers because the name beside it says it. */
export function inlineMark(): string {
  const { canvas: _, ...roles } = byVariable;
  return markSvg(roles).replace("<svg ", '<svg class="mark" ').replace(" xmlns=", ' aria-hidden="true" focusable="false" xmlns=')
    .replace(/\n\s*/g, "");
}

/** The favicon: the tile and the mark in day colours, and in night colours when the visitor's setting is dark. */
export function faviconSvg(): string {
  const declare = (name: string) => ROLES.map((role) => `--mark-${role}: ${COLOURWAYS[name]![role]};`).join(" ");
  const style = `  <style>:root { ${declare("day")} } @media (prefers-color-scheme: dark) { :root { ${declare("night")} } }</style>\n`;
  return markSvg(byVariable).replace(/(<svg[^>]*>\n)/, `$1${style}`);
}

/** Writes favicon.svg, favicon.ico and apple-touch-icon.png into the built site. */
export async function writeMarkFiles(output: string): Promise<void> {
  await writeFile(path.join(output, "favicon.svg"), faviconSvg());
  await copyFile(iconPath(FALLBACK, "mark.ico"), path.join(output, "favicon.ico"));
  await writeFile(path.join(output, "apple-touch-icon.png"), writePng(renderMark(FALLBACK, 180), 180));
}

/** The links every page's head carries for the favicon and its fallbacks. */
export const MARK_LINKS = [
  '<link rel="icon" href="/favicon.ico" sizes="32x32">',
  '<link rel="icon" href="/favicon.svg" type="image/svg+xml">',
  '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
].join("\n    ");
