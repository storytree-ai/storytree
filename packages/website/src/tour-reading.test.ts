import assert from "node:assert/strict";
import test from "node:test";
import saved from "./forest-snapshot.json" with { type: "json" };
import type { TourSnapshot } from "./forest-data.js";
import { growthReading, savedReading } from "./tour-reading.js";
import shop from "./shop-snapshot.json" with { type: "json" };
import type { Line } from "@storytree/session-management";
import { steps } from "./tour-copy.js";

const snapshot = saved as unknown as TourSnapshot;
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

test("2.6 replay delivers saved activity through the app reading in order, with original timestamps, and holds for pause at the chosen speed", async () => {
  const recording = savedReading(snapshot, { replay: true });
  const heard: { seq: number; at: string }[] = [];
  const stop = recording.reading.subscribe({ onNews: news => { heard.push(...news.lines.map(({ seq, at }) => ({ seq, at }))); } });
  try {
    await settle();
    assert.equal(heard.length, 0, "replay starts before the first saved event");
    recording.advance(2000, { paused: true, speed: 1 });
    await settle();
    assert.equal(heard.length, 0, "pause does not deliver recorded events");
    recording.advance(2000, { speed: 1.5 });
    await settle();
    assert.deepEqual(heard, snapshot.recording.lines.slice(0, 3).map(({ seq, at }) => ({ seq, at })), "three original events at 1.5× speed, never today's timestamps");
    assert.equal(recording.now().toISOString(), snapshot.recording.lines[2]!.at);
    recording.advance(snapshot.recording.lines.length * 1000, { speed: 1 });
    await settle();
    assert.deepEqual(heard, snapshot.recording.lines.map(({ seq, at }) => ({ seq, at })));
    assert.equal(recording.progress().index, snapshot.recording.lines.length);
    assert.equal(recording.now().toISOString(), snapshot.recording.window.to);
  } finally { stop(); recording.reading.stop(); }
});

test("2.14 · free play on the shop reads its story panels, its arcs and its recorded sessions from the shop's saved growth", async () => {
  const reading = growthReading(shop as never);
  assert.ok(reading, "the shop's growth carries its reading");
  assert.equal(growthReading({ ...shop, reading: undefined } as never), undefined, "a growth saved without one has none");
  const recording = savedReading(reading);
  try {
    // A picked island's story panel: the shop's stories, each capability with the health CI verified.
    const tree = await recording.reads.projectTree(reading.project);
    const stories = tree.stories.map(story => story.title);
    for (const title of ["Browsing", "Cart", "Checkout"]) assert.ok(stories.includes(title), `${title} has a story panel`);
    assert.ok(tree.stories.every(story => story.capabilities.every(capability => capability.health?.verified)), "each capability carries its verified health");
    // The arcs drawer: the shop's own two arcs, both closed.
    assert.deepEqual((await recording.reads.arcViews(reading.project)).map(view => [view.arc.fields.title, view.state]), [["Swag Labs copy", "closed"], ["A proper shop", "closed"]]);
    // The sessions list: every recorded line, at rest at the growth's end.
    const { lines } = await recording.reads.linesSince(reading.project, 0);
    assert.equal(lines.length, reading.recording.lines.length);
    assert.ok(lines.some(line => line.kind === "session-started"), "its sessions are recorded");
  } finally { recording.reading.stop(); }
});

test("2.16 · the map chapter's arcs and sessions read the shop's records at their moments: four parts none held, then parts 2, 3 and 4 held by three live sessions", async () => {
  const shopReading = growthReading(shop as never)!;
  const step = (id: string) => steps.find(item => item.id === id)!;
  /** The arcs and the live sessions, by name, from the records offered at `until`. */
  const at = async (until: string) => {
    const recording = savedReading(shopReading, { until });
    try {
      const offered = recording.lines.slice(0, recording.progress().index);
      assert.ok(offered.every(line => line.at <= until) && recording.progress().index < recording.lines.length, `${until}: only what was recorded by then`);
      const names = new Map<string, string>(), gone = new Set<string>(), started = new Set<string>();
      // A session that never named itself reads its claim's reason, as the list shows it.
      for (const line of offered as readonly (Line & { title?: string; reason?: string; increment?: string })[]) {
        if (line.kind === "session-started") started.add(line.session!);
        if (line.kind === "claimed" && line.increment && !names.has(line.session!)) names.set(line.session!, line.reason!);
        if (line.kind === "session-named") names.set(line.session!, line.title!);
        if (line.kind === "closed-out" || line.kind === "session-ended") gone.add(line.session!);
      }
      const arcs = await recording.reads.arcViews("shop3");
      return { arcs: arcs.map(view => [view.arc.fields.title, view.increments.map(increment => [increment.fields.title, increment.fields.status])]),
        live: [...started].filter(session => !gone.has(session)).map(session => names.get(session) ?? session).sort() };
    } finally { recording.reading.stop(); }
  };
  // Step 2: the shop's first arc, its four parts planned and none held yet.
  assert.deepEqual((await at(step("map-arcs").sessionsAt!)).arcs, [["Swag Labs copy", [
    ["Part 1: Sign in and the Products list", "proposal"], ["Part 2: Browsing", "proposal"], ["Part 3: The cart and the menu", "proposal"], ["Part 4: Checkout", "proposal"],
  ]]]);
  // Step 5: parts 2, 3 and 4 each held, by the three sessions whose flags stand.
  const claims = await at(step("map-claims").sessionsAt!);
  assert.deepEqual(claims.arcs[0]![1], [
    ["Part 1: Sign in and the Products list", "closed"], ["Part 2: Browsing", "active"], ["Part 3: The cart and the menu", "active"], ["Part 4: Checkout", "active"],
    ["Fix: sign-in errors show without a page load", "closed"],
  ]);
  assert.equal(claims.live.length, 3, `three live sessions: ${claims.live}`);
  assert.ok(claims.live.includes("Part 2: product page, sorting, cart") && claims.live.includes("Part 4: Checkout"), `${claims.live}`);
});
