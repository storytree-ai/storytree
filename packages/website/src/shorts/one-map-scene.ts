/** Capability 6 · Pixel-art shorts. One frame of the second short, "one map for you and your agents", at 480×270, from the time
 * alone, in the first short's room and with its cast: what the screen shows (the two Claude Code sessions side by side, a file
 * under review, or the shop's map with each session's claims standing on it as the forest's own flags) is drawn behind the room
 * and shows through its screen, and a beat that needs the screen read cuts to a full view of it. The pixel font's words are
 * handed back for it to draw on its own layer. */
import { sessionColour, type SessionWisp } from "@storytree/forest";
import { poseFrame, type CastMap } from "./cast.js";
import { small } from "./font.js";
import { beatAt, claimsAt, DIFFS, END_CARD, focusAt, PARTS, paneBox, paneLines, pileAt, SCRIPT, SESSIONS, type Beat, type DiffLine, type Pane, type PaneLine, type Shown } from "./one-map.js";
import { box, chrome, drawHalves, INK, letterIslands, onScreen, type SceneInputs, type Sprite, type Words } from "./scene.js";
import { HALF, SCREEN, SEAT, SMALL, type Focus, type Rect, type Side } from "./script.js";
import type { MapShort } from "./short.js";
import { MAP_PALETTE, quantiseInto } from "./view.js";
import saved from "../shop-snapshot.json" with { type: "json" };

/** An `hsl(h, s%, l%)` colour as `#rrggbb`. */
export function hex(hsl: string): string {
  const [h, s, l] = /^hsl\(([\d.]+), ([\d.]+)%, ([\d.]+)%\)$/u.exec(hsl)!.slice(1).map(Number) as [number, number, number];
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const channel = (n: number) => { const k = (n + h / 30) % 12; return Math.round(255 * (l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return `#${[0, 8, 4].map(n => channel(n).toString(16).padStart(2, "0")).join("")}`;
}

/** Each session's own colour, as every storytree surface draws it: its flags, its row in the sessions strip. */
export const COLOURS = SESSIONS.map(session => hex(sessionColour(session.id))) as [string, string];

/** The shop as saved, the map the website already draws: no story is added, and the claims are on its own parts. */
const shop = saved as unknown as { scene: { islands: readonly { story: string; title: string }[] }; places: readonly { id: string; place: number }[] };
const places = new Map(shop.places.map(place => [place.id, place.place]));

/** The sessions' claims as the forest's view takes them: one wisp per session and island, naming the capabilities it holds
 * there, in the session's colour (agent-claims' `sessionWisps`, from a fixed script rather than the log). */
export function wispsAt(seconds: number): SessionWisp[] {
  const wisps = new Map<string, SessionWisp>();
  for (const { session, part } of claimsAt(seconds)) {
    const { story, capability } = PARTS[part], id = SESSIONS[session].id, key = `${id} ${story}`;
    const wisp = wisps.get(key) ?? { session: id, story, colour: sessionColour(id), faded: false, capabilities: [] };
    wisp.capabilities.push(capability);
    wisps.set(key, wisp);
  }
  return [...wisps.values()];
}

/** The forest's view as this short mounts it: the shop's whole glass sheet, as the first short first shows it, tilted a step
 * toward the eye; its drawing put into the first short's palette and the two sessions' colours. */
export const MAP = { width: 912, height: 856, tilt: 1, aims: { sheet: { framing: 0.0012, sideOffset: 30, story: "story_8a4b7fb5d36c" } } } as const;
export const PALETTE = [...MAP_PALETTE, ...COLOURS] as const;

export const mapProps = (seconds: number) => ({ scene: saved.scene as never, places, selected: undefined, wisps: wispsAt(seconds),
  library: false, surfaces: { nameplates: false, knowledgeCore: false } });

/** A diff's colours: an added line's ground and words, a removed line's, and the editor's warning. */
const DIFF_INK = { addBg: "#1e3a28", add: "#98c379", removeBg: "#45202a", remove: "#e06c75", warn: "#c9a227", warnWords: "#1b1f2b", note: "#8a94a0" } as const;

/** One Claude Code conversation in `at`: its title, its lines, and a blinking cursor while he types. */
export function pane(ctx: CanvasRenderingContext2D, at: Rect, title: string, said: readonly Shown[], lines: readonly PaneLine[], seconds: number): void {
  const { x, y, width, height } = at, right = x + width - 2;
  ctx.fillStyle = INK.claude;
  ctx.fillRect(x, y, width, height);
  small(ctx, title, x + 3, y + 2, INK.accent, right);
  ctx.fillStyle = INK.accent;
  ctx.fillRect(x, y + 8, width, 1);
  for (const { who, text, mark, x: left, y: top } of lines) {
    if (mark) small(ctx, who === "you" ? ">" : "●", x + 3, top, who === "you" ? INK.prompt : who === "step" ? INK.note : INK.accent);
    small(ctx, text, left, top, who === "you" ? INK.you : who === "step" ? INK.prompt : INK.reply, right);
  }
  const last = said[said.length - 1], end = lines[lines.length - 1];
  if (last?.who === "you" && seconds < last.done + 0.2 && end && Math.floor(seconds * 3) % 2 === 0) {
    ctx.fillStyle = INK.you;
    ctx.fillRect(end.x + end.text.length * SMALL.advance + (end.text ? 1 : 0), end.y, 3, 5);
  }
}

/** The two sessions at a full view: each pane its own Claude Code, and on the side without storytree the size its diff has grown
 * to. */
function claude(ctx: CanvasRenderingContext2D, side: Side, screen: Rect, seconds: number): void {
  ctx.fillStyle = INK.divider;
  ctx.fillRect(screen.x, screen.y, screen.width, screen.height);
  for (const which of [0, 1] as const) {
    const at = paneBox(screen, which), { x, y, width, height } = at, right = x + width - 2;
    const { said, lines } = paneLines(side, which, seconds, at);
    pane(ctx, at, `claude code · ${which + 1}`, said, lines, seconds);
    const pile = side === "without" ? pileAt(which, seconds) : undefined;
    if (pile) {
      ctx.fillStyle = INK.tabBar;
      ctx.fillRect(x, y + height - 10, width, 10);
      small(ctx, `${pile.files} files`, x + 3, y + height - 8, INK.code, right);
      const added = `+${pile.added}`, removed = `-${pile.removed}`;
      small(ctx, added, right - (added.length + 1 + removed.length) * SMALL.advance, y + height - 8, DIFF_INK.add);
      small(ctx, removed, right - removed.length * SMALL.advance, y + height - 8, DIFF_INK.remove);
    }
  }
}

/** A conversation on the monitor in the room, in a strip `width` wide from `left`: its lines (laid out for `full`, its full
 * view's box) as bars of their colours, too small to read. */
export function paneMini(ctx: CanvasRenderingContext2D, left: number, y: number, width: number, height: number, lines: readonly PaneLine[], full: Rect): void {
  ctx.fillStyle = INK.claude;
  ctx.fillRect(left, y, width, height);
  ctx.fillStyle = INK.accent;
  ctx.fillRect(left, y + 3, width, 1);
  const shown = lines.slice(-Math.floor((height - 8) / 2)), columns = Math.floor(full.width / SMALL.advance) - 4;
  shown.forEach(({ who, text }, row) => {
    ctx.fillStyle = who === "you" ? INK.you : who === "step" ? INK.prompt : INK.reply;
    if (text) ctx.fillRect(left + 2, y + 5 + row * 2, Math.min(width - 3, Math.ceil(text.length * (width - 3) / columns)), 1);
  });
}

/** The two sessions on the monitor in the room. */
function claudeMini(ctx: CanvasRenderingContext2D, side: Side, screen: Rect, seconds: number): void {
  const { x, y, width, height } = screen;
  ctx.fillStyle = INK.divider;
  ctx.fillRect(x, y, width, height);
  const half = Math.floor((width - 1) / 2);
  for (const which of [0, 1] as const) {
    const full = paneBox({ ...SCREEN.full, x: 0, y: 0 }, which);
    paneMini(ctx, x + which * (half + 1), y, half, height, paneLines(side, which, seconds, full).lines, full);
  }
}

/** A file on screen: its tab, the note over it (the change's size, or a warning on its own yellow strip) and its lines, each
 * marked added, removed or kept. */
export type Diff = { tab: string; note: string; warn: boolean; lines: readonly string[] };
export const diffOf = (diff: Diff): DiffLine[] => diff.lines.map(line => ({ mark: line[0] as DiffLine["mark"], text: line.slice(1) }));

/** How far a file has scrolled `seconds` into the beat that opened it at `from`, in lines: slowly, as he reads, never past its
 * end. */
export const scrolled = (diff: Diff, from: number, seconds: number, rows: number) =>
  Math.min(Math.max(0, diff.lines.length - rows), Math.floor(Math.max(0, seconds - from - 1.5) * 1.2));

/** A file at a full view, scrolled from a beat that started at `from`: each added line on green and each removed one on red. */
export function diffScreen(ctx: CanvasRenderingContext2D, shown: Diff, screen: Rect, from: number, seconds: number): void {
  const { x, y, width, height } = screen, right = x + width - 2;
  ctx.fillStyle = INK.editor;
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = INK.tabBar;
  ctx.fillRect(x, y, width, 9);
  box(ctx, x + 2, y + 1, shown.tab.length * SMALL.advance + 5, 8, INK.tab, INK.tab);
  small(ctx, shown.tab, x + 4, y + 2, INK.code, right);
  if (shown.warn) box(ctx, x, y + 9, width, 9, DIFF_INK.warn, DIFF_INK.warn);
  small(ctx, shown.note, x + 4, y + 11, shown.warn ? DIFF_INK.warnWords : DIFF_INK.note, right);
  const top = y + 21, rows = Math.floor((height - 23) / SMALL.line), lines = diffOf(shown), scroll = scrolled(shown, from, seconds, rows);
  lines.slice(scroll, scroll + rows).forEach(({ mark, text }, row) => {
    const at = top + row * SMALL.line;
    if (mark !== " ") {
      ctx.fillStyle = mark === "+" ? DIFF_INK.addBg : DIFF_INK.removeBg;
      ctx.fillRect(x + 1, at - 1, width - 2, SMALL.line);
    }
    small(ctx, mark, x + 3, at, mark === "+" ? DIFF_INK.add : mark === "-" ? DIFF_INK.remove : INK.gutter);
    small(ctx, text, x + 11, at, mark === "+" ? DIFF_INK.add : mark === "-" ? DIFF_INK.remove : INK.code, right);
  });
}

/** A file on the monitor in the room: its lines as bars, green and red. */
export function diffMini(ctx: CanvasRenderingContext2D, shown: Diff, screen: Rect): void {
  const { x, y, width, height } = screen;
  ctx.fillStyle = INK.editor;
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = shown.warn ? DIFF_INK.warn : INK.tabBar;
  ctx.fillRect(x, y, width, 3);
  diffOf(shown).slice(0, Math.floor((height - 5) / 2)).forEach(({ mark, text }, row) => {
    ctx.fillStyle = mark === "+" ? DIFF_INK.add : mark === "-" ? DIFF_INK.remove : INK.code;
    if (text.trim()) ctx.fillRect(x + 2, y + 5 + row * 2, Math.min(width - 4, Math.ceil(text.length * 0.5)), 1);
  });
}

/** A claimed part's name as the flag's label gives it: its title without its number. */
export const partName = (capability: string) => Object.values(PARTS).find(part => part.capability === capability)?.title.replace(/^\d+ · /, "");

/** Where a flag's label goes: above its pennant, else right of it, else left of its pole, else under its foot; the first place
 * inside the screen that overlaps no name already `taken`. */
export function flagLabel(screen: Rect, x: number, y: number, part: string, taken: readonly Rect[]): Rect | undefined {
  const width = part.length * SMALL.advance + 3, height = 9;
  const inside = (at: Rect) => at.x >= screen.x && at.x + at.width <= screen.x + screen.width && at.y >= screen.y && at.y + at.height <= screen.y + screen.height;
  const clear = (at: Rect) => !taken.some(other => at.x < other.x + other.width && other.x < at.x + at.width && at.y < other.y + other.height && other.y < at.y + at.height);
  return [{ x: x + 4 - Math.round(width / 2), y: y - 23 }, { x: x + 9, y: y - 13 }, { x: x - 3 - width, y: y - 13 }, { x: x - Math.round(width / 2), y: y + 2 }]
    .map(spot => ({ ...spot, width, height })).find(at => inside(at) && clear(at));
}

/** A claim's flag in pixels, its pole's foot at (x, y): a pennant in the session's colour, outlined dark, on a dark pole, as the
 * forest draws it, but at whole pixels so it reads at the screen's size. */
export const PENNANT = [2, 4, 6, 4, 2] as const;
function flag(ctx: CanvasRenderingContext2D, x: number, y: number, colour: string): void {
  const top = y - 11;
  ctx.fillStyle = INK.cursorEdge;
  ctx.fillRect(x - 1, y, 3, 1);
  ctx.fillRect(x, top, 1, 11);
  PENNANT.forEach((width, row) => ctx.fillRect(x + 1, top - 1 + row, width + 1, 3));
  ctx.fillStyle = colour;
  PENNANT.forEach((width, row) => ctx.fillRect(x + 1, top + row, width, 1));
}

/** The map at a full view: the forest's own drawing of the shop's glass sheet with each claim's flag on it, each island lettered
 * as the app does, and the app's frame with the two sessions in the strip along its bottom, each in its colour. */
function map(ctx: CanvasRenderingContext2D, screen: Rect, { view, map: drawn }: SceneInputs): void {
  ctx.fillStyle = INK.map;
  ctx.fillRect(screen.x, screen.y, screen.width, screen.height);
  ctx.drawImage(view, screen.x, screen.y, screen.width, screen.height);
  const islands = drawn?.marks?.islands.map(mark => ({ mark, at: onScreen(screen, drawn, mark) })) ?? [];
  const lettered: Rect[] = [];
  letterIslands(ctx, screen, islands, undefined, false, lettered);
  const sx = screen.width / (drawn?.width ?? 1), sy = screen.height / (drawn?.height ?? 1);
  const flags = (drawn?.flags ?? []).map(({ capability, x, y, colour }) => ({ capability, colour: hex(colour), x: screen.x + Math.round(x * sx), y: screen.y + Math.round(y * sy) }))
    .sort((a, b) => a.x - b.x);
  // Every flag and its pole are clear of the labels.
  lettered.push(...flags.map(({ x, y }) => ({ x: x - 1, y: y - 12, width: 9, height: 13 })));
  for (const { x, y, colour } of flags) flag(ctx, x, y, colour);
  for (const { capability, x, y, colour } of flags) {
    // The part it claims is named beside its pennant, in its session's colour.
    const part = partName(capability), label = part === undefined ? undefined : flagLabel(screen, x, y, part, lettered);
    if (!part || !label) continue;
    lettered.push(label);
    box(ctx, label.x, label.y, label.width, label.height, INK.nameplate, INK.nameplate);
    small(ctx, part, label.x + 2, label.y + 2, colour);
  }
  chrome(ctx, screen, SESSIONS.map((session, pane) => ({ colour: COLOURS[pane as Pane], name: session.name })));
}

/** What the screen shows in this beat, inside `screen`: legible at a full view, a sketch in the room. */
function screenOf(ctx: CanvasRenderingContext2D, side: Side, beat: Beat, screen: Rect, inputs: SceneInputs): void {
  const { seconds } = inputs, full = beat.view === "full";
  ctx.save();
  ctx.beginPath();
  ctx.rect(screen.x, screen.y, screen.width, screen.height);
  ctx.clip();
  if (beat.app === "claude") (full ? claude : claudeMini)(ctx, side, screen, seconds);
  else if (beat.app === "code") full ? diffScreen(ctx, DIFFS[beat.diff ?? "review"], screen, beat.from, seconds) : diffMini(ctx, DIFFS[beat.diff ?? "review"], screen);
  else if (full) map(ctx, screen, inputs);
  else ctx.drawImage(inputs.view, screen.x, screen.y, screen.width, screen.height);
  ctx.restore();
}

/** The developer in the room at `seconds`, at his desk: he never leaves it in this short. */
export function spritesAt(side: Side, seconds: number, cast: CastMap): Sprite[] {
  const beat = beatAt(SCRIPT[side], seconds);
  if (seconds >= END_CARD || beat.view === "full" || beat.pose === "gone") return [];
  return [{ frame: poseFrame(cast, beat.pose, seconds - beat.from), x: HALF[side] + SEAT.x, y: SEAT.y }];
}

/** The words a viewer must read at `seconds` on a side. */
export const focusIn = (side: Side, seconds: number): Focus[] => focusAt(side, seconds);

/** Draws the frame at `seconds` and returns the words for the pixel font, over everything else. */
export const drawOneMap = (ctx: CanvasRenderingContext2D, inputs: SceneInputs): Words[] => drawHalves(ctx, inputs, { endCard: END_CARD,
  caption: ["ONE MAP FOR YOU", "AND YOUR AGENTS."], beat: (side, seconds) => beatAt(SCRIPT[side], seconds), sprites: spritesAt,
  screen: (ctx, side, screen, inputs) => screenOf(ctx, side, beatAt(SCRIPT[side], inputs.seconds), screen, inputs) });

/** The second short, as the frame that mounts the forest's view draws it. */
export const ONE_MAP: MapShort = { map: MAP, scene: shop.scene, props: mapProps, aimAt: () => "sheet", quantise: quantiseInto(PALETTE), draw: drawOneMap };
