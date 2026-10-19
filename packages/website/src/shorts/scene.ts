/** Capability 6 · Pixel-art shorts. One frame of the first short at 480×270, from the time alone. Each half is the same room,
 * PixelLab's: the desk of the owner's reference, the developer at it, hands on the keyboard, his monitor at a desk's size, and
 * the room round it. What the screen shows (Claude Code, the code, or on the storytree side the shop's map and the new story's
 * capability graph) is drawn behind the room and shows through its screen; a beat that needs the screen read cuts to a full
 * view of it. Everything is whole-pixel rectangles, the screen font's pixels and sheet frames, so the ×4 picture keeps hard
 * edges. The pixel font's words are handed back for it to draw on its own layer. */
import { poseIndex, poseFrame, propFrame, type CastMap, type Rect as Frame } from "./cast.js";
import { small } from "./font.js";
import { beatAt, beats, chatLines, END_CARD, focusAt, HALF, HALF_WIDTH, layBubble, LINE, LOW, PAD, ROLL, SCREEN, SEAT, SMALL, TITLE, wrap,
  type Beat, type Focus, type Rect, type Side } from "./script.js";
import { CLICK_AT, clickedFor, GROUNDING, hovering, layGraph, layPanel, panelOpen, PANEL, PANEL_AT, POP_AT, POPPED } from "./view.js";

export const INK = {
  divider: "#0b0d12", wall: "#2a2838",
  bubble: "#f4f1e8", bubbleEdge: "#0b0d12", words: "#1b1f2b",
  bezel: "#1d1f27", bezelEdge: "#08090d", glow: "#3fd6e8",
  claude: "#15171d", accent: "#d97757", you: "#ecebe6", prompt: "#7b8190", reply: "#b9c0cc",
  editor: "#1b1e28", tabBar: "#13151c", tab: "#2a2f3d", gutter: "#4b5263", code: "#d7dae0", keyword: "#c678dd",
  text: "#98c379", note: "#5c6370",
  map: "#101418", panel: "#1e222b", panelEdge: "#3a404d", hover: "#2c3442", healthy: "#3fae6a", untested: "#c9a227", failing: "#e5534b",
  plate: "#ffd34d", plateWords: "#1b1f2b", name: "#c9ced8", nameplate: "#1a1f27", forest: "#efe2b4", shop: "#c6e3a4",
  cursor: "#ffffff", cursorEdge: "#08090d",
  without: "#ff7a6b", with: "#7ee07e", caption: "#ffffff", url: "#ffd34d",
} as const;

/** The app's capability graph, in its dark theme (the forest's styles.css): the space, a card, its edge and its strip's word by
 * status, the selected card's edge, another story's muted words, and the arrows. */
const GRAPH_INK = {
  bg: "#17191c", surface: "#1e2125", text: "#e7e8ea", muted: "#a0a6af", line: "#454a52", pass: "#2c6b41", selected: "#e7e8ea",
  strip: { proposed: "#9a5a1c", healthy: "#2f6b3f", unhealthy: "#9f2d22", untested: "#6b7280" } as Record<string, string>,
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
 * frames stand DOWN pixels higher in their cell), behind his rolled-back chair and off the half's right edge. */
const WALK_SPEED = 150, WALK_FROM = 30 - 68, DOWN = 5;

/** The code on the screen without storytree: what Opus wrote for the shop's wishlist, file by file. */
const CODE: Record<string, readonly string[]> = {
  "src/routes/wishlist.ts": [
    "import { Router } from 'express';", "import { wishlist } from '../wishlist/store';", "import { moveToCart } from '../cart/move';",
    "import { requireUser } from '../session';", "", "export const routes = Router();", "",
    "routes.get('/wishlist', requireUser, async (req, res) => {", "  const items = await wishlist(req.user).all();",
    "  res.render('wishlist', { items });", "});", "", "routes.post('/wishlist/:id', requireUser, async (req, res) => {",
    "  await wishlist(req.user).add(req.params.id);", "  res.redirect('back');", "});", "",
    "routes.post('/wishlist/:id/cart', requireUser, async (req, res) => {", "  await moveToCart(req.user, req.params.id);",
    "  res.redirect('/cart');", "});",
  ],
  "src/wishlist/store.ts": [
    "import { db } from '../db';", "", "export function wishlist(user: User) {", "  const where = { user: user.id };", "  return {",
    "    all: () => db.select('wishlist', where),", "    async add(product: string) {", "      await db.insert('wishlist', { ...where, product })",
    "        .onConflict(['user', 'product']).ignore();", "    },", "    remove: (product: string) =>",
    "      db.delete('wishlist', { ...where, product }),", "  };", "}",
  ],
  "src/cart/move.ts": [
    "import { cart } from './store';", "import { wishlist } from '../wishlist/store';", "", "// move one saved item into the cart",
    "export async function moveToCart(user: User, id: string) {", "  const list = wishlist(user);", "  const items = await list.all();",
    "  const item = items.find(each => each.product === id);", "  if (!item) return false;", "  await cart(user).add(item.product, 1);",
    "  return true;", "}",
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
  const [cx, bottom] = [HALF[side] + 88, laid.y + laid.height];
  if (room) for (const [dy, dx, size] of [[10, 0, 4], [30, 4, 3], [50, 7, 2]] as const)
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
  const shown = lines.slice(-Math.floor((height - 8) / 2)), columns = Math.floor(SCREEN.full.width / SMALL.advance) - 4;
  shown.forEach(({ who, text }, row) => {
    ctx.fillStyle = who === "you" ? INK.you : INK.reply;
    if (text) ctx.fillRect(x + 3, y + 5 + row * 2, Math.min(width - 5, Math.ceil(text.length * (width - 5) / columns)), 1);
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
  const { x, y, width, height } = screen, file = beat.file ?? "src/routes/wishlist.ts", lines = CODE[file] ?? [];
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
  const { x, y, width, height } = screen, lines = CODE[beat.file ?? "src/routes/wishlist.ts"] ?? [];
  ctx.fillStyle = INK.editor;
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = INK.tabBar;
  ctx.fillRect(x, y, width, 3);
  const scroll = scrolled(beat, seconds, 33);
  lines.slice(scroll, scroll + Math.floor((height - 5) / 2)).forEach((line, row) => {
    let left = x + 2;
    for (const token of line.match(/'[^']*'|\/[^/ ]+\/i|\w+|\s+|./g) ?? []) {
      const long = Math.ceil(token.length * 0.5);
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

/** A click: two white ticks either side of the pointer's tip. */
function clickAt(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = INK.cursor;
  ctx.fillRect(x - 3, y - 3, 2, 2);
  ctx.fillRect(x + 2, y - 3, 2, 2);
}

/** The panel's box on a full view of the map, slid in by `open`. */
const PANEL_WIDTH = 100;
/** How much of the full screen's width and height the map is drawn at, at `seconds`: all of it, until the panel opens beside
 * it, when the whole sheet is fitted into the room the panel leaves, as the app fits its map aside. */
export const mapFit = (seconds: number) => 1 - panelOpen(SCRIPT.with, seconds) * PANEL_WIDTH / SCREEN.full.width;
const panelBox = (screen: Rect, open: number): Rect => ({ x: screen.x + screen.width - Math.round(PANEL_WIDTH * open), y: screen.y + 1, width: PANEL_WIDTH, height: screen.height - 2 });

/** The island's detail panel, as the app's: its title and description, then its capability graph, too small to read, in a frame
 * with the button that opens it full size. */
function panel(ctx: CanvasRenderingContext2D, at: Rect, open: number, pressed: boolean): void {
  box(ctx, at.x, at.y, at.width, at.height, INK.panel, INK.panelEdge);
  // While it slides in it is an empty panel; its words appear once it is in place, never cut by the screen's edge.
  if (open < 1) return;
  const { title, description, frame, open: button } = layPanel(at), right = at.x + at.width - 2;
  title.lines.forEach((line, row) => small(ctx, line, title.box.x, title.box.y + row * SMALL.line, INK.you, right));
  description.lines.forEach((line, row) => small(ctx, line, description.x, description.y + row * SMALL.line, INK.reply, right));
  box(ctx, frame.x, frame.y, frame.width, frame.height, GRAPH_INK.bg, INK.panelEdge);
  graphCards(ctx, { x: frame.x + 4, y: frame.y + 12, width: frame.width - 8, height: frame.height - 16 });
  // The pop-out button: a box with an arrow out of its corner, as the app's.
  box(ctx, button.x, button.y, button.width, button.height, pressed ? INK.hover : INK.panel, pressed ? INK.plate : INK.panelEdge);
  ctx.fillStyle = INK.code;
  ctx.fillRect(button.x + 4, button.y + 2, 3, 1);
  ctx.fillRect(button.x + 6, button.y + 2, 1, 3);
  ctx.fillRect(button.x + 5, button.y + 3, 1, 1);
  ctx.fillRect(button.x + 4, button.y + 4, 1, 1);
  ctx.fillRect(button.x + 2, button.y + 4, 1, 3);
  ctx.fillRect(button.x + 2, button.y + 6, 4, 1);
}

/** Where an island is drawn on a screen, from where the view drew it on its canvas. */
function onScreen(screen: Rect, map: NonNullable<SceneInputs["map"]>, mark: Marks["islands"][number]): Rect {
  const sx = screen.width / map.width, sy = screen.height / map.height;
  return { x: screen.x + Math.round(mark.x * sx), y: screen.y + Math.round(mark.y * sy), width: Math.round(mark.width * sx), height: Math.round(mark.height * sy) };
}

/** The map at a full view: the forest's own drawing of the glass sheet, each island lettered under it as the app does (the
 * selected one on a lit plate), the cursor coming to the new island and clicking it, its panel sliding in from the right, and
 * the cursor pressing the panel's button that opens the graph full size. */
function map(ctx: CanvasRenderingContext2D, beat: Beat, screen: Rect, seconds: number, { view, map: drawn }: SceneInputs): void {
  const { x, y, width, height } = screen;
  const since = clickedFor(SCRIPT.with, seconds), open = panelOpen(SCRIPT.with, seconds);
  // As the panel opens the whole sheet is fitted into the room it leaves, as the app fits its map aside, so the island he
  // clicked and every other stay in view; the view is drawn at that size already, so it is copied pixel for pixel.
  const fit = mapFit(seconds), [w, h] = [Math.round(width * fit), Math.round(height * fit)];
  const shown = { x, y: y + Math.round((height - h) / 2), width: w, height: h };
  ctx.fillStyle = INK.map;
  ctx.fillRect(x, y, width, height);
  ctx.drawImage(view, shown.x, shown.y, w, h);
  const islands = drawn?.marks?.islands.map(mark => ({ mark, at: onScreen(shown, drawn, mark) })) ?? [];
  // Each island is lettered under it, the selected one first, and a name that would overlap one already lettered is left off.
  const lettered: Rect[] = open ? [panelBox(screen, open)] : [];
  const order = [...islands].sort((a, b) => Number(b.mark.story === PANEL.story) - Number(a.mark.story === PANEL.story));
  for (const { mark, at } of order) {
    const lines = wrap(mark.title, 12), selected = since !== undefined && mark.story === PANEL.story;
    const wide = Math.max(...lines.map(line => line.length)) * SMALL.advance - 1, tall = lines.length * SMALL.line + 3;
    const clear = (plate: Rect) => plate.x >= x && plate.x + plate.width <= x + width && plate.y >= y && plate.y + plate.height <= y + height
      && !lettered.some(other => plate.x < other.x + other.width && other.x < plate.x + plate.width && plate.y < other.y + other.height && other.y < plate.y + plate.height);
    // Under the island, as the app letters it; above it where a name already lettered is in the way.
    const plate = [at.y + at.height - 1, at.y - tall - 1].map(py => ({ x: Math.round(at.x + at.width / 2 - wide / 2) - 2, y: py, width: wide + 4, height: tall })).find(clear);
    if (!plate) continue;
    const top = plate.y + 2;
    lettered.push(plate);
    // The island he clicked is named on a gold plate, as the app lights a selection.
    box(ctx, plate.x, plate.y, plate.width, plate.height, selected ? INK.plate : INK.nameplate, selected ? INK.plate : INK.nameplate);
    lines.forEach((line, row) => small(ctx, line, plate.x + 2 + Math.round((wide - (line.length * SMALL.advance - 1)) / 2), top + row * SMALL.line, selected ? INK.plateWords : INK.name));
  }
  chrome(ctx, screen);
  const local = since === undefined ? 0 : since + CLICK_AT;
  const pressed = since !== undefined && local >= POPPED;
  if (open) panel(ctx, panelBox(screen, open), open, pressed);
  if (!beat.clicks) return;
  const target = islands.find(each => each.mark.story === PANEL.story)?.at ?? { x: x + width / 3, y: y + height / 2, width: 0, height: 0 };
  const [tx, ty] = [Math.round(target.x + target.width / 2), Math.round(target.y + target.height / 2)];
  const button = layPanel(panelBox(screen, 1)).open, rest = { x: button.x + 5, y: button.y + 5 };
  const t = Math.max(0, Math.min(1, (seconds - beat.from - 0.3) / (CLICK_AT - 0.3)));
  // The cursor comes in from above and to the right, so it never crosses the island's name under it.
  let [px, py] = [Math.round(tx + (1 - t) * 40), Math.round(ty - (1 - t) * 30)];
  if (since !== undefined && local > PANEL_AT + 0.4) {
    const u = Math.min(1, (local - (PANEL_AT + 0.4)) / (POP_AT - PANEL_AT - 0.4));
    [px, py] = [Math.round(tx + u * (rest.x - tx)), Math.round(ty + u * (rest.y - ty))];
  }
  pointer(ctx, px, py);
  if (since !== undefined && since < 0.3) clickAt(ctx, px, py);
  if (pressed && local < POPPED + 0.3) clickAt(ctx, px, py);
}

/** The app's own frame round its map, as its screenshot shows it: the switches along the top (the forest lit, the library, and
 * the project, the shop) and the sessions strip along the bottom, one session, Claude Code's. */
function chrome(ctx: CanvasRenderingContext2D, screen: Rect): void {
  const { x, y, width, height } = screen;
  box(ctx, x + 3, y + 3, 63, 11, INK.panel, INK.panelEdge);
  box(ctx, x + 4, y + 4, 28, 9, INK.forest, INK.forest);
  small(ctx, "forest", x + 6, y + 6, INK.plateWords);
  small(ctx, "library", x + 35, y + 6, INK.code);
  box(ctx, x + 69, y + 3, 53, 11, INK.panel, INK.panelEdge);
  small(ctx, "project", x + 71, y + 6, INK.gutter);
  box(ctx, x + 100, y + 4, 21, 9, INK.shop, INK.shop);
  small(ctx, "shop", x + 103, y + 6, INK.plateWords);
  ctx.fillStyle = INK.panel;
  ctx.fillRect(x, y + height - 14, width, 14);
  ctx.fillStyle = INK.panelEdge;
  ctx.fillRect(x, y + height - 14, width, 1);
  small(ctx, "sessions 1", x + 4, y + height - 10, INK.you);
  ctx.fillStyle = "#e05bb5";
  ctx.fillRect(x + 50, y + height - 9, 3, 3);
  small(ctx, "claude code", x + 56, y + height - 10, INK.code);
}

/** The map on the monitor in the room: the same drawing, shrunk, with the panel a grey strip once it is open. */
function mapMini(ctx: CanvasRenderingContext2D, screen: Rect, seconds: number, view: CanvasImageSource): void {
  const { x, y, width, height } = screen;
  ctx.drawImage(view, x, y, width, height);
  if (panelOpen(SCRIPT.with, seconds)) box(ctx, x + width - 14, y, 14, height, INK.panel, INK.panelEdge);
}

/** A one-pixel line between two points, by whole pixels. */
function line(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let step = 0; step <= steps; step++) ctx.fillRect(Math.round(x0 + (x1 - x0) * step / steps), Math.round(y0 + (y1 - y0) * step / steps), 1, 1);
}

/** The graph's space inside a screen: under its title row. */
const graphBox = (screen: Rect): Rect => ({ x: screen.x + 4, y: screen.y + 13, width: screen.width - 8, height: screen.height - 16 });

/** The new story's capability graph opened full size, as the app's: its title, then its cards (the story's own with their status
 * strip and word, the shop's parts they build on muted, with their story's name) and an arrow from each part to the one it builds
 * on; the part the cursor rests on is outlined, as the app shows a selection. */
function graph(ctx: CanvasRenderingContext2D, screen: Rect, seconds: number): void {
  const { x, y, width, height } = screen;
  ctx.fillStyle = GRAPH_INK.bg;
  ctx.fillRect(x, y, width, height);
  small(ctx, `${PANEL.title} · capability graph`, x + 3, y + 2, GRAPH_INK.text, x + width - 12);
  small(ctx, "x", x + width - 7, y + 2, GRAPH_INK.muted);
  ctx.fillStyle = GRAPH_INK.line;
  ctx.fillRect(x, y + 9, width, 1);
  const { cards, links } = layGraph(graphBox(screen)), hover = hovering(SCRIPT.with, seconds);
  ctx.fillStyle = GRAPH_INK.muted;
  for (const { from, to } of links) {
    const [fx, fy] = [from.x + Math.round(from.width / 2), from.y + from.height];
    const [tx, ty] = [to.x + Math.round(to.width / 2), to.y - 1];
    line(ctx, fx, fy, tx, ty);
    ctx.fillRect(tx - 1, ty - 1, 3, 1);
    ctx.fillRect(tx, ty, 1, 1);
  }
  for (const card of cards) {
    const lit = hover && card.asked, { x: cx, y: cy, width: cw, height: ch } = card.box;
    box(ctx, cx, cy, cw, ch, GRAPH_INK.surface, lit ? GRAPH_INK.selected : card.own && card.status === "healthy" ? GRAPH_INK.pass : GRAPH_INK.line);
    if (lit) ring(ctx, { x: cx - 1, y: cy - 1, width: cw + 2, height: ch + 2 }, GRAPH_INK.selected);
    ctx.fillStyle = GRAPH_INK.strip[card.status] ?? GRAPH_INK.strip.untested!;
    ctx.fillRect(cx + 1, cy + 1, cw - 2, 7);
    small(ctx, card.own ? card.status : card.story ?? "", cx + 3, cy + 2, card.own ? GRAPH_INK.text : GRAPH_INK.muted, cx + cw - 2);
    card.lines.forEach((text, row) => small(ctx, text, cx + 3, cy + 10 + row * SMALL.line, card.own ? GRAPH_INK.text : GRAPH_INK.muted, cx + cw - 2));
  }
  const asked = cards.find(card => card.asked)?.box;
  if (!asked) return;
  // The cursor arrives from where the panel's button was and rests on the part he will ask about.
  const first = SCRIPT.with.find(beat => beat.app === "graph")!, u = Math.max(0, Math.min(1, (seconds - first.from) / 1.0));
  const [rx, ry] = [asked.x + asked.width - 8, asked.y + asked.height - 4], [sx, sy] = [x + width - 12, y + 8];
  pointer(ctx, Math.round(sx + u * (rx - sx)), Math.round(sy + u * (ry - sy)));
}

/** The graph shrunk into `at` with no words: its cards as boxes, the story's own in their strip's colour, and its arrows. */
function graphCards(ctx: CanvasRenderingContext2D, at: Rect): void {
  const { cards, links } = layGraph(at, false);
  ctx.fillStyle = GRAPH_INK.line;
  for (const { from, to } of links) line(ctx, from.x + Math.round(from.width / 2), from.y + from.height, to.x + Math.round(to.width / 2), to.y - 1);
  for (const card of cards) {
    ctx.fillStyle = card.own ? GRAPH_INK.strip[card.status] ?? GRAPH_INK.strip.untested! : GRAPH_INK.line;
    ctx.fillRect(card.box.x, card.box.y, card.box.width, card.box.height);
  }
}

/** The graph on the monitor in the room. */
function graphMini(ctx: CanvasRenderingContext2D, screen: Rect): void {
  ctx.fillStyle = GRAPH_INK.bg;
  ctx.fillRect(screen.x, screen.y, screen.width, screen.height);
  graphCards(ctx, { x: screen.x + 2, y: screen.y + 3, width: screen.width - 4, height: screen.height - 5 });
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
  else if (beat.app === "graph") full ? graph(ctx, screen, seconds) : graphMini(ctx, screen);
  else if (full) map(ctx, beat, screen, seconds, inputs);
  else mapMini(ctx, screen, seconds, inputs.view);
  ctx.restore();
}

const walked = (beat: Beat, seconds: number) => beat.pose === "walking" ? WALK_FROM + Math.round((seconds - beat.from) * WALK_SPEED) : 0;

/** How far his chair has rolled back at `seconds`, 0 to 1: from the moment standing up shows him clear of it. */
function rolled(side: Side, seconds: number, cast: CastMap): number {
  const stand = SCRIPT[side].find(beat => beat.pose === "standing");
  const apart = cast.poses.standing?.chairApart;
  if (!stand || apart === undefined || seconds < stand.from) return 0;
  return Math.max(0, Math.min(1, (seconds - stand.from - apart / cast.poses.standing!.fps) / ROLL.seconds));
}

/** Every sprite drawn over a half at `seconds`, as the sheet frame and where it lands: the developer and, once he is clear of it,
 * his chair apart, rolling back. The room is under everything and is not among them. */
export type Sprite = { frame: Frame; x: number; y: number; mirror?: boolean };
export function spritesAt(side: Side, seconds: number, cast: CastMap): Sprite[] {
  const beat = beatAt(SCRIPT[side], seconds), left = HALF[side];
  if (seconds >= END_CARD || beat.view === "full") return [];
  const [x, y] = [left + SEAT.x, SEAT.y as number], drawn: Sprite[] = [];
  const apart = beat.pose === "gone" || beat.pose === "walking"
    || (beat.pose === "standing" && poseIndex(cast, "standing", seconds - beat.from) >= (cast.poses.standing?.chairApart ?? Infinity));
  if (beat.pose !== "gone") drawn.push({ frame: poseFrame(cast, beat.pose, seconds - beat.from), x: x + walked(beat, seconds), ...(beat.pose === "walking" ? { y: y + DOWN, mirror: true } : { y }) });
  // The chair rolls back toward the viewer, so it is in front of him as he walks out behind it.
  const roll = rolled(side, seconds, cast);
  if (apart) drawn.push({ frame: propFrame(cast, "chair"), x: x + Math.round(ROLL.x * roll), y: y + Math.round(ROLL.y * roll) });
  return drawn;
}

/** The words a viewer must read at `seconds` on a side: the script's (focusAt); on the full view of the map once the panel has
 * opened, the island's name; and on the full view of the graph, the part he asks about. */
export function focusIn(side: Side, seconds: number): Focus[] {
  const focus = focusAt(side, SCRIPT[side], seconds), beat = beatAt(SCRIPT[side], seconds);
  if (beat.view !== "full" || seconds >= END_CARD) return focus;
  const screen = { ...SCREEN.full, x: HALF[side] + SCREEN.full.x };
  if (beat.app === "map" && panelOpen(SCRIPT.with, seconds) >= 1) return [...focus, { text: PANEL.title, box: layPanel(panelBox(screen, 1)).title.box }];
  if (beat.app !== "graph") return focus;
  const asked = layGraph(graphBox(screen)).cards.find(card => card.asked);
  if (!asked) return focus;
  const words = { x: asked.box.x + 3, y: asked.box.y + 10, width: Math.max(...asked.lines.map(text => text.length)) * SMALL.advance - 1, height: asked.lines.length * SMALL.line - 1 };
  return [...focus, { text: asked.title, box: words }];
}

/** Draws the frame at `seconds` and returns the words for the pixel font, over everything else. */
export function drawScene(ctx: CanvasRenderingContext2D, inputs: SceneInputs): Words[] {
  const { seconds, cast, sheet } = inputs, words: Words[] = [];
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = INK.divider;
  ctx.fillRect(0, 0, LOW.width, LOW.height);
  const middle = LOW.width / 2;
  if (seconds >= END_CARD) {
    words.push({ text: "SEE WHAT YOUR", x: middle, y: 113, colour: INK.caption, centre: true },
      { text: "AGENTS BUILT.", x: middle, y: 125, colour: INK.caption, centre: true },
      { text: "storytree.dev", x: middle, y: 147, colour: INK.url, centre: true });
    return words;
  }
  for (const side of ["without", "with"] as const) {
    const beat = beatAt(SCRIPT[side], seconds), left = HALF[side], full = beat.view === "full";
    const screen = { ...SCREEN[beat.view], x: left + SCREEN[beat.view].x };
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, TITLE, HALF_WIDTH, LOW.height - TITLE);
    ctx.clip();
    if (full) {
      ctx.fillStyle = INK.wall;
      ctx.fillRect(left, TITLE, HALF_WIDTH, LOW.height - TITLE);
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
  ctx.fillRect(middle - 1, 0, 2, LOW.height);
  words.push({ text: "WITHOUT STORYTREE", x: middle / 2, y: 4, colour: INK.without, centre: true },
    { text: "WITH STORYTREE", x: middle * 1.5, y: 4, colour: INK.with, centre: true });
  return words;
}
