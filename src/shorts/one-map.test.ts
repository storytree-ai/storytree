// Capability 6 · Pixel-art shorts: the second short's script, claims and layout, checked without a browser.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { sessionColour } from "@storytree/forest";
import type { CastMap } from "./cast.js";
import { drawable } from "./font.js";
import { chat, CLAIMS, DIFFS, END_CARD, LENGTH, PARTS, SCRIPT, SESSIONS } from "./one-map.js";
import { COLOURS, drawOneMap, flagLabel, focusIn, hex, mapProps, PALETTE, wispsAt } from "./one-map-scene.js";
import { SECOND_SHORT } from "./root.js";
import { BUBBLE, columnsOf, GLYPH, HALF, HALF_WIDTH, layBubble, PAD, readingTime, SCREEN, SMALL, type Rect, type Side } from "./script.js";

const sprites = new URL("./public/sprites/", import.meta.url);
const cast = JSON.parse(await readFile(new URL("cast.json", sprites), "utf8")) as CastMap;
const sides = ["without", "with"] as const satisfies readonly Side[];
const frames = Array.from({ length: END_CARD * SECOND_SHORT.fps }, (_, frame) => frame / SECOND_SHORT.fps);

test("6.14 · claim 2's short: without storytree both agents edit one file and it changes under the review; with storytree each claim stands on the map in its session's colour and the second agent takes the part only once the first lets it go", () => {
  for (const side of sides) for (const pane of [0, 1] as const)
    assert.equal(chat(side).find(said => said.pane === pane && said.who === "you")?.text, SESSIONS[pane].job, `both halves give session ${pane + 1} the same job`);
  const without = chat("without"), edits = (pane: 0 | 1) => without.filter(said => said.pane === pane && said.who === "step").map(said => said.text);
  const shared = edits(0).filter(edit => edits(1).includes(edit));
  assert.ok(shared.includes("edit cart/total.ts"), "without storytree both agents edit the cart's total");
  const reviewed = SCRIPT.without.findIndex(beat => beat.diff === "review"), changed = SCRIPT.without.findIndex(beat => beat.diff === "changed");
  assert.ok(reviewed >= 0 && changed > reviewed && DIFFS.changed.tab === DIFFS.review.tab && DIFFS.changed.warn, "and the file he is reviewing changes under him");

  for (const one of CLAIMS) for (const other of CLAIMS) if (one !== other && one.part === other.part)
    assert.ok(one.to <= other.from || other.to <= one.from, `no two sessions hold ${PARTS[one.part].title} at once`);
  const first = CLAIMS.find(claim => claim.session === 0 && claim.part === "cartPage")!, second = CLAIMS.find(claim => claim.session === 1 && claim.part === "cartPage")!;
  assert.ok(second.from >= first.to, "the second session claims the cart page only after the first has let it go");
  const refused = chat("with").find(said => said.pane === 1 && said.who === "claude" && said.text.includes("claimed by the other session"));
  assert.ok(refused && refused.at >= first.from && refused.at < first.to && refused.text.includes(PARTS.cartPage.title.replace(/^\d+ · /, "").toLowerCase()),
    "while the first holds it, the second is told the part is claimed");
  for (const seconds of frames) {
    const held = wispsAt(seconds).flatMap(wisp => wisp.capabilities.map(capability => `${wisp.session} ${capability} ${wisp.colour}`)).sort();
    const claimed = CLAIMS.filter(claim => seconds >= claim.from && seconds < claim.to)
      .map(claim => `${SESSIONS[claim.session].id} ${PARTS[claim.part].capability} ${sessionColour(SESSIONS[claim.session].id)}`).sort();
    assert.deepEqual(held, claimed, `at ${seconds.toFixed(2)} s the map is handed exactly the claims standing, each in its session's colour`);
    assert.equal(mapProps(seconds).wisps.length, wispsAt(seconds).length);
  }
  assert.deepEqual(COLOURS.map(colour => PALETTE.includes(colour as never)), [true, true], "the map's palette keeps both sessions' colours");
  assert.equal(hex("hsl(0, 100%, 50%)"), "#ff0000");
});

test("6.15 · every line a viewer must read is held its reading time, every bubble fits its half, and every word on a screen fits across it", () => {
  for (const side of sides) {
    const open = new Map<string, number>(), held = new Map<string, number>();
    for (const seconds of [...frames, END_CARD]) {
      const now = new Set(focusIn(side, seconds).map(focus => focus.text));
      for (const [text, from] of open) if (!now.has(text)) { held.set(text, Math.max(held.get(text) ?? 0, seconds - from)); open.delete(text); }
      for (const text of now) if (!open.has(text)) open.set(text, seconds);
    }
    for (const [text, seconds] of held) assert.ok(seconds >= readingTime(text) - 1e-9, `"${text}" (${side}) shows ${seconds.toFixed(2)} s; it needs ${readingTime(text).toFixed(2)} s`);
    for (const beat of SCRIPT[side]) if (beat.think) {
      assert.ok(held.has(beat.think), `"${beat.think}" is held to be read`);
      const laid = layBubble(side, beat.think);
      assert.equal(laid.lines.join(" "), beat.think);
      assert.ok(laid.lines.length <= BUBBLE.rows && laid.lines.every(line => line.length * GLYPH <= BUBBLE.width - 2 * PAD), `"${beat.think}" fits its bubble`);
      assert.ok(laid.x >= HALF[side] && laid.x + laid.width <= HALF[side] + HALF_WIDTH, `"${beat.think}" stays on its half`);
    }
    for (const said of chat(side)) if (said.who === "claude") assert.ok(held.has(said.text), `"${said.text}" (${side}) is held to be read`);
  }
  const pane = columnsOf(Math.floor((SCREEN.full.width - 1) / 2), SMALL.advance) - 2;
  for (const side of sides) for (const said of chat(side)) {
    assert.ok([...said.text].every(drawable), `the screen font draws every character of "${said.text}"`);
    assert.ok(said.text.split(/\s+/).every(word => word.length <= pane), `"${said.text}" wraps in its pane without breaking a word`);
  }
  const across = Math.floor((SCREEN.full.width - 13) / SMALL.advance);
  for (const { tab, note, lines } of Object.values(DIFFS)) for (const line of [tab, note, ...lines.map(each => each.slice(1))]) {
    assert.ok([...line].every(drawable), `the screen font draws "${line}"`);
    assert.ok(line.length <= across, `"${line}" fits across the code screen (${line.length} of ${across})`);
  }
});

test("6.16 · on the map each claim's flag stands where the view drew it, in its session's colour, named by its part in a label inside the screen that covers no other name", () => {
  const view = { real: "view" } as unknown as CanvasImageSource, sheet = { cast: "sheet" } as unknown as CanvasImageSource;
  const seconds = SCRIPT.with.find(beat => beat.app === "map" && beat.view === "full")!.from + 1, screen = { ...SCREEN.full, x: HALF.with + SCREEN.full.x };
  const flags = [{ capability: PARTS.cartPage.capability, colour: sessionColour(SESSIONS[0].id), x: 400, y: 300 },
    { capability: PARTS.orderOverview.capability, colour: sessionColour(SESSIONS[1].id), x: 560, y: 320 }];
  const filled: { style: string; x: number; y: number }[] = [], copies: unknown[][] = [];
  let style = "";
  const ctx = new Proxy({}, {
    get: (_, name) => name === "measureText" ? () => ({ width: 0 }) : (...args: unknown[]) => {
      if (name === "fillRect") filled.push({ style, x: args[0] as number, y: args[1] as number });
      if (name === "drawImage" && args[0] === view) copies.push(args.slice(-4));
    },
    set: (_, name, value) => { if (name === "fillStyle") style = value as string; return true; },
  }) as unknown as CanvasRenderingContext2D;
  drawOneMap(ctx, { seconds, frames: LENGTH * 30, cast, sheet, view, map: { width: 912, height: 856, flags } });
  assert.deepEqual(copies, [[screen.x, screen.y, screen.width, screen.height]], "the view's drawing fills the screen");
  flags.forEach(({ x, y }, index) => {
    const [fx, fy] = [screen.x + Math.round(x * screen.width / 912), screen.y + Math.round(y * screen.height / 856)];
    assert.ok(filled.some(rect => rect.style === COLOURS[index] && rect.x === fx + 1 && rect.y < fy && rect.y >= fy - 11), `flag ${index + 1}'s pennant is in its session's colour, on its pole at the view's foot`);
  });
  const taken: Rect[] = [{ x: 300, y: 80, width: 30, height: 9 }];
  const label = flagLabel(screen, 310, 100, "order overview", taken)!;
  assert.ok(label.x >= screen.x && label.x + label.width <= screen.x + screen.width && label.y >= screen.y, "inside the screen");
  assert.ok(!taken.some(other => label.x < other.x + other.width && other.x < label.x + label.width && label.y < other.y + other.height && other.y < label.y + label.height), "and over no name already placed");
  assert.equal(flagLabel(screen, screen.x + screen.width - 2, screen.y + 4, "order overview", [{ ...screen }]), undefined, "a label with nowhere clear is left off rather than drawn over another");
});

test("6.17 · the second short runs 45 to 60 seconds, its end card after both halves' last beats", () => {
  assert.ok(LENGTH >= 45 && LENGTH <= 60, `${LENGTH} s`);
  for (const side of sides) assert.equal(SCRIPT[side].at(-1)!.to, END_CARD, `the ${side} half plays until the end card`);
  assert.ok(END_CARD < LENGTH);
});
