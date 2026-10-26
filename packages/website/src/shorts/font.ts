/** Capability 6 · Pixel-art shorts. The screen font: 3×5 capitals drawn pixel by pixel, small enough that a monitor in the
 * room holds a readable line of a prompt, a reply or code. Lower case is drawn as capitals; a character it has no glyph
 * for is drawn as a blank. */
import { SMALL } from "./script.js";

const GLYPHS: Record<string, string> = {
  a: "### #.# ### #.# #.#", b: "### #.# ##. #.# ###", c: ".## #.. #.. #.. .##", d: "##. #.# #.# #.# ##.",
  e: "### #.. ##. #.. ###", f: "### #.. ##. #.. #..", g: ".## #.. #.# #.# .##", h: "#.# #.# ### #.# #.#",
  i: "### .#. .#. .#. ###", j: "### .#. .#. .#. ##.", k: "#.# #.# ##. #.# #.#", l: "#.. #.. #.. #.. ###",
  m: "### ### #.# #.# #.#", n: "##. #.# #.# #.# #.#", o: ".#. #.# #.# #.# .#.", p: "### #.# ### #.. #..",
  q: ".#. #.# #.# ##. .##", r: "### #.# ##. #.# #.#", s: ".## #.. .#. ..# ##.", t: "### .#. .#. .#. .#.",
  u: "#.# #.# #.# #.# .##", v: "#.# #.# #.# .#. .#.", w: "#.# #.# ### ### #.#", x: "#.# #.# .#. #.# #.#",
  y: "#.# #.# .#. .#. .#.", z: "### ..# .#. #.. ###",
  0: "### #.# #.# #.# ###", 1: "##. .#. .#. .#. ###", 2: "##. ..# .#. #.. ###", 3: "##. ..# .#. ..# ##.",
  4: "#.# #.# ### ..# ..#", 5: "### #.. ##. ..# ##.", 6: ".## #.. ### #.# ###", 7: "### ..# .#. .#. .#.",
  8: "### #.# ### #.# ###", 9: "### #.# ### ..# ##.",
  ".": "... ... ... ... .#.", ",": "... ... ... .#. #..", ":": "... .#. ... .#. ...", ";": "... .#. ... .#. #..",
  "!": ".#. .#. .#. ... .#.", "?": "##. ..# .#. ... .#.", "'": ".#. .#. ... ... ...", "\"": "#.# #.# ... ... ...",
  "-": "... ... ### ... ...", "_": "... ... ... ... ###", "/": "..# ..# .#. #.. #..", "(": ".#. #.. #.. #.. .#.",
  ")": ".#. ..# ..# ..# .#.", "[": "##. #.. #.. #.. ##.", "]": ".## ..# ..# ..# .##", "{": ".## .#. ##. .#. .##",
  "}": "##. .#. .## .#. ##.", "<": "..# .#. #.. .#. ..#", ">": "#.. .#. ..# .#. #..", "=": "... ### ... ### ...",
  "+": "... .#. ### .#. ...", "*": "#.# .#. #.# ... ...", "·": "... ... .#. ... ...", "●": "... ### ### ### ...",
  "&": ".#. #.# .#. #.# .##", "%": "#.# ..# .#. #.. #.#", "#": "#.# ### #.# ### #.#", "@": "### #.# #.# #.. .##",
  "|": ".#. .#. .#. .#. .#.", "^": ".#. #.# ... ... ...", "\\": "#.. #.. .#. ..# ..#", "✓": "... ..# ..# #.# .#.", "$": ".## ##. .#. .## ##.", "`": "#.. .#. ... ... ...",
};
const ROWS = new Map(Object.entries(GLYPHS).map(([char, rows]) => [char, rows.split(" ")]));

/** Whether the screen font draws `char` (a space is always drawn, as nothing). */
export const drawable = (char: string) => char === " " || ROWS.has(char.toLowerCase());

/** Draws `text` with its top-left corner at (x, y), one glyph every SMALL.advance pixels, and no further right than `right`. */
export function small(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, colour: string, right = Infinity): void {
  ctx.fillStyle = colour;
  [...text].forEach((char, index) => {
    const left = x + index * SMALL.advance, rows = ROWS.get(char.toLowerCase());
    if (!rows || left + 3 > right) return;
    rows.forEach((row, dy) => { for (let dx = 0; dx < 3; dx++) if (row[dx] === "#") ctx.fillRect(left + dx, y + dy, 1, 1); });
  });
}
