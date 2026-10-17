/** Capability 6 · Pixel-art shorts. One frame of the first short at 320×180, from the time alone. Each half is the same room
 * seen from behind the developer, as in the owner's reference: his monitor on the left of his desk, readable, and him in his
 * chair beside it. The screen shows Claude Code, the code, or (on the storytree side) the map: the real view, with the
 * island's panel open once he clicks it. A beat may cut to a full view of the screen. Everything is whole-pixel rectangles,
 * the screen font's pixels and sheet frames, so the ×6 picture keeps hard edges. The pixel font's words are handed back
 * for it to draw on its own layer. */
import { poseFrame, propFrame, type CastMap, type Rect as Frame } from "./cast.js";
import { small } from "./font.js";
import { beatAt, beats, chatAt, columnsOf, END_CARD, HALF, layBubble, LINE, LOW, PAD, SCREEN, SEAT, SMALL, wrap,
  type Beat, type Rect, type Side } from "./script.js";
import { CLICK_AT, clickedFor, GROUNDING, PANEL, PANEL_AT } from "./view.js";

export const INK = {
  divider: "#0b0d12", wall: "#1d2130", wallShade: "#181b28", floor: "#121420", skirting: "#0b0d12",
  bubble: "#f4f1e8", bubbleEdge: "#0b0d12", words: "#1b1f2b",
  bezel: "#2b2f3a", bezelEdge: "#08090d", glow: "#3fd6e8",
  desk: "#3a2c28", deskTop: "#56423a", deskEdge: "#08090d", keys: "#4a4f5c",
  sky: "#18264a", moon: "#f2e6b6", frame: "#2b2f3a", tower: "#22252e", led: "#3fae6a",
  claude: "#15171d", accent: "#d97757", you: "#ecebe6", prompt: "#7b8190", reply: "#b9c0cc",
  editor: "#1b1e28", tabBar: "#13151c", tab: "#2a2f3d", gutter: "#4b5263", code: "#d7dae0", keyword: "#c678dd",
  text: "#98c379", note: "#5c6370",
  map: "#0d1117", panel: "#1e222b", panelEdge: "#3a404d", healthy: "#3fae6a", untested: "#c9a227", failing: "#e5534b",
  cursor: "#ffffff", cursorEdge: "#08090d",
  without: "#ff7a6b", with: "#7ee07e", caption: "#ffffff", url: "#ffd34d",
} as const;

export type Words = { text: string; x: number; y: number; colour: string; centre?: boolean };
export type SceneInputs = { seconds: number; frames: number; cast: CastMap; sheet: CanvasImageSource; view: CanvasImageSource };

const SCRIPT = beats(GROUNDING);
/** How far his walk out of the room has carried him, in pixels a second. */
const WALK_SPEED = 70;
/** The room's floor line, and where the desk's top and front stand. */
const FLOOR = 166, DESK = { x: 0, y: 116, width: 126, height: 6 };

/** The code on the screen without storytree: what Opus wrote, file by file. */
const CODE: Record<string, readonly string[]> = {
  "src/main.ts": [
    "import { mountForest } from './forest';", "import { openWaitlist } from './waitlist';", "import { readCopy } from './copy';", "",
    "const page = document.body;", "const copy = await readCopy();", "", "// the hero, then the forest", "mountForest(page, copy.hero);",
    "", "const form = page.querySelector('form');", "form?.addEventListener('submit', async e => {", "  e.preventDefault();",
    "  const email = new FormData(form).get('email');", "  await openWaitlist().add(String(email));", "  form.reset();", "});",
  ],
  "src/waitlist/store.ts": [
    "import { check } from './check';", "import { db } from '../db';", "", "export function openWaitlist() {", "  return {",
    "    async add(email: string) {", "      if (!check(email)) return false;", "      const row = { email, at: Date.now() };",
    "      await db.insert('waitlist', row)", "        .onConflict('email').ignore();", "      return true;", "    },",
    "    count: () => db.count('waitlist'),", "  };", "}",
  ],
  "src/waitlist/check.ts": [
    "// is this an email we can send to?", "const shape = /^[^@ ]+@[^@ ]+\\.[a-z]+$/i;", "", "export function check(email: string) {",
    "  if (email.length > 254) return false;", "  if (!shape.test(email)) return false;", "  return !blocked(email);", "}", "",
    "function blocked(email: string) {", "  const domain = email.split('@')[1];", "  return BLOCKED.has(domain);", "}",
  ],
};
const KEYWORDS = new Set(["import", "from", "export", "function", "const", "return", "async", "await", "if", "new"]);

function blit(ctx: CanvasRenderingContext2D, sheet: CanvasImageSource, frame: Frame, x: number, y: number): void {
  ctx.drawImage(sheet, frame.x, frame.y, frame.w, frame.h, x, y, frame.w, frame.h);
}

function box(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, fill: string, edge: string): void {
  ctx.fillStyle = edge;
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = fill;
  ctx.fillRect(x + 1, y + 1, width - 2, height - 2);
}

/** A thought bubble over the monitor, its dots trailing down to the right toward his head. */
function bubble(ctx: CanvasRenderingContext2D, side: Side, text: string, words: Words[]): void {
  const laid = layBubble(side, text);
  box(ctx, laid.x, laid.y, laid.width, laid.height, INK.bubble, INK.bubbleEdge);
  const [cx, bottom] = [HALF[side] + 128, laid.y + laid.height];
  for (const [dy, dx, size] of [[3, 0, 4], [10, 3, 3], [16, 5, 2]] as const)
    box(ctx, cx + dx - Math.floor(size / 2), bottom + dy, size + 2, size + 2, INK.bubble, INK.bubbleEdge);
  laid.lines.forEach((line, row) => words.push({ text: line, x: laid.x + PAD, y: laid.y + PAD + row * LINE, colour: INK.words }));
}

/** Claude Code: its title, then the conversation's last lines, a blinking cursor while he types and a spinner while it works. */
function claude(ctx: CanvasRenderingContext2D, side: Side, screen: Rect, seconds: number): void {
  const { x, y, width, height } = screen, right = x + width - 2;
  ctx.fillStyle = INK.claude;
  ctx.fillRect(x, y, width, height);
  small(ctx, "claude code · opus 5.5", x + 3, y + 2, INK.accent, right);
  ctx.fillStyle = INK.accent;
  ctx.fillRect(x, y + 8, width, 1);
  const said = chatAt(side, SCRIPT[side], seconds), columns = columnsOf(width, SMALL.advance) - 2;
  const working = beatAt(SCRIPT[side], seconds).pose === "gone";
  const lines = said.flatMap(({ who, text }, index) => {
    const wrapped = text ? wrap(text, columns) : [""];
    return [...(index ? [{ who, text: "", mark: false }] : []), ...wrapped.map((line, row) => ({ who, text: line, mark: row === 0 }))];
  });
  const rows = Math.floor((height - 12 - (working ? SMALL.line : 0)) / SMALL.line);
  const shown = lines.slice(-rows), left = x + 3 + 2 * SMALL.advance;
  shown.forEach(({ who, text, mark }, row) => {
    const top = y + 11 + row * SMALL.line;
    if (mark) small(ctx, who === "you" ? ">" : "●", x + 3, top, who === "you" ? INK.prompt : INK.accent);
    small(ctx, text, left, top, who === "you" ? INK.you : INK.reply, right);
  });
  const last = said[said.length - 1];
  if (last?.who === "you" && Math.floor(seconds * 3) % 2 === 0) {
    const row = Math.max(0, shown.length - 1), end = shown[row]?.text.length ?? 0;
    ctx.fillStyle = INK.you;
    ctx.fillRect(left + end * SMALL.advance + (end ? 1 : 0), y + 11 + row * SMALL.line, 3, 5);
  }
  if (working) small(ctx, `${"*+"[Math.floor(seconds * 4) % 2]} working...`, x + 3, y + 11 + shown.length * SMALL.line + 1, INK.accent, right);
}

/** One line of code in the screen font, coloured by token: keywords, strings, comments, the rest. */
function codeLine(ctx: CanvasRenderingContext2D, line: string, x: number, y: number, right: number): void {
  if (line.trimStart().startsWith("//")) return small(ctx, line, x, y, INK.note, right);
  for (const token of line.match(/'[^']*'|\/[^/ ]+\/i|\w+|\s+|./g) ?? []) {
    const colour = KEYWORDS.has(token) ? INK.keyword : /^['/]/.test(token) && token.length > 1 ? INK.text : INK.code;
    small(ctx, token, x, y, colour, right);
    x += token.length * SMALL.advance;
  }
}

/** The editor: the open file's tab, then its lines, numbered, scrolling slowly as he reads. */
function code(ctx: CanvasRenderingContext2D, beat: Beat, screen: Rect, seconds: number): void {
  const { x, y, width, height } = screen, file = beat.file ?? "src/main.ts", lines = CODE[file] ?? [];
  ctx.fillStyle = INK.editor;
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = INK.tabBar;
  ctx.fillRect(x, y, width, 9);
  const name = file.split("/").pop()!;
  box(ctx, x + 2, y + 1, name.length * SMALL.advance + 5, 8, INK.tab, INK.tab);
  small(ctx, name, x + 4, y + 2, INK.code, x + width - 2);
  const rows = Math.floor((height - 12) / SMALL.line), most = Math.max(0, lines.length - rows);
  const scroll = Math.min(most, Math.floor(Math.max(0, seconds - beat.from - 0.8) * 2));
  lines.slice(scroll, scroll + rows).forEach((line, row) => {
    const top = y + 12 + row * SMALL.line, number = String(scroll + row + 1).padStart(2);
    small(ctx, number, x + 2, top, INK.gutter);
    codeLine(ctx, line, x + 13, top, x + width - 2);
  });
}

/** The mouse pointer, its tip at (x, y). */
function pointer(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  for (let row = 0; row < 7; row++) {
    ctx.fillStyle = INK.cursorEdge;
    ctx.fillRect(x - 1, y + row, Math.min(row + 1, 5) + 2, 1);
  }
  ctx.fillStyle = INK.cursor;
  for (let row = 0; row < 6; row++) ctx.fillRect(x, y + row, Math.min(row + 1, 4), 1);
}

const STATUS: Record<string, string> = { healthy: INK.healthy, untested: INK.untested, failing: INK.failing };
/** The island's detail panel, as the app's: its title, then a card per part with its health along the top. */
function panel(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, full: boolean): void {
  box(ctx, x, y, width, height, INK.panel, INK.panelEdge);
  const columns = columnsOf(width, SMALL.advance), right = x + width - 2;
  let top = y + 3;
  for (const line of wrap(PANEL.title, columns)) { small(ctx, line, x + 3, top, INK.you, right); top += SMALL.line; }
  top += 2;
  for (const part of PANEL.parts) {
    const lines = full ? wrap(part.title, columns - 1) : [part.title];
    const tall = lines.length * SMALL.line + 3;
    if (top + tall > y + height - 1) break;
    box(ctx, x + 2, top, width - 4, tall, INK.claude, INK.panelEdge);
    ctx.fillStyle = STATUS[part.status] ?? INK.gutter;
    ctx.fillRect(x + 2, top, width - 4, 2);
    lines.forEach((line, row) => small(ctx, line, x + 4, top + 3 + row * SMALL.line, INK.code, right - 1));
    top += tall + (full ? 2 : 0);
  }
}

/** The map: the real view, and after he clicks the island, its panel sliding in from the right. */
function map(ctx: CanvasRenderingContext2D, beat: Beat, screen: Rect, seconds: number, view: CanvasImageSource, full: boolean): void {
  const { x, y, width, height } = screen;
  ctx.fillStyle = INK.map;
  ctx.fillRect(x, y, width, height);
  const since = clickedFor(SCRIPT.with, seconds), wide = full ? 62 : 50;
  const open = since === undefined ? 0 : Math.max(0, Math.min(1, (since - (PANEL_AT - CLICK_AT)) / 0.3));
  const globe = Math.min(height - 4, width - 4 - Math.round(wide * open));
  const [gx, gy] = [x + Math.floor((width - Math.round(wide * open) - globe) / 2), y + Math.floor((height - globe) / 2)];
  ctx.drawImage(view, gx, gy, globe, globe);
  if (open) panel(ctx, x + width - Math.round(wide * open), y + 1, wide, height - 2, full);
  const [tx, ty] = [gx + Math.round(globe * 0.5), gy + Math.round(globe * 0.62)];
  if (beat.clicks) {
    const t = Math.max(0, Math.min(1, (seconds - beat.from - 0.3) / (CLICK_AT - 0.3)));
    const [px, py] = [Math.round(tx + (1 - t) * globe * 0.35), Math.round(ty + (1 - t) * globe * 0.25)];
    pointer(ctx, px, py);
    if (since !== undefined && since < 0.3) { ctx.fillStyle = INK.cursor; ctx.fillRect(px - 3, py - 3, 2, 2); ctx.fillRect(px + 2, py - 3, 2, 2); }
  }
}

/** What the screen shows in this beat, inside `screen`, in the frame's pixels. */
function screenOf(ctx: CanvasRenderingContext2D, side: Side, beat: Beat, screen: Rect, seconds: number, view: CanvasImageSource): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(screen.x, screen.y, screen.width, screen.height);
  ctx.clip();
  if (beat.app === "claude") claude(ctx, side, screen, seconds);
  else if (beat.app === "code") code(ctx, beat, screen, seconds);
  else map(ctx, beat, screen, seconds, view, beat.view === "full");
  ctx.restore();
}

/** The monitor around a screen: a dark bezel with a faint glow along its edge. */
function monitor(ctx: CanvasRenderingContext2D, screen: Rect): void {
  box(ctx, screen.x - 3, screen.y - 3, screen.width + 6, screen.height + 6, INK.bezel, INK.bezelEdge);
  ctx.fillStyle = INK.glow;
  ctx.fillRect(screen.x - 3, screen.y - 3, screen.width + 6, 1);
}

/** One half's room: wall, window, desk, the monitor on its stand, the tower, the keyboard. */
function room(ctx: CanvasRenderingContext2D, left: number): void {
  ctx.fillStyle = INK.wall;
  ctx.fillRect(left, 14, 160, FLOOR - 14);
  ctx.fillStyle = INK.wallShade;
  ctx.fillRect(left + 140, 14, 20, FLOOR - 14);
  ctx.fillStyle = INK.floor;
  ctx.fillRect(left, FLOOR, 160, LOW.height - FLOOR);
  ctx.fillStyle = INK.skirting;
  ctx.fillRect(left, FLOOR - 2, 160, 2);
  box(ctx, left + 122, 48, 32, 28, INK.sky, INK.bezelEdge);
  ctx.fillStyle = INK.frame;
  ctx.fillRect(left + 137, 49, 2, 26);
  ctx.fillRect(left + 123, 61, 30, 1);
  ctx.fillStyle = INK.moon;
  ctx.fillRect(left + 145, 52, 3, 3);
  ctx.fillRect(left + 128, 56, 1, 1);
  ctx.fillRect(left + 133, 66, 1, 1);
  box(ctx, left + 118, 86, 14, 32, INK.tower, INK.bezelEdge);
  ctx.fillStyle = INK.led;
  ctx.fillRect(left + 121, 89, 2, 1);
  ctx.fillStyle = INK.glow;
  ctx.fillRect(left + 120, 96, 1, 8);
  box(ctx, left + DESK.x - 1, DESK.y, DESK.width + 1, DESK.height, INK.deskTop, INK.deskEdge);
  box(ctx, left + DESK.x - 1, DESK.y + DESK.height - 1, DESK.width + 1, 5, INK.desk, INK.deskEdge);
  box(ctx, left + 4, DESK.y + DESK.height + 3, 5, FLOOR - DESK.y - DESK.height - 3, INK.desk, INK.deskEdge);
  box(ctx, left + 54, 114, 14, 3, INK.bezel, INK.bezelEdge);
  box(ctx, left + 58, 112, 6, 3, INK.bezel, INK.bezelEdge);
  monitor(ctx, { ...SCREEN.room, x: left + SCREEN.room.x });
  box(ctx, left + 70, DESK.y + 1, 30, 3, INK.keys, INK.deskEdge);
}

/** The developer in the pose his beat names; walking, he leaves his empty chair and slides out of his half. */
function developer(ctx: CanvasRenderingContext2D, left: number, beat: Beat, { seconds, cast, sheet }: SceneInputs): void {
  const [x, y] = [left + SEAT.x, SEAT.y];
  if (beat.pose === "gone" || beat.pose === "walking") blit(ctx, sheet, propFrame(cast, "chair"), x, y);
  if (beat.pose === "gone") return;
  const shift = beat.pose === "walking" ? Math.round((seconds - beat.from) * WALK_SPEED) : 0;
  blit(ctx, sheet, poseFrame(cast, beat.pose, seconds - beat.from), x - shift, y);
}

/** Draws the frame at `seconds` and returns the words for the pixel font, over everything else. */
export function drawScene(ctx: CanvasRenderingContext2D, inputs: SceneInputs): Words[] {
  const { seconds, view } = inputs, words: Words[] = [];
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
    const beat = beatAt(SCRIPT[side], seconds), left = HALF[side], full = beat.view === "full";
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, 14, 160, LOW.height - 14);
    ctx.clip();
    if (full) {
      ctx.fillStyle = INK.bezel;
      ctx.fillRect(left, 14, 160, LOW.height - 14);
      monitor(ctx, { ...SCREEN.full, x: left + SCREEN.full.x });
    } else room(ctx, left);
    const screen = SCREEN[full ? "full" : "room"];
    screenOf(ctx, side, beat, { ...screen, x: left + screen.x }, seconds, view);
    if (!full) developer(ctx, left, beat, inputs);
    if (beat.think) bubble(ctx, side, beat.think, words);
    ctx.restore();
  }
  ctx.fillStyle = INK.divider;
  ctx.fillRect(159, 0, 2, LOW.height);
  words.push({ text: "WITHOUT STORYTREE", x: 80, y: 4, colour: INK.without, centre: true },
    { text: "WITH STORYTREE", x: 240, y: 4, colour: INK.with, centre: true });
  return words;
}
