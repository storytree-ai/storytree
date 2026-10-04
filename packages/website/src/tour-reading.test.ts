import assert from "node:assert/strict";
import test from "node:test";
import saved from "./forest-snapshot.json" with { type: "json" };
import type { TourSnapshot } from "./forest-data.js";
import { savedReading } from "./tour-reading.js";
import shop from "./shop-snapshot.json" with { type: "json" };
import type { Line } from "@storytree/agent-link";
import { createTour, globeOf } from "./tour.js";
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

test("2.17 · the agents chapter pins the shop's records to recorded moments: three sessions building at once, then the session that stood down", async () => {
  const shopReading = { ...shop, ...shop.reading, changes: shop.changes ?? [] } as unknown as TourSnapshot;
  const chapter = steps.filter(step => step.explainer === "agents");
  assert.ok(chapter.length >= 5 && chapter.every(step => step.map === "shop" && step.recorded), "every agents step is the shop at a recorded moment");
  const tour = createTour(steps);
  tour.go(steps.indexOf(chapter[1]!));
  assert.equal((globeOf(chapter[1]!, tour.state) as { when?: string }).when, chapter[1]!.recorded, "the globe shows the shop as it stood then");
  /** The sessions live at `step`'s moment, by name, from the records offered then. */
  const live = (id: string) => {
    const step = chapter.find(item => item.id === id)!;
    const recording = savedReading(shopReading, { until: step.recorded! });
    try {
      const offered = recording.lines.slice(0, recording.progress().index);
      assert.ok(offered.every(line => line.at <= step.recorded!) && recording.progress().index < recording.lines.length, `${id}: only what was recorded by then`);
      const names = new Map<string, string>(), gone = new Set<string>(), started = new Set<string>();
      // A session that never named itself reads its claim's reason, as the list shows it.
      for (const line of offered as readonly (Line & { title?: string; reason?: string; increment?: string })[]) {
        if (line.kind === "session-started") started.add(line.session!);
        if (line.kind === "claimed" && line.increment && !names.has(line.session!)) names.set(line.session!, line.reason!);
        if (line.kind === "session-named") names.set(line.session!, line.title!);
        if (line.kind === "closed-out" || line.kind === "session-ended") gone.add(line.session!);
      }
      return [...started].filter(session => !gone.has(session)).map(session => names.get(session) ?? session);
    } finally { recording.reading.stop(); }
  };
  // The arcs as they stood then: the first arc active, part 1 closed, parts 2, 3 and 4 being built; the second not yet planned.
  const together = chapter.find(item => item.id === "agents-parallel")!.recorded!;
  const then = savedReading(shopReading, { until: together });
  try {
    const arcs = await then.reads.arcViews("shop2");
    assert.deepEqual(arcs.map(view => [view.arc.fields.title, view.state]), [["Swag Labs copy", "active"]]);
    const count = (status: string) => arcs[0]!.increments.filter(increment => increment.fields.status === status).length;
    assert.deepEqual([count("closed"), count("active")], [2, 3], "part 1 and its fix closed; parts 2, 3 and 4 claimed");
  } finally { then.reading.stop(); }
  assert.deepEqual(live("agents-parallel").sort(), ["Part 2: Browsing", "Part 3: cart page and menu", "Part 4: Checkout"]);
  assert.deepEqual(live("agents-standdown").sort(), ["1706a9dd-208b-4d97-bea5-6d77beef73ad", "Part 7: Search", "Part 8: Reviews"].sort(),
    "part 7 and part 8 are held, and the session sent to part 7 has started and not yet stood down");
});
