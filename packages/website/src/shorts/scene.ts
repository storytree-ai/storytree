/** Capability 6 · Pixel-art shorts. One frame of the first short at 320×180, from the time alone. Each half is the same room,
 * PixelLab's re-drawing of the owner's reference: the developer at his desk, hands on the keyboard, his monitor at a desk's
 * size. What the screen shows (Claude Code, the code, or on the storytree side the map) is drawn behind the room and shows
 * through its screen; a beat that needs the screen read cuts to a full view of it. Everything is whole-pixel rectangles, the
 * screen font's pixels and sheet frames, so the ×6 picture keeps hard edges. The pixel font's words are handed back for it to
 * draw on its own layer. */
import { poseFrame, propFrame, type CastMap, type Rect as Frame } from "./cast.js";
import { small } from "./font.js";
import { beatAt, beats, chatLines, END_CARD, focusAt, HALF, layBubble, LINE, LOW, PAD, SCREEN, SEAT, SMALL, TITLE, WINDOW, wrap,
  type Beat, type Focus, type Rect, type Side } from "./script.js";
import { CLICK_AT, clickedFor, GROUNDING, hovering, layPanel, panelOpen, PANEL, PANEL_AT } from "./view.js";

export const INK = {
  divider: "#0b0d12", wall: "#2a2838",
  bubble: "#f4f1e8", bubbleEdge: "#0b0d12", words: "#1b1f2b",
  bezel: "#1d1f27", bezelEdge: "#08090d", glow: "#3fd6e8",
  claude: "#15171d", accent: "#d97757", you: "#ecebe6", prompt: "#7b8190", reply: "#b9c0cc",
  editor: "#1b1e28", tabBar: "#13151c", tab: "#2a2f3d", gutter: "#4b5263", code: "#d7dae0", keyword: "#c678dd",
  text: "#98c379", note: "#5c6370",
  map: "#101418", panel: "#1e222b", panelEdge: "#3a404d", hover: "#2c3442", healthy: "#3fae6a", untested: "#c9a227", failing: "#e5534b",
  plate: "#ffd34d", plateWords: "#1b1f2b", name: "#c9ced8", nameplate: "#1a1f27",
  cursor: "#ffffff", cursorEdge: "#08090d",
  without: "#ff7a6b", with: "#7ee07e", caption: "#ffffff", url: "#ffd34d",
} as const;

export type Words = { text: string; x: number; y: number; colour: string; centre?: boolean };
/** Where the map's islands are drawn on the view's canvas, in its own CSS pixels, once it has drawn them. */
export type Marks = { islands: readonly { story: string; title: string; x: number; y: number; width: number; height: number }[] };
export type SceneInputs = { seconds: number; frames: number; cast: CastMap; sheet: CanvasImageSource; view: CanvasImageSource;
  /** The view canvas's size (the forest's own, before it was shrunk into `view`), and the islands on it. */
  map?: { width: number; height: number; marks?: Marks } };

export const SCRIPT = beats(GROUNDING);
/** How fast he walks out of the room, in pixels a second: turned round from where standing up left him (his figure's left at
 * column 30 of his cell, column 68 of a mirrored walking frame), his feet on the line standing up left them on (the walking
 * frames stand DOWN pixels higher in their cell), past the front of his chair and off the half's right edge. */
const WALK_SPEED = 120, WALK_FROM = 30 - 68, DOWN = 5;

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

/** A sheet frame drawn with its top-left at (x, y), mirrored left to right if asked (a whole-pixel flip). */
function blit(ctx: CanvasRenderingContext2D, sheet: CanvasImageSource, frame: Frame, x: number, y: number, mirror = false): void {
  if (!mirror) return ctx.drawImage(sheet, frame.x, frame.y, frame.w, frame.h, x, y, frame.w, frame.h);
  ctx.save();
  ctx.translate(x + frame.w, y);
  ctx.scale(-1, 1);
  ctx.drawImage(sheet, frame.x, frame.y, frame.w, frame.h, 0, 0, frame.w, frame.h);
  ctx.restore();
}

function box(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, fill: string, edge: string): void {
  ctx.fillStyle = edge;
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = fill;
  ctx.fillRect(x + 1, y + 1, width - 2, height - 2);
}

/** A one-pixel outline round `at`, leaving what is inside it showing. */
function ring(ctx: CanvasRenderingContext2D, at: Rect, colour: string): void {
  ctx.fillStyle = colour;
  ctx.fillRect(at.x, at.y, at.width, 1);
  ctx.fillRect(at.x, at.y + at.height - 1, at.width, 1);
  ctx.fillRect(at.x, at.y, 1, at.height);
  ctx.fillRect(at.x + at.width - 1, at.y, 1, at.height);
}

/** A thought bubble over the monitor; in the room its dots trail down to the developer's head. */
function bubble(ctx: CanvasRenderingContext2D, side: Side, text: string, room: boolean, words: Words[]): void {
  const laid = layBubble(side, text);
  box(ctx, laid.x, laid.y, laid.width, laid.height, INK.bubble, INK.bubbleEdge);
  const [cx, bottom] = [HALF[side] + 82, laid.y + laid.height];
  if (room) for (const [dy, dx, size] of [[4, 0, 4], [12, 3, 3], [20, 5, 2]] as const)
    box(ctx, cx + dx - Math.floor(size / 2), bottom + dy, size + 2, size + 2, INK.bubble, INK.bubbleEdge);
  laid.lines.forEach((line, row) => words.push({ text: line, x: laid.x + PAD, y: laid.y + PAD + row * LINE, colour: INK.words }));
}

/** Claude Code at a full view: its title, then the conversation's last lines, a blinking cursor while he types and a spinner
 * while it works. */
function claude(ctx: CanvasRenderingContext2D, side: Side, screen: Rect, seconds: number): void {
  const { x, y, width } = screen, right = x + width - 2;
  ctx.fillStyle = INK.claude;
  ctx.fillRect(x, y, width, screen.height);
  small(ctx, "claude code · opus 5.5", x + 3, y + 2, INK.accent, right);
  ctx.fillStyle = INK.accent;
  ctx.fillRect(x, y + 8, width, 1);
  const { said, lines } = chatLines(side, SCRIPT[side], seconds, screen);
  for (const { who, text, mark, x: left, y: top } of lines) {
    if (mark) small(ctx, who === "you" ? ">" : "●", x + 3, top, who === "you" ? INK.prompt : INK.accent);
    small(ctx, text, left, top, who === "you" ? INK.you : INK.reply, right);
  }
  const last = said[said.length - 1], end = lines[lines.length - 1];
  if (last?.who === "you" && end && Math.floor(seconds * 3) % 2 === 0) {
    ctx.fillStyle = INK.you;
    ctx.fillRect(end.x + end.text.length * SMALL.advance + (end.text ? 1 : 0), end.y, 3, 5);
  }
  if (beatAt(SCRIPT[side], seconds).pose === "gone")
    small(ctx, `${"*+"[Math.floor(seconds * 4) % 2]} working...`, x + 3, (end?.y ?? y + 5) + SMALL.line + 1, INK.accent, right);
}

/** Claude Code on the monitor in the room: the same conversation as bars of its colours, too small to read and not meant to be. */
function claudeMini(ctx: CanvasRenderingContext2D, side: Side, screen: Rect, seconds: number): void {
  const { x, y, width, height } = screen;
  ctx.fillStyle = INK.claude;
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = INK.accent;
  ctx.fillRect(x + 1, y + 1, 12, 1);
  ctx.fillRect(x, y + 3, width, 1);
  const { lines } = chatLines(side, SCRIPT[side], seconds, { ...SCREEN.full, x: 0, y: 0 });
  const shown = lines.slice(-Math.floor((height - 8) / 2));
  shown.forEach(({ who, text }, row) => {
    ctx.fillStyle = who === "you" ? INK.you : INK.reply;
    if (text) ctx.fillRect(x + 3, y + 5 + row * 2, Math.min(width - 5, Math.ceil(text.length * (width - 5) / 34)), 1);
  });
  // Once its developer has gone, Claude is busy: a spinner's bar sweeps under the conversation.
  if (beatAt(SCRIPT[side], seconds).pose === "gone") {
    ctx.fillStyle = INK.accent;
    ctx.fillRect(x + 3 + Math.floor(seconds * 8) % (width - 10), y + 5 + shown.length * 2 + 1, 4, 1);
  }
}

/** One line of code in the screen font, coloured by token: keywords, strings, comments, the rest. */
function codeLine(ctx: CanvasRenderingContext2D, line: string, x: number, y: number, right: number): void {
  if (line.trimStart().startsWith("//")) return small(ctx, line, x, y, INK.note, right);
  for (const token of line.match(/'[^']*'|\/[^/ ]+\/i|\w+|\s+|./g) ?? []) {
    small(ctx, token, x, y, tokenColour(token), right);
    x += token.length * SMALL.advance;
  }
}
const tokenColour = (token: string) => KEYWORDS.has(token) ? INK.keyword : /^['/]/.test(token) && token.length > 1 ? INK.text : INK.code;

/** How far the open file has scrolled `seconds` into its beat, in lines: slowly, as he reads. */
const scrolled = (beat: Beat, seconds: number, rows: number) =>
  Math.min(Math.max(0, (CODE[beat.file ?? ""] ?? []).length - rows), Math.floor(Math.max(0, seconds - beat.from - 1) * 1.5));

/** The editor at a full view: the open file's tab, then its lines, numbered. */
function code(ctx: CanvasRenderingContext2D, beat: Beat, screen: Rect, seconds: number): void {
  const { x, y, width, height } = screen, file = beat.file ?? "src/main.ts", lines = CODE[file] ?? [];
  ctx.fillStyle = INK.editor;
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = INK.tabBar;
  ctx.fillRect(x, y, width, 9);
  box(ctx, x + 2, y + 1, file.length * SMALL.advance + 5, 8, INK.tab, INK.tab);
  small(ctx, file, x + 4, y + 2, INK.code, x + width - 2);
  const rows = Math.floor((height - 12) / SMALL.line), scroll = scrolled(beat, seconds, rows);
  lines.slice(scroll, scroll + rows).forEach((line, row) => {
    const top = y + 12 + row * SMALL.line;
    small(ctx, String(scroll + row + 1).padStart(2), x + 2, top, INK.gutter);
    codeLine(ctx, line, x + 13, top, x + width - 2);
  });
}

/** The editor on the monitor in the room: each line's tokens as bars of their colours. */
function codeMini(ctx: CanvasRenderingContext2D, beat: Beat, screen: Rect, seconds: number): void {
  const { x, y, width, height } = screen, lines = CODE[beat.file ?? "src/main.ts"] ?? [];
  ctx.fillStyle = INK.editor;
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = INK.tabBar;
  ctx.fillRect(x, y, width, 3);
  const scroll = scrolled(beat, seconds, 20);
  lines.slice(scroll, scroll + Math.floor((height - 5) / 2)).forEach((line, row) => {
    let left = x + 2;
    for (const token of line.match(/'[^']*'|\/[^/ ]+\/i|\w+|\s+|./g) ?? []) {
      const long = Math.ceil(token.length * 0.75);
      if (token.trim()) { ctx.fillStyle = line.trimStart().startsWith("//") ? INK.note : tokenColour(token); ctx.fillRect(left, y + 5 + row * 2, Math.min(long, x + width - 1 - left), 1); }
      left += long;
      if (left >= x + width - 1) break;
    }
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
/** The panel's box on a full view of the map, slid in by `open`. */
const PANEL_WIDTH = 66;
const panelBox = (screen: Rect, open: number): Rect => ({ x: screen.x + screen.width - Math.round(PANEL_WIDTH * open), y: screen.y + 1, width: PANEL_WIDTH, height: screen.height - 2 });

/** The island's detail panel, as the app's: its title, then a card per part with its health along the top; the part the
 * cursor rests on is lit. */
function panel(ctx: CanvasRenderingContext2D, at: Rect, hover: boolean, open: number): void {
  box(ctx, at.x, at.y, at.width, at.height, INK.panel, INK.panelEdge);
  // While it slides in it is an empty panel; its words appear once it is in place, never cut by the screen's edge.
  if (open < 1) return;
  const { title, cards } = layPanel(at), right = at.x + at.width - 2;
  title.lines.forEach((line, row) => small(ctx, line, title.box.x, title.box.y + row * SMALL.line, INK.you, right));
  for (const card of cards) {
    box(ctx, card.box.x, card.box.y, card.box.width, card.box.height, hover && card.asked ? INK.hover : INK.claude, hover && card.asked ? INK.plate : INK.panelEdge);
    ctx.fillStyle = STATUS[card.status] ?? INK.gutter;
    ctx.fillRect(card.box.x, card.box.y, card.box.width, 2);
    card.lines.forEach((line, row) => small(ctx, line, card.box.x + 2, card.box.y + 3 + row * SMALL.line, INK.code, right - 1));
  }
}

/** Where an island is drawn on a screen, from where the view drew it on its canvas. */
function onScreen(screen: Rect, map: NonNullable<SceneInputs["map"]>, mark: Marks["islands"][number]): Rect {
  const sx = screen.width / map.width, sy = screen.height / map.height;
  return { x: screen.x + Math.round(mark.x * sx), y: screen.y + Math.round(mark.y * sy), width: Math.round(mark.width * sx), height: Math.round(mark.height * sy) };
}

/** The map at a full view: the forest's own drawing of the glass sheet, each island lettered under it as the app does (the
 * selected one on a lit plate), the cursor coming to the island and clicking it, and its panel sliding in from the right. */
function map(ctx: CanvasRenderingContext2D, beat: Beat, screen: Rect, seconds: number, { view, map: drawn }: SceneInputs): void {
  const { x, y, width, height } = screen;
  ctx.fillStyle = INK.map;
  ctx.fillRect(x, y, width, height);
  ctx.drawImage(view, x, y, width, height);
  const since = clickedFor(SCRIPT.with, seconds), open = panelOpen(SCRIPT.with, seconds);
  const islands = drawn?.marks?.islands.map(mark => ({ mark, at: onScreen(screen, drawn, mark) })) ?? [];
  // Each island is lettered under it, the selected one first, and a name that would overlap one already lettered is left off.
  const lettered: Rect[] = open ? [panelBox(screen, open)] : [];
  const order = [...islands].sort((a, b) => Number(b.mark.story === PANEL.story) - Number(a.mark.story === PANEL.story));
  for (const { mark, at } of order) {
    const lines = wrap(mark.title, 12), selected = since !== undefined && mark.story === PANEL.story;
    const top = at.y + at.height + 1, wide = Math.max(...lines.map(line => line.length)) * SMALL.advance - 1;
    const plate = { x: Math.round(at.x + at.width / 2 - wide / 2) - 2, y: top - 2, width: wide + 4, height: lines.length * SMALL.line + 3 };
    if (plate.x < x || plate.x + plate.width > x + width || plate.y + plate.height > y + height) continue;
    if (lettered.some(other => plate.x < other.x + other.width && other.x < plate.x + plate.width && plate.y < other.y + other.height && other.y < plate.y + plate.height)) continue;
    lettered.push(plate);
    // The island he clicked is ringed in gold, as the app lights a selection, as well as named on a gold plate.
    if (selected) ring(ctx, { x: at.x - 2, y: at.y - 2, width: at.width + 4, height: at.height + 4 }, INK.plate);
    box(ctx, plate.x, plate.y, plate.width, plate.height, selected ? INK.plate : INK.nameplate, selected ? INK.plate : INK.nameplate);
    lines.forEach((line, row) => small(ctx, line, plate.x + 2 + Math.round((wide - (line.length * SMALL.advance - 1)) / 2), top + row * SMALL.line, selected ? INK.plateWords : INK.name));
  }
  if (open) panel(ctx, panelBox(screen, open), hovering(SCRIPT.with, seconds), open);
  if (!beat.clicks) return;
  const target = islands.find(each => each.mark.story === PANEL.story)?.at ?? { x: x + width / 3, y: y + height / 2, width: 0, height: 0 };
  const [tx, ty] = [Math.round(target.x + target.width / 2), Math.round(target.y + target.height / 2)];
  const asked = layPanel(panelBox(screen, 1)).cards.find(card => card.asked)?.box;
  const t = Math.max(0, Math.min(1, (seconds - beat.from - 0.3) / (CLICK_AT - 0.3)));
  let [px, py] = [Math.round(tx + (1 - t) * 40), Math.round(ty + (1 - t) * 30)];
  const rest = asked && { x: asked.x + asked.width - 7, y: asked.y + asked.height - 2 };
  if (hovering(SCRIPT.with, seconds) && rest) [px, py] = [rest.x, rest.y];
  else if (since !== undefined && rest && since > PANEL_AT - CLICK_AT + 0.4) {
    const u = Math.min(1, (since - (PANEL_AT - CLICK_AT + 0.4)) / 0.8);
    [px, py] = [Math.round(tx + u * (rest.x - tx)), Math.round(ty + u * (rest.y - ty))];
  }
  pointer(ctx, px, py);
  if (since !== undefined && since < 0.3) { ctx.fillStyle = INK.cursor; ctx.fillRect(px - 3, py - 3, 2, 2); ctx.fillRect(px + 2, py - 3, 2, 2); }
}

/** The map on the monitor in the room: the same drawing, shrunk, with the panel a grey strip once it is open. */
function mapMini(ctx: CanvasRenderingContext2D, screen: Rect, seconds: number, view: CanvasImageSource): void {
  const { x, y, width, height } = screen;
  ctx.drawImage(view, x, y, width, height);
  if (panelOpen(SCRIPT.with, seconds)) box(ctx, x + width - 12, y, 12, height, INK.panel, INK.panelEdge);
}

/** What the screen shows in this beat, inside `screen`, in the frame's pixels: legible at a full view, a sketch in the room. */
function screenOf(ctx: CanvasRenderingContext2D, side: Side, beat: Beat, screen: Rect, inputs: SceneInputs): void {
  const { seconds } = inputs, full = beat.view === "full";
  ctx.save();
  ctx.beginPath();
  ctx.rect(screen.x, screen.y, screen.width, screen.height);
  ctx.clip();
  if (beat.app === "claude") (full ? claude : claudeMini)(ctx, side, screen, seconds);
  else if (beat.app === "code") (full ? code : codeMini)(ctx, beat, screen, seconds);
  else if (full) map(ctx, beat, screen, seconds, inputs);
  else mapMini(ctx, screen, seconds, inputs.view);
  ctx.restore();
}

const walked = (beat: Beat, seconds: number) => beat.pose === "walking" ? WALK_FROM + Math.round((seconds - beat.from) * WALK_SPEED) : 0;

/** Every sprite drawn over a half at `seconds`, as the sheet frame and where it lands: the developer (or his empty chair) and
 * the window. The room is under everything and is not among them. */
export type Sprite = { frame: Frame; x: number; y: number; mirror?: boolean };
export function spritesAt(side: Side, seconds: number, cast: CastMap): Sprite[] {
  const beat = beatAt(SCRIPT[side], seconds), left = HALF[side];
  if (seconds >= END_CARD || beat.view === "full") return [];
  const [x, y] = [left + SEAT.x, SEAT.y as number], drawn: Sprite[] = [{ frame: propFrame(cast, "window"), x: left + WINDOW.x, y: WINDOW.y }];
  // Walking out, he passes in front of his empty chair, so he is drawn over it.
  if (beat.pose === "gone" || beat.pose === "walking") drawn.push({ frame: propFrame(cast, "chair"), x, y });
  if (beat.pose !== "gone") drawn.push({ frame: poseFrame(cast, beat.pose, seconds - beat.from), x: x + walked(beat, seconds), ...(beat.pose === "walking" ? { y: y + DOWN, mirror: true } : { y }) });
  return drawn;
}

/** The words a viewer must read at `seconds` on a side: the script's (focusAt), and on the full view of the map once the panel
 * has opened, the island's name and the part he asks about. */
export function focusIn(side: Side, seconds: number): Focus[] {
  const focus = focusAt(side, SCRIPT[side], seconds), beat = beatAt(SCRIPT[side], seconds);
  if (beat.app !== "map" || beat.view !== "full" || panelOpen(SCRIPT.with, seconds) < 1) return focus;
  const { title, cards } = layPanel(panelBox({ ...SCREEN.full, x: HALF[side] + SCREEN.full.x }, 1)), asked = cards.find(card => card.asked);
  const words = asked && { x: asked.box.x + 2, y: asked.box.y + 3, width: Math.max(...asked.lines.map(line => line.length)) * SMALL.advance - 1, height: asked.lines.length * SMALL.line - 1 };
  return [...focus, { text: PANEL.title, box: title.box }, ...(asked && words ? [{ text: asked.title, box: words }] : [])];
}

/** Draws the frame at `seconds` and returns the words for the pixel font, over everything else. */
export function drawScene(ctx: CanvasRenderingContext2D, inputs: SceneInputs): Words[] {
  const { seconds, cast, sheet } = inputs, words: Words[] = [];
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
    const screen = { ...SCREEN[beat.view], x: left + SCREEN[beat.view].x };
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, TITLE, 160, LOW.height - TITLE);
    ctx.clip();
    if (full) {
      ctx.fillStyle = INK.wall;
      ctx.fillRect(left, TITLE, 160, LOW.height - TITLE);
      box(ctx, screen.x - 3, screen.y - 3, screen.width + 6, screen.height + 6, INK.bezel, INK.bezelEdge);
      screenOf(ctx, side, beat, screen, inputs);
    } else {
      screenOf(ctx, side, beat, screen, inputs);
      blit(ctx, sheet, propFrame(cast, "room"), left, TITLE);
      for (const { frame, x, y, mirror } of spritesAt(side, seconds, cast)) blit(ctx, sheet, frame, x, y, mirror);
    }
    if (beat.think) bubble(ctx, side, beat.think, !full, words);
    ctx.restore();
  }
  ctx.fillStyle = INK.divider;
  ctx.fillRect(159, 0, 2, LOW.height);
  words.push({ text: "WITHOUT STORYTREE", x: 80, y: 4, colour: INK.without, centre: true },
    { text: "WITH STORYTREE", x: 240, y: 4, colour: INK.with, centre: true });
  return words;
}
