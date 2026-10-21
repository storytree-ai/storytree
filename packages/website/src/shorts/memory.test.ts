// Capability 6 · Pixel-art shorts: the third short's script, its map and its panel, checked without a browser.
import assert from "node:assert/strict";
import { test } from "node:test";
import { drawable } from "./font.js";
import { CHAT, clickedFor, END_CARD, FILE, FILES, JOB, LENGTH, panelOpen, SCRIPT, STORY } from "./memory.js";
import { aimAt, focusIn, layPanel, mapProps, PANEL_WIDTH, panelBox } from "./memory-scene.js";
import { THIRD_SHORT } from "./root.js";
import { BUBBLE, columnsOf, GLYPH, HALF, HALF_WIDTH, layBubble, PAD, readingTime, SCREEN, SMALL, type Side } from "./script.js";
import saved from "../shop-snapshot.json" with { type: "json" };

const sides = ["without", "with"] as const satisfies readonly Side[];
const frames = Array.from({ length: END_CARD * THIRD_SHORT.fps }, (_, frame) => frame / THIRD_SHORT.fps);
/** The line that rounds tax once, on the total: the reason the memory keeps. */
const ROUND_ONCE = "  const tax = round(sum * 0.08);";

test("6.19 · claim 3's short: without storytree the agent tidies away why tax is rounded once and cannot say why it was so; with storytree it reads the story's memory before it edits and keeps it", () => {
  for (const side of sides) assert.equal(CHAT[side].find(said => said.who === "you")?.text, JOB, `the ${side} half gives the same job`);
  for (const side of sides) assert.ok(CHAT[side].some(said => said.who === "step" && said.text === `edit ${FILE}`), `the ${side} half's agent edits ${FILE}`);

  const tidied: readonly string[] = FILES.tidied.lines, kept: readonly string[] = FILES.kept.lines;
  assert.ok(tidied.includes(`-${ROUND_ONCE}`), "without storytree the change removes rounding once, on the total");
  assert.ok(kept.includes(` ${ROUND_ONCE}`) && !kept.includes(`-${ROUND_ONCE}`), "with storytree the change keeps it");
  const without = CHAT.without, asked = without.findIndex(said => said.who === "you" && /why/.test(said.text));
  assert.ok(asked > 0 && without.slice(asked).some(said => said.who === "claude" && /can't find why/.test(said.text)), "asked why, the agent without storytree cannot say");
  assert.ok(FILES.memory.lines.every(line => !/total\.js|\btax\b/.test(line)), "and its memory file has nothing on that file or on tax");
  assert.ok(FILES.bug.warn && FILES.bug.lines.some(line => /round tax once/.test(line)), "so the bug the reason prevented comes back");

  const withChat = CHAT.with, read = withChat.findIndex(said => said.who === "step" && said.text.startsWith(`read story ${STORY.title.toLowerCase()}`));
  const edit = withChat.findIndex(said => said.who === "step" && said.text.startsWith("edit "));
  assert.ok(read >= 0 && read < edit, "with storytree the agent reads the story before it edits");
  assert.ok(withChat[read]!.text.includes(`${STORY.code.length} files, 1 memory`), "and the story says how much code and memory are attached to it");
  assert.ok(STORY.code.includes(FILE.replace(/^checkout\//, "") as never) && STORY.package.endsWith("/checkout"), "the file it edits is among the story's code");
  assert.ok(withChat.filter(said => said.who === "claude" && /memory/.test(said.text)).length >= 2, "and it acts on the story's memory, once for this job and again for the next");

  const island = (saved.scene.islands as readonly { story: string; title: string }[]).find(each => each.story === STORY.story);
  assert.equal(island?.title, STORY.title, "the story is an island on the shop's saved map, by its real name");
  for (const seconds of frames) {
    const clicked = clickedFor(seconds) !== undefined;
    assert.equal(mapProps(seconds).selected, clicked ? STORY.story : undefined, `at ${seconds.toFixed(2)} s Checkout is selected only once he has clicked it`);
    assert.equal(aimAt(seconds), clicked ? "island" : "sheet");
  }
});

test("6.20 · Checkout's panel lists exactly the story's code and its memory inside the panel, clear of the map's switches, and every line a viewer must read is held its reading time and fits", () => {
  const screen = { ...SCREEN.full, x: HALF.with + SCREEN.full.x }, at = panelBox(screen, 1), laid = layPanel(at);
  assert.deepEqual(laid.files.map(file => file.text), [...STORY.code], "the panel lists the story's code, a file a line");
  assert.equal(laid.note.lines.map(line => line.text).join(" "), STORY.memory, "and its memory whole");
  const right = at.x + at.width - 2;
  for (const { text, x, y } of [laid.title, laid.package, laid.code, ...laid.files, laid.memory, ...laid.note.lines]) {
    assert.ok([...text].every(drawable), `the screen font draws "${text}"`);
    assert.ok(x >= at.x + 2 && x + text.length * SMALL.advance <= right && y >= at.y && y + 5 <= at.y + at.height, `"${text}" fits inside the panel`);
  }
  assert.ok(laid.note.box.x + laid.note.box.width <= at.x + at.width && laid.note.box.y + laid.note.box.height <= at.y + at.height, "the memory's note fits inside the panel");
  // The app's switches end 122 pixels into the map: the panel never covers them.
  assert.ok(screen.width - PANEL_WIDTH >= 122, "the panel stays clear of the map's switches");

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
      const bubble = layBubble(side, beat.think);
      assert.equal(bubble.lines.join(" "), beat.think);
      assert.ok(bubble.lines.length <= BUBBLE.rows && bubble.lines.every(line => line.length * GLYPH <= BUBBLE.width - 2 * PAD), `"${beat.think}" fits its bubble`);
      assert.ok(bubble.x >= HALF[side] && bubble.x + bubble.width <= HALF[side] + HALF_WIDTH, `"${beat.think}" stays on its half`);
    }
    for (const said of CHAT[side]) if (said.who === "claude") assert.ok(held.has(said.text), `"${said.text}" (${side}) is held to be read`);
  }
  assert.ok(focusIn("with", frames.find(seconds => panelOpen(seconds) >= 1)!).some(focus => focus.text === STORY.memory), "the memory is read once the panel is open");
  const columns = columnsOf(SCREEN.full.width, SMALL.advance) - 2, across = Math.floor((SCREEN.full.width - 13) / SMALL.advance);
  for (const side of sides) for (const said of CHAT[side]) {
    assert.ok([...said.text].every(drawable), `the screen font draws every character of "${said.text}"`);
    assert.ok(said.text.split(/\s+/).every(word => word.length <= columns), `"${said.text}" wraps without breaking a word`);
  }
  for (const { tab, note, lines } of Object.values(FILES)) for (const line of [tab, note, ...lines.map(each => each.slice(1))]) {
    assert.ok([...line].every(drawable), `the screen font draws "${line}"`);
    assert.ok(line.length <= across, `"${line}" fits across the code screen (${line.length} of ${across})`);
  }
});

test("6.21 · the third short runs 45 to 60 seconds, its end card after both halves' last beats", () => {
  assert.ok(LENGTH >= 45 && LENGTH <= 60, `${LENGTH} s`);
  for (const side of sides) assert.equal(SCRIPT[side].at(-1)!.to, END_CARD, `the ${side} half plays until the end card`);
  assert.ok(END_CARD < LENGTH);
});
