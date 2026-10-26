/** Capability 6 · Pixel-art shorts. The second short, "one map for you and your agents" (claim 2 on storytree.dev, ADR-1104 D2), as
 * data: the same developer at the same desk on both halves, in the first short's room, now with two Claude Code sessions side by
 * side, given the same two jobs on the shop. Without storytree the two agents pile up large diffs in one checkout, and the second
 * rewrites a file under the first while he is still reviewing it (the owner's own pain, shown rather than said). With storytree
 * he and both agents see one map: each session's claim stands on the shop's map as a flag in its colour, the second agent is told
 * the part it wanted is claimed and starts elsewhere, takes it once the first lets it go, and what he reviews is small. Every
 * position is in the 480×270 frame's own pixels. */
import { columnsOf, END_CARD, HALF, layBubble, LENGTH, SCREEN, SMALL, wrap, type Focus, type Pose, type Rect, type Side, type View } from "./script.js";

export { END_CARD, LENGTH };

/** What the screen shows: the two Claude Code sessions, a file under review, or the map. */
export type App = "claude" | "code" | "map";
export type Beat = {
  from: number; to: number;
  pose: Pose;
  app: App; view: View;
  think?: string;
  /** On the code: what is open (a key of DIFFS). */
  diff?: keyof typeof DIFFS;
};

/** The two sessions, the same two jobs on both halves; on the storytree side each wears its own colour (Session management's
 * `sessionColour` of its id) on the map, its row and its flags. */
export const SESSIONS = [
  { id: "agent-1", name: "discount codes", job: "add discount codes to the cart" },
  { id: "agent-2", name: "delivery cost", job: "show the delivery cost in the cart" },
] as const;
export type Pane = 0 | 1;

/** The shop's parts the two jobs touch, by their real names in the saved snapshot: both need the cart page; the second can
 * start on the order overview at checkout. */
export const PARTS = {
  cartPage: { story: "story_2de9e8f4db21", capability: "capability_ed214990be99", island: "Cart", title: "1 · Cart page" },
  orderOverview: { story: "story_66f80ffaaa4d", capability: "capability_668ca101a358", island: "Checkout", title: "2 · Order overview" },
} as const;
export type Part = keyof typeof PARTS;

/** A session's claim on the storytree side: from when to when it stands on the map. */
export type Claim = { session: Pane; part: Part; from: number; to: number };
export const CLAIMS: readonly Claim[] = [
  { session: 0, part: "cartPage", from: 10.4, to: 29.8 },
  { session: 1, part: "orderOverview", from: 11.6, to: END_CARD },
  { session: 1, part: "cartPage", from: 31, to: END_CARD },
];

/** The claims standing at `seconds`. */
export const claimsAt = (seconds: number) => CLAIMS.filter(claim => seconds >= claim.from && seconds < claim.to);

/** One thing said in a session's pane: a prompt he types (a character at a time, at `rate`), a reply, or one of its work steps
 * (a file it edits, a test run), drawn dim. */
export type Said = { pane: Pane; who: "you" | "claude" | "step"; text: string; at: number; rate?: number };

/** Typing speed of the opening prompts, in characters a second. */
const RATE = 16;
const OPENING_CHAT: readonly Said[] = [
  { pane: 0, who: "you", text: SESSIONS[0].job, at: 1.5, rate: RATE },
  { pane: 0, who: "claude", text: "on it.", at: 4.0 },
  { pane: 1, who: "you", text: SESSIONS[1].job, at: 4.4, rate: RATE },
  { pane: 1, who: "claude", text: "on it.", at: 7.1 },
];

/** Each step `every` seconds apart from `at`, in one pane. */
const steps = (pane: Pane, at: number, every: number, texts: readonly string[]): Said[] =>
  texts.map((text, step) => ({ pane, who: "step", text, at: at + step * every }));

/** Both agents edit the same file in one checkout, and every other file the jobs reach, with nothing to keep them apart. */
export const PILED = {
  0: ["edit cart/total.ts", "edit cart/discount.ts", "edit cart/page.tsx", "edit checkout/summary.ts", "edit db/schema.ts",
    "edit db/migrate/014.ts", "edit orders/receipt.ts", "edit 10 more files"],
  1: ["edit delivery/rates.ts", "edit cart/page.tsx", "edit checkout/summary.ts", "edit db/schema.ts", "edit cart/total.ts",
    "edit orders/receipt.ts", "edit admin/zones.tsx", "edit 8 more files"],
} as const satisfies Record<Pane, readonly string[]>;
/** What each pane's diff has grown to by the time its steps are done. */
export const PILE = { 0: { added: 412, removed: 63, files: 17 }, 1: { added: 388, removed: 71, files: 15 } } as const;
export const PILING = { from: 10.3, every: 1.1 } as const;

/** The two sessions' panes, side by side, half by half. */
export function chat(side: Side): readonly Said[] {
  if (side === "without") return [
    ...OPENING_CHAT,
    ...steps(0, PILING.from, PILING.every, PILED[0]),
    ...steps(1, PILING.from + 0.5, PILING.every, PILED[1]),
    { pane: 0, who: "you", text: "who changed total.ts?", at: 32.2, rate: 18 },
    { pane: 0, who: "claude", text: "the other session did, after my edit. the discount is gone from it.", at: 34.0 },
    { pane: 1, who: "claude", text: "done: delivery cost. 15 files changed.", at: 33.0 },
  ];
  return [
    ...OPENING_CHAT,
    { pane: 0, who: "claude", text: "claimed cart · 1 · cart page.", at: CLAIMS[0]!.from },
    ...steps(0, 11.2, 1.2, ["edit cart/total.ts", "edit cart/discount.ts"]),
    { pane: 1, who: "claude", text: "cart page is claimed by the other session. starting on checkout · order overview.", at: CLAIMS[1]!.from },
    ...steps(1, 18.2, 1, ["edit checkout/summary.ts"]),
    { pane: 0, who: "step", text: "run tests: 31 passed", at: 29.3 },
    { pane: 0, who: "claude", text: "done: discount codes. 3 files, +38 -6. claim let go.", at: CLAIMS[0]!.to },
    { pane: 1, who: "claude", text: "cart page is free now. claimed it.", at: CLAIMS[2]!.from },
  ];
}

/** The two halves, beat by beat. Their turns line up and cut together: both open the two sessions at 1.5 s and lean back as they
 * work at 9 s; then without storytree he watches the diffs pile up, reviews the first, sees the file change under him, asks, and
 * is left untangling the two; with storytree he reads the second agent wait its turn, sees both claims on the map, reads the first
 * let its part go and the second take it, sees that on the map, and reviews a small change. */
export const SCRIPT: Record<Side, readonly Beat[]> = {
  without: [
    { from: 0, to: 1.5, pose: "typing", app: "claude", view: "room" },
    { from: 1.5, to: 9, pose: "typing", app: "claude", view: "full" },
    { from: 9, to: 10, pose: "leaning", app: "claude", view: "room" },
    { from: 10, to: 13, pose: "leaning", app: "claude", view: "full" },
    { from: 13, to: 20, pose: "leaning", app: "claude", view: "full", think: "two agents at once. twice as fast." },
    { from: 20, to: 21, pose: "reading", app: "code", view: "room", diff: "review" },
    { from: 21, to: 27, pose: "reading", app: "code", view: "full", diff: "review", think: "17 files. start with the total." },
    { from: 27, to: 31, pose: "reading", app: "code", view: "full", diff: "changed", think: "wait. it just changed." },
    { from: 31, to: 32, pose: "typing", app: "claude", view: "room" },
    { from: 32, to: 42, pose: "typing", app: "claude", view: "full" },
    { from: 42, to: 43, pose: "reading", app: "code", view: "room", diff: "tangle" },
    { from: 43, to: END_CARD, pose: "reading", app: "code", view: "full", diff: "tangle", think: "ok. untangle it by hand." },
  ],
  with: [
    { from: 0, to: 1.5, pose: "typing", app: "claude", view: "room" },
    { from: 1.5, to: 9, pose: "typing", app: "claude", view: "full" },
    { from: 9, to: 10, pose: "leaning", app: "claude", view: "room" },
    { from: 10, to: 19, pose: "leaning", app: "claude", view: "full" },
    { from: 19, to: 20, pose: "leaning", app: "map", view: "room" },
    { from: 20, to: 21, pose: "leaning", app: "map", view: "full" },
    { from: 21, to: 28, pose: "leaning", app: "map", view: "full", think: "so that's who is where." },
    { from: 28, to: 29, pose: "leaning", app: "claude", view: "room" },
    { from: 29, to: 37, pose: "leaning", app: "claude", view: "full" },
    { from: 37, to: 38, pose: "leaning", app: "map", view: "room" },
    { from: 38, to: 45, pose: "leaning", app: "map", view: "full", think: "we all see the same map." },
    { from: 45, to: 46, pose: "reading", app: "code", view: "room", diff: "small" },
    { from: 46, to: END_CARD, pose: "reading", app: "code", view: "full", diff: "small", think: "small enough to read." },
  ],
};

/** The poster frame: the diffs piling up on one side while the claims stand on the map on the other. */
export const POSTER = 24;

/** A diff line: added, removed, or kept; a banner line is the editor's note across the top. */
export type DiffLine = { mark: "+" | "-" | " "; text: string };
/** What the code screen shows, by name: its tab, the note above the file (the change's size, or the editor's warning) and its
 * lines. */
export const DIFFS = {
  review: { tab: "src/cart/total.ts", note: "review: discount codes · 17 files · +412 -63", warn: false, lines: [
    " import { sum } from './sum';", "+import { discountFor } from './discount';", "+import { codes } from '../db/codes';", " ",
    " export function total(cart: Cart) {", "-  return sum(cart);", "+  const off = discountFor(cart.code);", "+  if (off > sum(cart)) return 0;",
    "+  return sum(cart) - off;", " }", " ", "+export async function apply(cart, code: string) {", "+  const found = await codes.find(code);",
    "+  if (!found) throw new Error('no such code');", "+  cart.code = found.code;", "+  return total(cart);", "+}", " ",
    "+export function reset(cart: Cart) {", "+  cart.code = undefined;", "+}", " ", "+// receipts show the code used", "+export const label = (cart: Cart) =>",
    "+  cart.code ? `code ${cart.code}` : '';", "+", "+export function validate(code: string) {", "+  return /^[a-z0-9]{4,12}$/i.test(code);", "+}",
  ] },
  changed: { tab: "src/cart/total.ts", note: "total.ts changed on disk. reloaded.", warn: true, lines: [
    " import { sum } from './sum';", "+import { rateFor } from '../delivery/rates';", " ", " export function total(cart: Cart) {",
    "-  return sum(cart);", "+  const delivery = rateFor(cart.address);", "+  return sum(cart) + delivery;", " }", " ",
    "+export function freeOver(cart: Cart) {", "+  return sum(cart) >= 50;", "+}",
  ] },
  tangle: { tab: "src/cart/total.ts", note: "git diff · 32 files · +800 -134", warn: false, lines: [
    " export function total(cart: Cart) {", "-  const off = discountFor(cart.code);", "-  if (off > sum(cart)) return 0;", "-  return sum(cart) - off;",
    "+  const delivery = rateFor(cart.address);", "+  return sum(cart) + delivery;", " }", " ", " export async function apply(cart, code: string) {",
    "   const found = await codes.find(code);", "   if (!found) throw new Error('no such code');", "   cart.code = found.code;", "-  return total(cart);",
    "+  return sum(cart);", " }", " ", "+export function freeOver(cart: Cart) {", "+  return sum(cart) >= 50;", "+}", " ", " export function reset(cart: Cart) {",
    "-  cart.code = undefined;", "+  cart.code = null;", " }", " ", "-// receipts show the code used", "+// receipts show delivery and the code used",
  ] },
  small: { tab: "src/cart/total.ts", note: "review: discount codes · 3 files · +38 -6", warn: false, lines: [
    " import { sum } from './sum';", "+import { discountFor } from './discount';", " ", " export function total(cart: Cart) {", "-  return sum(cart);",
    "+  const off = discountFor(cart.code);", "+  return Math.max(0, sum(cart) - off);", " }",
  ] },
} as const satisfies Record<string, { tab: string; note: string; warn: boolean; lines: readonly string[] }>;

/** The beat playing at `seconds` on a side; past the last it holds the last. */
export function beatAt<B extends { from: number; to: number }>(side: readonly B[], seconds: number): B {
  return side.find(beat => seconds >= beat.from && seconds < beat.to) ?? side[side.length - 1]!;
}

/** A pane's box inside a full view of the screen: the two side by side, each with its own title row. */
export function paneBox(screen: Rect, pane: Pane): Rect {
  const width = Math.floor((screen.width - 1) / 2);
  return { x: screen.x + pane * (width + 1), y: screen.y, width, height: screen.height };
}

/** What a conversation holds at `seconds`: every prompt typed so far (the current one as far as it has been typed) and every
 * reply and step come back, in order, each with when it started showing and when it was whole. */
export type Shown = Said & { done: number };
export function shownAt(said: readonly Said[], seconds: number): Shown[] {
  return said.filter(each => each.at <= seconds).sort((a, b) => a.at - b.at).map(each => {
    if (each.who !== "you") return { ...each, done: each.at };
    const done = each.at + each.text.length / (each.rate ?? RATE);
    return { ...each, text: each.text.slice(0, seconds >= done ? each.text.length : Math.floor((seconds - each.at) * (each.rate ?? RATE))), done };
  });
}
/** What a pane holds at `seconds`. */
export const paneAt = (side: Side, pane: Pane, seconds: number): Shown[] => shownAt(chat(side).filter(said => said.pane === pane), seconds);

export type PaneLine = { who: Said["who"]; text: string; mark: boolean; said: number; x: number; y: number };
/** A conversation's last lines that fit in `box` under its title row (and over `reserve` pixels kept at its foot), each placed
 * in the frame's pixels and naming the message it belongs to. */
export function linesIn(said: readonly Shown[], box: Rect, reserve = 0): PaneLine[] {
  const columns = columnsOf(box.width, SMALL.advance) - 2;
  const all = said.flatMap(({ who, text }, index) => {
    const wrapped = text ? wrap(text, columns) : [""];
    // A step follows the line before it; a prompt or a reply has a blank line above it.
    return [...(index && who !== "step" ? [{ who, text: "", mark: false, said: index }] : []), ...wrapped.map((line, row) => ({ who, text: line, mark: row === 0, said: index }))];
  });
  const rows = Math.floor((box.height - 12 - reserve) / SMALL.line);
  const shown = all.slice(-rows), orphans = shown.findIndex(line => line.mark || !line.text);
  const left = box.x + 3 + 2 * SMALL.advance;
  return shown.map((line, row) => ({ ...line, x: left, y: box.y + 11 + row * SMALL.line })).slice(Math.max(0, orphans));
}
/** A pane's lines at `seconds`, over its diff's size on the side without storytree while its agent works. */
export function paneLines(side: Side, pane: Pane, seconds: number, box: Rect): { said: Shown[]; lines: PaneLine[] } {
  const said = paneAt(side, pane, seconds);
  return { said, lines: linesIn(said, box, side === "without" ? 2 * SMALL.line : 0) };
}

/** The replies to read in a box of a conversation at `seconds`: every whole reply on show that came back `since` the cut to it,
 * with its box in the frame's pixels (a prompt is read as it is typed; a step is seen, not read). */
export function repliesRead(said: readonly Shown[], lines: readonly PaneLine[], box: Rect, since: number, seconds: number): Focus[] {
  const columns = columnsOf(box.width, SMALL.advance) - 2;
  return said.flatMap((message, index) => {
    const shown = lines.filter(line => line.said === index && line.text);
    if (message.who !== "claude" || message.at < since || seconds < message.done || !shown.length || shown.length < wrap(message.text, columns).length) return [];
    const top = Math.min(...shown.map(line => line.y)), bottom = Math.max(...shown.map(line => line.y)) + 5;
    const right = Math.max(...shown.map(line => line.x + line.text.length * SMALL.advance));
    return [{ text: message.text, box: { x: shown[0]!.x, y: top, width: right - shown[0]!.x, height: bottom - top } }];
  });
}

/** How big a pane's diff has grown at `seconds`, on the side without storytree: in step with its edits. */
export function pileAt(pane: Pane, seconds: number): { added: number; removed: number; files: number } | undefined {
  const start = PILING.from + pane * 0.5, edits = PILED[pane].length;
  if (seconds < start) return undefined;
  const done = Math.min(1, (Math.floor((seconds - start) / PILING.every) + 1) / edits), { added, removed, files } = PILE[pane];
  return { added: Math.round(added * done), removed: Math.round(removed * done), files: Math.max(1, Math.round(files * done)) };
}

/** The words a viewer must read at `seconds` on a side, each with its box in the frame's pixels: the thought in its bubble, and
 * on a full view of the sessions, every whole reply on show that came back since the cut to it (a prompt is read as it is typed;
 * a step is seen, not read). */
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
    const since = script[cut]!.from;
    for (const pane of [0, 1] as const) {
      const box = paneBox(screen, pane), { said, lines } = paneLines(side, pane, seconds, box);
      focus.push(...repliesRead(said, lines, box, since, seconds));
    }
  }
  return focus;
}
