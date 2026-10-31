/** Capability 6 · Pixel-art shorts. The third short, "memory that lives where your code lives" (claim 3 on storytree.dev,
 * ADR-1104 D2), as data: the same developer at the same desk on both halves, in the first short's room, giving Claude Code the
 * same job on the shop: clean up checkout's total. Without storytree the agent's memory is not tied to the code (the owner's own
 * pain), so it tidies away the reason tax was rounded once, on the total; asked why it was that way, it cannot say, the memory
 * file he scrolls has nothing on that file, and the bug fixed once before comes back. With storytree the checkout story lists
 * exactly the code attached to it and the memory attached to the story, so the agent reads why and keeps it; on the map the
 * story is the Checkout island, and its panel shows its code and its memory together. Every position is in the 480×270 frame's
 * own pixels. */
import { beatAt, linesIn, repliesRead, shownAt, type PaneLine, type Said, type Shown } from "./one-map.js";
import { HALF, layBubble, SCREEN, type Focus, type Pose, type Rect, type Side, type View } from "./script.js";

/** How long the short runs, in seconds, and the end card's start. */
export const LENGTH = 54;
export const END_CARD = 50;

/** What the screen shows: Claude Code, a file, or the map. */
export type App = "claude" | "code" | "map";
export type Beat = {
  from: number; to: number;
  pose: Pose;
  app: App; view: View;
  think?: string;
  /** On the code: what is open (a key of FILES). */
  file?: keyof typeof FILES;
  /** On the map: he clicks the Checkout island and its panel opens. */
  clicks?: boolean;
};

/** The shop's story the job is in, by its real names in the saved snapshot; the code attached to it (its package's files) and the
 * memory attached to it, pinned here as data, as the app would list them in its panel. */
export const STORY = {
  story: "story_66f80ffaaa4d", title: "Checkout", package: "packages/checkout",
  code: ["src/index.js", "src/your-information.js", "src/overview.js", "src/total.js", "src/complete.js", "src/place-order.js"],
  memory: "tax is rounded once, on the total. rounded per item, totals came out a cent off.",
} as const;

/** The job both halves give Claude, and the file it edits. */
export const JOB = "clean up checkout's total";
export const FILE = "checkout/src/total.js";

/** The one Claude Code session's conversation on each half: his prompts, its replies and its work steps (pane 0 always). */
const said = (who: Said["who"], text: string, at: number, rate?: number): Said => ({ pane: 0, who, text, at, ...(rate ? { rate } : {}) });
export const CHAT: Record<Side, readonly Said[]> = {
  without: [
    said("you", JOB, 2, 16),
    said("claude", "on it.", 4.2),
    said("step", `read ${FILE}`, 5),
    said("step", `edit ${FILE}`, 5.8),
    said("step", "run tests: 9 passed", 6.6),
    said("claude", "done. tax is rounded per item now. simpler.", 7.4),
    said("you", "why was tax rounded on the total?", 22.6, 16),
    said("step", "search memory: tax", 25),
    said("step", "read MEMORY.md: 640 lines", 25.6),
    said("step", "no note on total.js", 26.2),
    said("claude", "i can't find why. nothing i remember is tied to that file.", 26.8),
  ],
  with: [
    said("you", JOB, 2, 16),
    said("claude", "on it.", 4.2),
    said("step", `read story ${STORY.title.toLowerCase()}: ${STORY.code.length} files, 1 memory`, 4.8),
    said("step", `edit ${FILE}`, 5.4),
    said("step", "run tests: 9 passed", 6),
    said("claude", "done. kept tax rounded on the total, as checkout's memory says.", 6.4),
    said("you", "now add discount codes", 39.6, 16),
    said("claude", "checkout's memory: tax rounds once, on the total. so the discount comes off before it.", 41.6),
  ],
};

/** Both halves, beat by beat. Their turns line up and cut together: both type the job at 2 s and look at what came back at 12 s;
 * then without storytree he reads the change, asks why it was the other way, gets no answer, scrolls the memory file for one and
 * meets the bug fixed once before; with storytree he opens Checkout on the map, reads its code and its memory in its panel, reads
 * a change that kept the reason, and gives the next job, which the agent plans by the same memory. */
export const SCRIPT: Record<Side, readonly Beat[]> = {
  without: [
    { from: 0, to: 1.5, pose: "typing", app: "claude", view: "room" },
    { from: 1.5, to: 12, pose: "typing", app: "claude", view: "full" },
    { from: 12, to: 13, pose: "reading", app: "code", view: "room", file: "tidied" },
    { from: 13, to: 21, pose: "reading", app: "code", view: "full", file: "tidied", think: "looks tidier. didn't we fix tax once?" },
    { from: 21, to: 22, pose: "typing", app: "claude", view: "room" },
    { from: 22, to: 33, pose: "typing", app: "claude", view: "full" },
    { from: 33, to: 34, pose: "reading", app: "code", view: "room", file: "memory" },
    { from: 34, to: 42, pose: "reading", app: "code", view: "full", file: "memory", think: "it's in here somewhere. or it was." },
    { from: 42, to: 43, pose: "reading", app: "code", view: "room", file: "bug" },
    { from: 43, to: END_CARD, pose: "reading", app: "code", view: "full", file: "bug", think: "we fixed this once. nobody kept why." },
  ],
  with: [
    { from: 0, to: 1.5, pose: "typing", app: "claude", view: "room" },
    { from: 1.5, to: 12, pose: "typing", app: "claude", view: "full" },
    { from: 12, to: 13, pose: "leaning", app: "map", view: "room" },
    { from: 13, to: 19, pose: "leaning", app: "map", view: "full", clicks: true },
    { from: 19, to: 29, pose: "leaning", app: "map", view: "full", think: "its code, and why. on its island." },
    { from: 29, to: 30, pose: "reading", app: "code", view: "room", file: "kept" },
    { from: 30, to: 38, pose: "reading", app: "code", view: "full", file: "kept", think: "it remembered why." },
    { from: 38, to: 39, pose: "typing", app: "claude", view: "room" },
    { from: 39, to: END_CARD, pose: "typing", app: "claude", view: "full" },
  ],
};

/** The poster frame: the change that lost the reason on one side while the island's panel shows it on the other. */
export const POSTER = 24;

/** What the code screen shows, by name: its tab, the note over it and its lines, each marked added, removed or kept. */
export const FILES = {
  tidied: { tab: FILE, note: "review: clean up total · 1 file · +3 -3", warn: false, lines: [
    " import { round, add } from './money.js';", "+const taxOf = (item) => round(item.price * 0.08);", " ",
    " export function totals(items) {", "-  let sum = 0;", "-  for (const item of items) sum += item.price;", "-  const tax = round(sum * 0.08);",
    "+  const sum = items.reduce((s, i) => s + i.price, 0);", "+  const tax = items.map(taxOf).reduce(add);",
    "   return { sum, tax, total: round(sum + tax) };", " }",
  ] },
  memory: { tab: "MEMORY.md", note: "640 lines · nothing on total.js", warn: false, lines: [
    " # memory", " ", " - use npm, not yarn.", " - sign-in errors match swag labs' word for word.", " - side menu ids are fixed: never rename them.",
    " - admin_user signs in unlisted.", " - catalog lives in products.json.", " - stock starts at 10 for every product.", " - run npm test before every commit.",
    " - order numbers count up from 1001.", " - one review per user per product.", " - ask before touching package-lock.json.", " - prefer small commits.",
    " - the cart is kept in localStorage.", " - cart-changed fires on every change.", " - prices are numbers, never strings.", " - the badge hides at zero.",
    " - sorting: name a to z by default.", " - search ignores case.", " - keep ?q= in the address.", " - greeting reads 'Hi, <full name>'.",
    " - passwords are stored hashed.", " - /api/me answers 401 when signed out.", " - the server listens on PORT, 3000.", " - plugins mount their own routes.",
    " - reset app state empties the cart.", " - orders.json survives a restart.", " - my orders: newest first.", " - finish refuses a sold-out product.",
    " - checkout errors are checked in order.", " - postal code is required.", " - cancel goes back to products.", " - back home returns to products.",
    " - complete page shows the order number.", " - admin saves show 'Saved'.", " - a changed price shows at once.", " - reviews need text.",
    " - ratings: one decimal place.", " - no reviews yet says so.", " - ...",
  ] },
  bug: { tab: "issue #212", note: "order total is a cent off. again.", warn: true, lines: [
    " checkout · order overview", " ", " 2.2 · item total, 8% tax and total are right", " ", "-  expected  total: $43.18", "+  received  total: $43.19",
    " ", " first seen: 3 weeks ago", " fixed then in 4f1c2e0: round tax once", " reopened: today",
  ] },
  kept: { tab: FILE, note: "review: clean up total · 1 file · +1 -2", warn: false, lines: [
    " import { round } from './money.js';", " ", " export function totals(items) {", "-  let sum = 0;", "-  for (const item of items) sum += item.price;",
    "+  const sum = items.reduce((s, i) => s + i.price, 0);", "   const tax = round(sum * 0.08);", "   return { sum, tax, total: round(sum + tax) };", " }",
  ] },
} as const satisfies Record<string, { tab: string; note: string; warn: boolean; lines: readonly string[] }>;

/** The conversation at `seconds` on a side, and its lines laid out in `box`. */
export function chatIn(side: Side, seconds: number, box: Rect): { said: Shown[]; lines: PaneLine[] } {
  const said = shownAt(CHAT[side], seconds);
  return { said, lines: linesIn(said, box) };
}

/** When, into the beat he clicks in, the cursor lands on the island, and its panel has slid in. */
export const CLICK_AT = 1.6, PANEL_AT = 1.9, OPENED = 0.15;

/** Seconds since he clicked the island, or undefined before he has. */
export function clickedFor(seconds: number): number | undefined {
  const click = SCRIPT.with.find(beat => beat.clicks)!;
  return seconds >= click.from + CLICK_AT ? seconds - click.from - CLICK_AT : undefined;
}

/** How far the panel has slid in, 0 to 1. */
export function panelOpen(seconds: number): number {
  const since = clickedFor(seconds);
  return since === undefined ? 0 : Math.max(0, Math.min(1, (since - (PANEL_AT - CLICK_AT)) / OPENED));
}

/** The words a viewer must read at `seconds` on a side, each with its box in the frame's pixels: the thought in its bubble, and on
 * a full view of Claude every whole reply on show that came back since the cut to it. (The panel's memory is added by the scene,
 * which lays the panel out.) */
export function focusAt(side: Side, seconds: number): Focus[] {
  if (seconds >= END_CARD) return [];
  const script = SCRIPT[side], beat = beatAt(script, seconds), focus: Focus[] = [];
  if (beat.think) {
    const { x, y, width, height } = layBubble(side, beat.think);
    focus.push({ text: beat.think, box: { x, y, width, height } });
  }
  if (beat.app === "claude" && beat.view === "full") {
    const screen = { ...SCREEN.full, x: HALF[side] + SCREEN.full.x };
    let cut = script.indexOf(beat);
    while (cut > 0 && script[cut - 1]!.app === "claude" && script[cut - 1]!.view === "full") cut--;
    const { said, lines } = chatIn(side, seconds, screen);
    focus.push(...repliesRead(said, lines, screen, script[cut]!.from, seconds));
  }
  return focus;
}
