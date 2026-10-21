/** Capability 6 · Pixel-art shorts. One frame of the third short, "memory that lives where your code lives", at 480×270, from
 * the time alone, in the first short's room and with its cast: what the screen shows (Claude Code, a file, or the shop's map with
 * the Checkout island lit and its panel listing the code attached to the story and the memory attached to it) is drawn behind the
 * room and shows through its screen, and a beat that needs the screen read cuts to a full view of it. The pixel font's words are
 * handed back for it to draw on its own layer. */
import { poseFrame, type CastMap } from "./cast.js";
import { small } from "./font.js";
import { CHAT, chatIn, CLICK_AT, clickedFor, END_CARD, FILES, focusAt, panelOpen, SCRIPT, STORY, type Beat } from "./memory.js";
import { beatAt, linesIn, shownAt } from "./one-map.js";
import { diffMini, diffScreen, pane, paneMini } from "./one-map-scene.js";
import { box, chrome, clickAt, drawHalves, INK, letterIslands, onScreen, pointer, type SceneInputs, type Sprite, type Words } from "./scene.js";
import { columnsOf, HALF, SCREEN, SEAT, SMALL, wrap, type Focus, type Rect, type Side } from "./script.js";
import type { MapShort } from "./short.js";
import { MAP_PALETTE, quantiseInto } from "./view.js";
import saved from "../shop-snapshot.json" with { type: "json" };

/** The shop as saved, the map the website already draws: no story is added. */
const shop = saved as unknown as { scene: { islands: readonly { story: string; title: string }[] }; places: readonly { id: string; place: number }[] };
const places = new Map(shop.places.map(place => [place.id, place.place]));

/** The forest's view as this short mounts it: the shop's whole glass sheet, as the second short shows it, and once he has
 * clicked Checkout that island close up, left of its panel, as the app flies to the island a click selects. */
export const MAP = { width: 912, height: 856, tilt: 1, aims: {
  sheet: { framing: 0.0012, sideOffset: 30, story: "story_8a4b7fb5d36c" },
  island: { framing: 0.0006, sideOffset: -150, story: STORY.story },
} } as const;

/** What the view is handed at `seconds`: the shop's plan, Checkout selected once he has clicked it. */
export const mapProps = (seconds: number) => ({ scene: saved.scene as never, places, selected: clickedFor(seconds) === undefined ? undefined : STORY.story,
  wisps: [] as const, library: false, surfaces: { nameplates: false, knowledgeCore: false } });
export const aimAt = (seconds: number) => clickedFor(seconds) === undefined ? "sheet" : "island";

/** The panel's box on a full view of the map, slid in by `open`. */
export const PANEL_WIDTH = 104;
export const panelBox = (screen: Rect, open: number): Rect => ({ x: screen.x + screen.width - Math.round(PANEL_WIDTH * open), y: screen.y + 1, width: PANEL_WIDTH, height: screen.height - 16 });

type Placed = { text: string; x: number; y: number };
/** The panel laid out in `at`, as the app's detail panel would head a story: its title and its package, then the code attached to
 * it, a file a line, then the memory attached to it, wrapped inside its own box. */
export function layPanel(at: Rect): { title: Placed; package: Placed; code: Placed; files: Placed[]; memory: Placed; note: { box: Rect; lines: Placed[] } } {
  const x = at.x + 4, columns = columnsOf(at.width - 2, SMALL.advance);
  let y = at.y + 4;
  const next = (gap: number) => { const top = y; y += SMALL.line + gap; return top; };
  const title = { text: STORY.title, x, y: next(1) }, pkg = { text: STORY.package, x, y: next(5) };
  const code = { text: `code · ${STORY.code.length} files`, x, y: next(2) };
  const files = STORY.code.map(file => ({ text: file, x: x + 2, y: next(0) }));
  y += 5;
  const memory = { text: "memory · 1 note", x, y: next(3) };
  const said = wrap(STORY.memory, columns - 1), top = y;
  const lines = said.map((text, row) => ({ text, x: x + 3, y: top + 3 + row * SMALL.line }));
  return { title, package: pkg, code, files, memory, note: { box: { x: x - 1, y: top, width: at.width - 7, height: said.length * SMALL.line + 5 }, lines } };
}

/** Checkout's panel: its title, its package and the code attached to it, then its memory on a lit note. */
function panel(ctx: CanvasRenderingContext2D, at: Rect, open: number): void {
  box(ctx, at.x, at.y, at.width, at.height, INK.panel, INK.panelEdge);
  // While it slides in it is an empty panel; its words appear once it is in place, never cut by the screen's edge.
  if (open < 1) return;
  const laid = layPanel(at), right = at.x + at.width - 2;
  small(ctx, laid.title.text, laid.title.x, laid.title.y, INK.you, right);
  small(ctx, laid.package.text, laid.package.x, laid.package.y, INK.note, right);
  for (const header of [laid.code, laid.memory]) {
    small(ctx, header.text, header.x, header.y, INK.prompt, right);
    ctx.fillStyle = INK.panelEdge;
    ctx.fillRect(header.x, header.y + SMALL.line, at.width - 8, 1);
  }
  for (const file of laid.files) small(ctx, file.text, file.x, file.y, INK.code, right);
  const { box: note, lines } = laid.note;
  box(ctx, note.x, note.y, note.width, note.height, INK.hover, INK.plate);
  for (const line of lines) small(ctx, line.text, line.x, line.y, INK.you, right);
}

/** The map at a full view: the forest's own drawing of the shop's glass sheet, each island lettered as the app does (Checkout on
 * a lit plate once clicked), the cursor coming to Checkout and clicking it, and its panel sliding in from the right. */
function map(ctx: CanvasRenderingContext2D, beat: Beat, screen: Rect, seconds: number, { view, map: drawn }: SceneInputs): void {
  const since = clickedFor(seconds), open = panelOpen(seconds);
  ctx.fillStyle = INK.map;
  ctx.fillRect(screen.x, screen.y, screen.width, screen.height);
  ctx.drawImage(view, screen.x, screen.y, screen.width, screen.height);
  const islands = drawn?.marks?.islands.map(mark => ({ mark, at: onScreen(screen, drawn, mark) })) ?? [];
  letterIslands(ctx, screen, islands, STORY.story, since !== undefined, open ? [panelBox(screen, open)] : []);
  chrome(ctx, screen);
  if (open) panel(ctx, panelBox(screen, open), open);
  if (!beat.clicks) return;
  const target = islands.find(each => each.mark.story === STORY.story)?.at ?? { x: screen.x + screen.width / 3, y: screen.y + screen.height / 2, width: 0, height: 0 };
  const [tx, ty] = [Math.round(target.x + target.width / 2), Math.round(target.y + target.height / 2)];
  const t = Math.max(0, Math.min(1, (seconds - beat.from - 0.3) / (CLICK_AT - 0.3)));
  // The cursor comes in from above and to the right, so it never crosses the island's name under it.
  const [px, py] = [Math.round(tx + (1 - t) * 40), Math.round(ty - (1 - t) * 30)];
  pointer(ctx, px, py);
  if (since !== undefined && since < 0.3) clickAt(ctx, px, py);
}

/** What the screen shows in this beat, inside `screen`: legible at a full view, a sketch in the room. */
function screenOf(ctx: CanvasRenderingContext2D, side: Side, beat: Beat, screen: Rect, inputs: SceneInputs): void {
  const { seconds } = inputs, full = beat.view === "full", file = FILES[beat.file ?? "tidied"];
  ctx.save();
  ctx.beginPath();
  ctx.rect(screen.x, screen.y, screen.width, screen.height);
  ctx.clip();
  if (beat.app === "claude" && full) {
    const { said, lines } = chatIn(side, seconds, screen);
    pane(ctx, screen, "claude code · opus 5.5", said, lines, seconds);
  } else if (beat.app === "claude") {
    const whole = { ...SCREEN.full, x: 0, y: 0 };
    paneMini(ctx, screen.x, screen.y, screen.width, screen.height, linesIn(shownAt(CHAT[side], seconds), whole), whole);
  } else if (beat.app === "code") full ? diffScreen(ctx, file, screen, beat.from, seconds) : diffMini(ctx, file, screen);
  else if (full) map(ctx, beat, screen, seconds, inputs);
  else {
    ctx.drawImage(inputs.view, screen.x, screen.y, screen.width, screen.height);
    if (panelOpen(seconds)) box(ctx, screen.x + screen.width - 17, screen.y, 17, screen.height, INK.panel, INK.panelEdge);
  }
  ctx.restore();
}

/** The developer in the room at `seconds`, at his desk: he never leaves it in this short. */
export function spritesAt(side: Side, seconds: number, cast: CastMap): Sprite[] {
  const beat = beatAt(SCRIPT[side], seconds);
  if (seconds >= END_CARD || beat.view === "full" || beat.pose === "gone") return [];
  return [{ frame: poseFrame(cast, beat.pose, seconds - beat.from), x: HALF[side] + SEAT.x, y: SEAT.y }];
}

/** The words a viewer must read at `seconds` on a side: the script's (focusAt), and on the full view of the map once the panel
 * has opened, the memory on its note. */
export function focusIn(side: Side, seconds: number): Focus[] {
  const focus = focusAt(side, seconds), beat = beatAt(SCRIPT[side], seconds);
  if (seconds >= END_CARD || beat.app !== "map" || beat.view !== "full" || panelOpen(seconds) < 1) return focus;
  const { note } = layPanel(panelBox({ ...SCREEN.full, x: HALF[side] + SCREEN.full.x }, 1));
  return [...focus, { text: STORY.memory, box: note.box }];
}

/** Draws the frame at `seconds` and returns the words for the pixel font, over everything else. */
export const drawMemory = (ctx: CanvasRenderingContext2D, inputs: SceneInputs): Words[] => drawHalves(ctx, inputs, { endCard: END_CARD,
  caption: ["MEMORY THAT LIVES", "WHERE YOUR CODE LIVES."], beat: (side, seconds) => beatAt(SCRIPT[side], seconds), sprites: spritesAt,
  screen: (ctx, side, screen, inputs) => screenOf(ctx, side, beatAt(SCRIPT[side], inputs.seconds), screen, inputs) });

/** The third short, as the frame that mounts the forest's view draws it. */
export const MEMORY: MapShort = { map: MAP, scene: shop.scene, props: mapProps, aimAt, quantise: quantiseInto(MAP_PALETTE), draw: drawMemory };
