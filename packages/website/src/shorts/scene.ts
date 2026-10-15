/** Capability 6 · Pixel-art shorts. One frame of the first short at 320×180, from the time alone: the same developer on both
 * halves, drawn from the cast's sheet, with their thoughts in bubbles; documents pile up on the left, and on the right the
 * real view sits in the corner inset. Everything is whole-pixel rectangles and sheet frames, so the ×6 picture keeps hard
 * edges. The words are handed back for the pixel font to draw on its own layer. */
import { poseFrame, propFrame, type CastMap, type Rect } from "./cast.js";
import { beatAt, beats, END_CARD, HALF, INSET, layBubble, LOW, terminalLines, TERMINAL, LINE, PAD, type Beat, type Prop, type Side } from "./script.js";
import { ISLAND } from "./view.js";

export const INK = {
  wall: "#1b1f2b", floor: "#11131a", skirting: "#0b0d12", divider: "#0b0d12",
  bubble: "#f4f1e8", bubbleEdge: "#0b0d12", words: "#1b1f2b",
  terminal: "#0c0f14", terminalEdge: "#3fae6a", typed: "#7ee07e",
  insetEdge: "#c9ced6", cursor: "#ffffff",
  without: "#ff7a6b", with: "#7ee07e", caption: "#ffffff", url: "#ffd34d",
} as const;

export type Words = { text: string; x: number; y: number; colour: string; centre?: boolean };
export type SceneInputs = { seconds: number; frames: number; cast: CastMap; sheet: CanvasImageSource; view: CanvasImageSource };

/** Where the scene's furniture stands, in a half's own pixels: top-left corners, the floor at y 150. */
const FLOOR = 150;
const PLACES: Record<Prop | "developer", { x: number; y: number }> = {
  developer: { x: 18, y: 94 }, desk: { x: 52, y: 124 }, monitor: { x: 98, y: 98 }, mug: { x: 134, y: 116 },
  window: { x: 58, y: 84 }, document: { x: 0, y: 0 },
};
/** Typing speed, in characters a second: the paragraph pours out, the exact words are picked. */
const TYPED_PER_SECOND = { without: 40, with: 10 } as const;
const SCRIPT = beats(ISLAND.title);

/** A deterministic number in [0, 1) from a seed: the documents land in the same places in every render. */
function hash(seed: number): number {
  let n = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  n = Math.imul(n ^ (n >>> 13), 0xc2b2ae35);
  return ((n ^ (n >>> 16)) >>> 0) / 2 ** 32;
}

function blit(ctx: CanvasRenderingContext2D, sheet: CanvasImageSource, frame: Rect, x: number, y: number): void {
  ctx.drawImage(sheet, frame.x, frame.y, frame.w, frame.h, x, y, frame.w, frame.h);
}

function box(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, fill: string, edge: string): void {
  ctx.fillStyle = edge;
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = fill;
  ctx.fillRect(x + 1, y + 1, width - 2, height - 2);
}

/** A bubble with its tail toward the developer's head: dots trailing down for a thought, a wedge for speech. */
function bubble(ctx: CanvasRenderingContext2D, side: Side, { kind, text }: NonNullable<Beat["bubble"]>, words: Words[]): void {
  const laid = layBubble(side, text);
  box(ctx, laid.x, laid.y, laid.width, laid.height, INK.bubble, INK.bubbleEdge);
  const [cx, bottom] = [HALF[side] + PLACES.developer.x + 22, laid.y + laid.height];
  if (kind === "think") for (const [dy, size] of [[3, 4], [10, 3], [16, 2]] as const) {
    box(ctx, cx - Math.floor(size / 2), bottom + dy, size + 2, size + 2, INK.bubble, INK.bubbleEdge);
  } else for (let row = 0; row < 6; row++) {
    ctx.fillStyle = INK.bubbleEdge;
    ctx.fillRect(cx - 4 + row, bottom - 1 + row, 7 - row * 1, 1);
    ctx.fillStyle = INK.bubble;
    if (row < 5) ctx.fillRect(cx - 3 + row, bottom - 1 + row, 5 - row, 1);
  }
  laid.lines.forEach((line, row) => words.push({ text: line, x: laid.x + PAD, y: laid.y + PAD + row * LINE, colour: INK.words }));
}

/** The terminal the developer types to their agent in, with a blinking block cursor after the last character. */
function terminal(ctx: CanvasRenderingContext2D, side: Side, typed: string, seconds: number, words: Words[]): void {
  const { x, y, width } = TERMINAL[side], left = HALF[side] + x;
  box(ctx, left, y, width, TERMINAL.rows * LINE + 2 * PAD, INK.terminal, INK.terminalEdge);
  const lines = terminalLines(side, typed, Math.floor(seconds * TYPED_PER_SECOND[side]));
  lines.forEach((line, row) => words.push({ text: line, x: left + PAD, y: y + PAD + row * LINE, colour: INK.typed }));
  if (Math.floor(seconds * 3) % 2 === 0) {
    const last = lines[lines.length - 1] ?? "";
    ctx.fillStyle = INK.typed;
    ctx.fillRect(left + PAD + last.length * 8 + (last ? 1 : 0), y + PAD + Math.max(0, lines.length - 1) * LINE, 6, 8);
  }
}

/** One floating document of the pile on the left: it lands at a fixed spot, half a second after the one before. */
function documents(ctx: CanvasRenderingContext2D, cast: CastMap, sheet: CanvasImageSource, seconds: number): void {
  const frame = propFrame(cast, "document");
  const count = Math.min(24, Math.max(0, Math.floor((seconds - 1.5) / 0.5)));
  for (let index = 0; index < count; index++) {
    blit(ctx, sheet, frame, 4 + Math.floor(hash(index * 3 + 1) * (156 - frame.w - 4)), 19 + Math.floor(hash(index * 3 + 2) * (PLACES.developer.y - frame.h - 19)));
  }
}

/** One half: wall, window, desk, monitor, mug and the developer in the pose the beat names. */
function room(ctx: CanvasRenderingContext2D, side: Side, beat: Beat, { seconds, cast, sheet }: SceneInputs): void {
  const left = HALF[side];
  ctx.fillStyle = INK.wall;
  ctx.fillRect(left, 15, 160, FLOOR - 15);
  ctx.fillStyle = INK.floor;
  ctx.fillRect(left, FLOOR, 160, 162 - FLOOR);
  ctx.fillStyle = INK.skirting;
  ctx.fillRect(left, FLOOR - 2, 160, 2);
  for (const prop of ["window", "desk", "monitor", "mug"] as const) blit(ctx, sheet, propFrame(cast, prop), left + PLACES[prop].x, PLACES[prop].y);
  blit(ctx, sheet, poseFrame(cast, beat.pose, seconds - beat.from), left + PLACES.developer.x, PLACES.developer.y);
}

/** Draws the frame at `seconds` and returns the words for the pixel font, over everything else. */
export function drawScene(ctx: CanvasRenderingContext2D, inputs: SceneInputs): Words[] {
  const { seconds, cast, sheet, view } = inputs, words: Words[] = [];
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = INK.divider;
  ctx.fillRect(0, 0, LOW.width, LOW.height);
  if (seconds >= END_CARD) {
    words.push({ text: "SEE WHAT YOUR", x: 160, y: 70, colour: INK.caption, centre: true },
      { text: "AGENTS BUILT.", x: 160, y: 82, colour: INK.caption, centre: true },
      { text: "storytree.dev", x: 160, y: 104, colour: INK.url, centre: true });
    return words;
  }
  for (const side of ["without", "with"] as const) {
    const beat = beatAt(SCRIPT[side], seconds);
    room(ctx, side, beat, inputs);
    if (side === "without") documents(ctx, cast, inputs.sheet, seconds);
    else {
      box(ctx, INSET.x - 1, INSET.y - 1, INSET.width + 2, INSET.height + 2, INK.terminal, INK.insetEdge);
      ctx.drawImage(view, INSET.x, INSET.y, INSET.width, INSET.height);
      if (beat.pose === "inspecting" && beat.looks === "island" && Math.floor(seconds * 2) % 2 === 0) {
        ctx.fillStyle = INK.cursor;
        const [cx, cy] = [INSET.x + INSET.width / 2, INSET.y + INSET.height / 2 - 4];
        for (let row = 0; row < 6; row++) ctx.fillRect(cx, cy + row, Math.min(row + 1, 4), 1);
      }
    }
    if (beat.bubble) bubble(ctx, side, beat.bubble, words);
    if (beat.typed) terminal(ctx, side, beat.typed, seconds - beat.from, words);
  }
  ctx.fillStyle = INK.divider;
  ctx.fillRect(159, 0, 2, 162);
  words.push({ text: "WITHOUT STORYTREE", x: 80, y: 4, colour: INK.without, centre: true },
    { text: "WITH STORYTREE", x: 240, y: 4, colour: INK.with, centre: true },
    { text: "SEE WHAT YOUR AGENTS BUILT.", x: 160, y: 167, colour: INK.caption, centre: true });
  return words;
}
