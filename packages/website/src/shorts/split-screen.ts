/** Capability 6 · Pixel-art shorts. The spike's split screen, drawn at 320×180 from the frame number alone: the developer
 * without storytree on the left, buried in windows; the right half is left for the globe; one caption under both.
 * Everything here is whole-pixel rectangles and thresholded pixel-font text, so the ×6 picture keeps hard edges. */

/** The low-resolution frame every short is drawn at, and the whole number it is scaled up by to 1920×1080. */
export const LOW = { width: 320, height: 180 } as const;
export const SCALE = 6;
/** Where the real globe is copied in, in low-resolution pixels. */
export const GLOBE_BOX = { x: 160, y: 16, width: 160, height: 146 } as const;
/** The pixel font (OFL, committed beside its licence), drawn at its native 8px size. */
export const FONT = "Press Start 2P";

const INK = {
  wall: "#1b1f2b", floor: "#11131a", desk: "#6b4a2f", deskTop: "#8a6240", monitor: "#2a2f3a", screen: "#123a2a", code: "#3fae6a",
  hair: "#3a2a1e", skin: "#e0a878", shirt: "#4a6fa5", shirtDark: "#38557f", chair: "#2c2c34", sweat: "#8fd3ff",
  frame: "#c9ced6", body: "#eef0f3", line: "#8a909c", divider: "#0b0d12",
  without: "#ff7a6b", with: "#7ee07e", caption: "#ffffff", counter: "#ffd34d",
} as const;
const TITLE_BARS = ["#d65a5a", "#5a8fd6", "#d6b45a", "#6ac46a", "#b06ad6"] as const;

/** A sprite as rows of characters, one per pixel; "." is see-through. */
type Sprite = { rows: readonly string[]; ink: Readonly<Record<string, string>> };

/** The developer seen from behind, in their chair, facing the monitor. */
const DEVELOPER: Sprite = {
  rows: [
    "......hhhhhh......",
    ".....hhhhhhhh.....",
    "....hhhhhhhhhh....",
    "....hhhhhhhhhh....",
    "....hhhhhhhhhh....",
    "....shhhhhhhhs....",
    ".....hhhhhhhh.....",
    "......ssssss......",
    ".......ssss.......",
    "..ccttttttttttcc..",
    ".cctttttttttttdcc.",
    ".ctttttttttttttdc.",
    ".ctttttttttttttdc.",
    ".ctttttttttttttdc.",
    ".ctttttttttttttdc.",
    ".ccccccccccccccccc",
    ".cccccccccccccccc.",
  ],
  ink: { h: INK.hair, s: INK.skin, t: INK.shirt, d: INK.shirtDark, c: INK.chair },
};

/** A hand raised to scratch the head, drawn over the sprite every other beat. */
const SCRATCH: Sprite = { rows: ["ss", "ss", "tt", "tt", "tt"], ink: { s: INK.skin, t: INK.shirt } };

function sprite(ctx: CanvasRenderingContext2D, { rows, ink }: Sprite, x: number, y: number): void {
  rows.forEach((row, dy) => [...row].forEach((cell, dx) => {
    const colour = ink[cell];
    if (colour === undefined) return;
    ctx.fillStyle = colour;
    ctx.fillRect(x + dx, y + dy, 1, 1);
  }));
}

/** A deterministic number in [0, 1) from a seed: the windows land in the same places in every render. */
function hash(seed: number): number {
  let n = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  n = Math.imul(n ^ (n >>> 13), 0xc2b2ae35);
  return ((n ^ (n >>> 16)) >>> 0) / 2 ** 32;
}

/** How many files the developer has opened by `frame` of `frames`: the counter ticks from 12 to 47. */
export function filesOpened(frame: number, frames: number): number {
  return 12 + Math.floor(35 * Math.min(frame, frames - 1) / (frames - 1));
}

/** One window of file names and doc lines: it pops up at `born` and its lines scroll while it is open. */
function fileWindow(ctx: CanvasRenderingContext2D, index: number, frame: number): void {
  const width = 44 + Math.floor(hash(index * 7 + 1) * 18), height = 28 + Math.floor(hash(index * 7 + 2) * 14);
  const x = 4 + Math.floor(hash(index * 7 + 3) * (156 - 8 - width)), y = 18 + Math.floor(hash(index * 7 + 4) * 70);
  ctx.fillStyle = INK.divider;
  ctx.fillRect(x + 2, y + 2, width, height);
  ctx.fillStyle = INK.frame;
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = TITLE_BARS[index % TITLE_BARS.length]!;
  ctx.fillRect(x + 1, y + 1, width - 2, 4);
  ctx.fillStyle = INK.body;
  ctx.fillRect(x + width - 5, y + 2, 2, 2);
  ctx.fillRect(x + 1, y + 6, width - 2, height - 7);
  ctx.fillStyle = INK.line;
  const scroll = Math.floor(frame / 3);
  for (let row = 0; row * 3 + 1 < height - 8; row++) {
    const line = row + scroll + index * 5;
    ctx.fillRect(x + 3 + (hash(line * 3 + 9) < 0.3 ? 4 : 0), y + 8 + row * 3, 6 + Math.floor(hash(line * 3 + 8) * (width - 14)), 1);
  }
}

/** Text in the pixel font on its own layer, every pixel either fully drawn or not at all: no soft edges. */
function pixelText(ctx: CanvasRenderingContext2D, lines: readonly { text: string; x: number; y: number; colour: string; centre?: boolean }[]): void {
  const layer = new OffscreenCanvas(LOW.width, LOW.height).getContext("2d")!;
  layer.font = `8px "${FONT}"`;
  layer.textBaseline = "top";
  for (const { text, x, y, colour, centre } of lines) {
    layer.fillStyle = colour;
    layer.fillText(text, centre ? Math.round(x - layer.measureText(text).width / 2) : x, y);
  }
  const image = layer.getImageData(0, 0, LOW.width, LOW.height);
  for (let i = 3; i < image.data.length; i += 4) image.data[i] = image.data[i]! >= 128 ? 255 : 0;
  layer.putImageData(image, 0, 0);
  ctx.drawImage(layer.canvas, 0, 0);
}

/** The whole low-resolution frame: the left half drawn here, `globe` (the real globe's own low-resolution picture)
 * copied into the right half, then the labels, the counter and the caption over both. */
export function drawSplitScreen(ctx: CanvasRenderingContext2D, frame: number, frames: number, globe: CanvasImageSource): void {
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = INK.wall;
  ctx.fillRect(0, 0, LOW.width, LOW.height);
  ctx.fillStyle = INK.floor;
  ctx.fillRect(0, 140, 160, 40);
  // The desk, the monitor's scrolling code, and the developer in front of it.
  ctx.fillStyle = INK.monitor;
  ctx.fillRect(56, 92, 48, 30);
  ctx.fillRect(76, 122, 8, 4);
  ctx.fillStyle = INK.screen;
  ctx.fillRect(58, 94, 44, 26);
  ctx.fillStyle = INK.code;
  for (let row = 0; row < 8; row++) ctx.fillRect(60 + (hash(row + frame) < 0.4 ? 4 : 0), 96 + row * 3, 8 + Math.floor(hash(row * 5 + Math.floor(frame / 2)) * 28), 1);
  ctx.fillStyle = INK.deskTop;
  ctx.fillRect(16, 126, 128, 3);
  ctx.fillStyle = INK.desk;
  ctx.fillRect(16, 129, 128, 4);
  ctx.fillRect(20, 133, 4, 14);
  ctx.fillRect(136, 133, 4, 14);
  const beat = Math.floor(frame / 8);
  sprite(ctx, DEVELOPER, 71, 119 + (beat % 4 === 3 ? 1 : 0));
  if (beat % 2 === 1) sprite(ctx, SCRATCH, 74, 115);
  if (frame % 40 >= 20) { ctx.fillStyle = INK.sweat; ctx.fillRect(90, 121 + Math.floor((frame % 20) / 5), 1, 2); }
  // A window of file names or doc pages pops up every 12 frames, and none closes.
  for (let index = 0; index * 12 <= frame; index++) fileWindow(ctx, index, frame);
  ctx.fillStyle = INK.divider;
  ctx.fillRect(0, 140, 160, 2);
  // The right half: the real globe, drawn at this resolution.
  ctx.drawImage(globe, GLOBE_BOX.x, GLOBE_BOX.y, GLOBE_BOX.width, GLOBE_BOX.height);
  ctx.fillStyle = INK.divider;
  ctx.fillRect(0, 0, LOW.width, 15);
  ctx.fillRect(0, 162, LOW.width, 18);
  ctx.fillRect(159, 0, 2, 162);
  pixelText(ctx, [
    { text: "WITHOUT STORYTREE", x: 80, y: 4, colour: INK.without, centre: true },
    { text: "WITH STORYTREE", x: 240, y: 4, colour: INK.with, centre: true },
    { text: `FILES OPENED ${filesOpened(frame, frames)}`, x: 80, y: 149, colour: INK.counter, centre: true },
    { text: "SEE WHAT YOUR AGENTS BUILT.", x: 160, y: 167, colour: INK.caption, centre: true },
  ]);
}
