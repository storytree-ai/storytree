import assert from "node:assert/strict";
import { test } from "node:test";
import { growthPlan } from "@storytree/forest-world/planet";
import shop from "./shop-snapshot.json" with { type: "json" };
import { createTour, flight, globeOf, groups, placeTags, readingTime, replayMoment, settle, spoken, type TourStep } from "./tour.js";
import { steps as tourSteps } from "./tour-copy.js";

const step = (id: string, explainer: TourStep["explainer"], lines = ["One two three four five six seven eight nine ten"]): TourStep => ({
  id, title: id, explainer, lines, decisions: [], surfaces: {},
});
const steps = [step("opening", "opening", ["First line", "Second line"]), step("story", "map"), step("comparison", "map"), step("agents", "agents")];
/** These tests time the clock at 1×; Act 2 itself starts at 0.75× (2.4). */
const atOne = (...args: Parameters<typeof createTour>) => { const tour = createTour(...args); tour.setSpeed(1); return tour; };
const whole = (s: TourStep) => s.lines.reduce((sum, line) => sum + readingTime(line), 0) + settle;

test("2.4 · readable lines, speed, pause and inspection holds control the same tour clock", () => {
  const tour = createTour(steps);
  assert.equal(tour.state.speed, .75, "Act 2 plays at 0.75× until the visitor changes it");
  tour.setSpeed(1);
  assert.equal(tour.state.lines, 1);
  tour.tick(readingTime("First line") - 1);
  assert.equal(tour.state.lines, 1);
  tour.tick(1);
  assert.equal(tour.state.lines, 2);
  tour.hold("reading"); tour.tick(60_000);
  assert.equal(tour.state.index, 0);
  tour.hold("everything"); tour.release("reading"); tour.tick(60_000);
  assert.equal(tour.state.index, 0);
  tour.release("everything"); tour.setSpeed(1.5);
  tour.tick((readingTime("Second line") + settle) / 1.5);
  assert.equal(tour.state.index, 1);
  assert.equal(readingTime("one two three four five six seven eight nine ten eleven twelve thirteen"), 5000);
  tour.setSpeed(.75); tour.tick(whole(steps[1]!) / .75 - 1);
  assert.equal(tour.state.index, 1);
  tour.tick(1); assert.equal(tour.state.index, 2);
  tour.next(); assert.equal(tour.state.index, 3);
  tour.previous(); assert.equal(tour.state.index, 2);
});

test("2.6 · skip reaches free play during every hold and replay returns with working controls", () => {
  const tour = atOne(steps);
  tour.togglePlay(); tour.hold("reading"); tour.hold("everything"); tour.hold("exploring"); tour.skip();
  assert.equal(tour.state.freePlay, true);
  assert.deepEqual(tour.state.holds, []);
  tour.tick(60_000); assert.equal(tour.state.index, 0);
  tour.replay();
  assert.equal(tour.running, true);
  assert.equal(tour.state.lines, 1);
  tour.tick(readingTime("First line")); assert.equal(tour.state.lines, 2);
});

test("2.7 · a waiting tour names every hold, and play clears them and continues the step where it stopped", () => {
  const tour = createTour(steps);
  tour.tick(readingTime("First line") / 2);
  const before = tour.progress();
  tour.hold("exploring");
  assert.equal(tour.running, false);
  assert.deepEqual(tour.state.holds, ["exploring"]);
  assert.equal(tour.state.lines, 2, "a waiting step shows all its lines so the visitor reads at their own pace");
  tour.tick(60_000);
  assert.equal(tour.progress(), before);
  tour.hold("reading");
  assert.deepEqual(tour.state.holds, ["exploring", "reading"]);
  tour.release("reading");
  assert.equal(tour.running, false, "one hold left still holds");
  tour.release("exploring");
  assert.equal(tour.running, true, "releasing the last hold resumes");
  assert.equal(tour.progress(), before);
  tour.togglePlay(); tour.hold("everything"); tour.release("everything");
  assert.deepEqual(tour.state.holds, ["paused"], "the visitor's pause outlasts the holds released after it");
  tour.hold("reading"); tour.togglePlay();
  assert.deepEqual(tour.state.holds, []);
  assert.equal(tour.state.index, 0);
  assert.equal(tour.progress(), before, "play continues the step; it never restarts it");
  tour.togglePlay(); tour.next();
  assert.deepEqual(tour.state.holds, ["paused"], "paused, the tour steps through by hand");
  assert.equal(tour.state.lines, steps[1]!.lines.length);
});

test("2.8 · the pips group steps by explainer, the current one fills as it plays, and any pip jumps to its step", () => {
  assert.deepEqual(groups(steps), [
    { explainer: "opening", steps: [0] }, { explainer: "map", steps: [1, 2] }, { explainer: "agents", steps: [3] },
  ]);
  const tour = atOne(steps);
  assert.equal(tour.progress(), 0);
  tour.tick(whole(steps[0]!) / 2);
  assert.equal(tour.progress(), .5);
  tour.togglePlay(); tour.tick(60_000);
  assert.equal(tour.progress(), .5, "the fill holds still while the tour waits");
  tour.togglePlay();
  tour.go(2);
  assert.equal(tour.state.index, 2);
  assert.equal(tour.state.lines, 1);
  assert.equal(tour.progress(), 0);
  tour.tick(whole(steps[2]!)); assert.equal(tour.state.index, 3);
});

test("2.11 · the arrival holds storytree's own globe at a point under the pain, grows it on the tour's clock, then shows it whole", () => {
  const arrival: TourStep[] = [
    { ...step("pain", "opening", ["One", "Two"]), map: "own", growth: "seed" },
    { ...step("grow", "opening", ["Three"]), map: "own", growth: { seconds: 12 } },
    { ...step("value", "opening", ["Four"]), map: "own" },
    step("stories", "map"),
  ];
  const tour = atOne(arrival);
  const globe = () => globeOf(arrival[tour.state.index]!, tour.state, tour.elapsed());
  assert.deepEqual(globe(), { map: "own", at: 0 }, "the pain is said before any globe: storytree's is still a point");
  tour.tick(whole(arrival[0]!));
  assert.equal(tour.state.index, 1);
  tour.tick(4000);
  assert.deepEqual(globe(), { map: "own", at: 4 });
  tour.togglePlay(); tour.tick(60_000);
  assert.deepEqual(globe(), { map: "own", at: 4 }, "pausing the tour pauses the growth");
  tour.togglePlay(); tour.setSpeed(1.5); tour.tick(2000);
  assert.deepEqual(globe(), { map: "own", at: 7 }, "a faster tour grows it faster");
  tour.tick((12_000 - 7000) / 1.5);
  assert.equal(tour.state.index, 1, "the step lasts as long as the growth, however short its words");
  assert.deepEqual(globe(), { map: "own", at: 12 });
  tour.tick(settle / 1.5 + 1);
  assert.equal(tour.state.index, 2);
  assert.deepEqual(globe(), { map: "own" }, "after the time-lapse storytree's globe is whole");
  tour.hold("everything");
  assert.deepEqual(globe(), { map: "storytree" });
});

test("2.10 · the time-lapse waits for its globe to be set up, then plays from its first frame", () => {
  const arrival: TourStep[] = [
    { ...step("pain", "opening", ["One"]), map: "own", growth: "seed" },
    { ...step("grow", "opening", ["Two"]), map: "own", growth: { seconds: 12 } },
  ];
  let ready = false;
  const tour = atOne(arrival, { ready: () => ready });
  tour.tick(10_000);
  assert.equal(tour.state.index, 0, "the pain beat waits for the globe it hides");
  tour.tick(10_000);
  assert.equal(tour.state.index, 0);
  ready = true;
  tour.tick(whole(arrival[0]!));
  assert.equal(tour.state.index, 1);
  assert.equal(tour.elapsed(), 0, "the growth starts from its first frame");
  tour.tick(3000);
  assert.deepEqual(globeOf(arrival[1]!, tour.state, tour.elapsed()), { map: "own", at: 3 });
});

test("2.12 · after the fixes, the map chapter opens on the shop's empty globe, swelling from a point, with no cut beat between", () => {
  const at = tourSteps.findIndex(item => item.id === "fixes");
  assert.ok(tourSteps.slice(0, at + 1).every(item => item.map === "own"), "the pain, the growth, the value and the fixes are all over storytree's own globe");
  const opening = tourSteps[at + 1]!;
  assert.equal(opening.explainer, "map", "the map chapter follows the fixes at once");
  const tour = atOne(tourSteps);
  tour.go(at + 1);
  assert.deepEqual(globeOf(opening, tour.state, tour.elapsed()), { map: "shop", at: 0 }, "the shop's globe, still a point");
  assert.ok(typeof opening.growth === "object" && !opening.growth.stage && opening.growth.until === "planned", "it swells until its stories are planned");
  const plan = { seconds: 30, stages: [{ id: "planned", start: 2 }, { id: "pr1-building", start: 6 }] };
  assert.equal(replayMoment(plan, opening.growth, 0), 0, "from the point");
  assert.equal(replayMoment(plan, opening.growth, opening.growth.seconds), 2, "to the empty globe, before any story rises");
  tour.hold("everything");
  assert.deepEqual(globeOf(opening, tour.state), { map: "storytree" }, "show everything still opens storytree's own globe");
});

test("2.13 · free play opens on the shop's whole globe, and the selector switches it to storytree's own project and back", () => {
  const tour = createTour(steps);
  tour.skip();
  assert.deepEqual(globeOf(steps[0]!, tour.state), { map: "shop" }, "the full shop, whole");
  tour.choose("storytree");
  assert.deepEqual(globeOf(steps[0]!, tour.state), { map: "storytree" }, "storytree's own saved project");
  assert.equal(tour.state.freePlay, true, "choosing a project stays in free play");
  tour.choose("shop");
  assert.deepEqual(globeOf(steps[0]!, tour.state), { map: "shop" });
  tour.choose("storytree"); tour.replay();
  assert.deepEqual(globeOf(steps[0]!, tour.state), { map: "storytree" }, "the tour itself is not the selector's");
  tour.skip();
  assert.deepEqual(globeOf(steps[0]!, tour.state), { map: "storytree" }, "the choice lasts as long as the page");
});

test("2.15 · between two close steps the camera stays in and turns the globe; it pulls back only when the next step is the wide view", () => {
  const cart = { kind: "story", story: "cart" } as const, checkout = { kind: "story", story: "checkout" } as const;
  const widest = (legs: { framing: number }[]) => Math.max(...legs.map(leg => leg.framing));
  const close = flight({ target: cart, framing: .55 }, { target: checkout, framing: .72 });
  assert.equal(close.length, 1, "one flight that turns the globe and settles, never out and in again");
  assert.ok(widest(close) <= .72, "it never pulls back wider than either close view");
  const out = flight({ target: cart, framing: .55 }, { target: checkout, framing: 1.1 });
  assert.deepEqual(out.map(leg => leg.framing), [1.1], "to the wide view it pulls back as it turns");
  assert.ok(close.concat(out).every(leg => leg.ms > 0));
});

test("2.16 · the map chapter grows the shop in the order it was recorded, then teaches on its four stories and replays one stage of its growth", () => {
  const plan = { seconds: 30, stages: [{ id: "planned", start: 2 }, { id: "pr5", start: 10 }, { id: "pr6-building", start: 14 }, { id: "pr6", start: 20 }] };
  assert.equal(replayMoment(plan, { seconds: 8, stage: "pr6-building" }, 0), 14, "it opens where the stage begins: the globe as it stood before");
  assert.equal(replayMoment(plan, { seconds: 8, stage: "pr6-building" }, 4), 17);
  assert.equal(replayMoment(plan, { seconds: 8, stage: "pr6-building" }, 8), 20, "it ends where the next stage begins");
  assert.equal(replayMoment(plan, { seconds: 8, stage: "pr6" }, 8), 30, "the last stage runs to the growth's end");
  assert.equal(replayMoment(plan, { seconds: 15 }, 7.5), 15, "a whole replay spans the whole growth");
  assert.equal(replayMoment(plan, { seconds: 8, stage: "planned", until: "pr6-building" }, 8), 14, "several stages, up to where the named one begins");
  const chapter = tourSteps.filter(item => item.explainer === "map");
  assert.ok(chapter.every(item => item.map === "shop"), "the map chapter is taught on the shop");
  const titles = shop.titles as Record<string, string>;
  type Stage = { id: string; at: string; scene: { islands: { story: string; land?: { files: unknown[] } }[] } };
  const stages = shop.stages as Stage[];
  const index = (id: string) => stages.findIndex(stage => stage.id === id);
  const files = (stage: Stage) => Object.fromEntries(stage.scene.islands.map(island => [titles[island.story], island.land?.files.length ?? 0]));
  /** What a step's replay grows, read from the shop's recorded stages: the stories that rise and the stories whose land grows. */
  const grows = (step: TourStep) => {
    assert.ok(typeof step.growth === "object", `${step.id} replays the shop's growth`);
    const growth = step.growth as { stage?: string; until?: string };
    const from = growth.stage ? index(growth.stage) : 0, to = growth.until ? index(growth.until) : from + 1;
    const before = from > 0 ? stages[from - 1]! : { scene: { islands: [] } } as unknown as Stage, after = stages[to - 1]!;
    const was = files(before), now = files(after);
    return { risen: Object.keys(now).filter(title => !(title in was)), built: Object.keys(now).filter(title => now[title]! > (was[title] ?? 0)) };
  };
  const [empty, planned, first, together] = chapter;
  assert.deepEqual(grows(empty!), { risen: [], built: [] }, "M0: the empty globe");
  assert.deepEqual(grows(planned!), { risen: ["Signing in", "Browsing", "Cart", "Checkout"], built: [] }, "M1: the four stories, planned together");
  assert.equal(grows(first!).built[0], "Signing in", "M2: signing in is built first");
  assert.deepEqual(first!.focus?.map(id => titles[id]), ["Signing in"]);
  assert.deepEqual(grows(together!), { risen: [], built: ["Browsing", "Cart", "Checkout"] }, "M3: the other three, together");
  assert.deepEqual(together!.focus?.map(id => titles[id]), ["Browsing", "Cart", "Checkout"]);
  // Then the shop's four stories as they stood once built, before its second round, and that round growing on.
  const walk = chapter.slice(4, -1);
  assert.ok(walk.length >= 3 && walk.every(item => item.recorded), "the parts, the code and the colours hold the shop at a recorded moment");
  for (const item of walk) {
    const stood = stages.filter(stage => stage.at <= item.recorded!).at(-1)!;
    assert.equal(stood.id, "pr4", `${item.id}: the shop once its first four stories were built`);
    assert.deepEqual(item.focus?.map(id => titles[id]), ["Signing in", "Browsing", "Cart", "Checkout"]);
  }
  const grow = chapter.at(-1)!;
  const at = index((grow.growth as { stage: string }).stage);
  const added = stages[at]!.scene.islands.filter(island => !stages[at - 1]!.scene.islands.some(before => before.story === island.story)).map(island => titles[island.story]);
  assert.ok(added.includes("Orders"), `that stage adds Orders, the story shown growing on: ${added}`);
  assert.deepEqual(grow.focus?.map(id => titles[id]), ["Signing in", "Browsing", "Cart", "Checkout", "Orders"]);
  assert.ok(grow.compare && grow.compare.sources.some(Boolean), "the comparison is offered on the last step");
});

test("2.16 · as the narration names each planned story, that story lights, and a waiting step shows every story it has named", () => {
  const story = (id: string) => ({ kind: "story", story: id }) as const;
  const named: TourStep = { ...step("planned", "map", ["Let's build a shop.", "It starts with signing in, then the cart."]), map: "shop",
    names: [{ said: "signing in", story: "in" }, { said: "the cart", story: "cart" }], target: story("in") };
  const tour = atOne([named, step("next", "map")]);
  const focus = () => (globeOf(named, tour.state, tour.elapsed()) as { focus?: readonly string[] }).focus;
  assert.equal(focus(), undefined, "before a story is named, none is dimmed");
  const second = readingTime("Let's build a shop.");
  tour.tick(second + spoken("It starts with") - 1);
  assert.equal(focus(), undefined);
  tour.tick(2);
  assert.deepEqual(focus(), ["in"], "signing in lights as it is said");
  tour.tick(spoken("signing in, then") + 1);
  assert.deepEqual(focus(), ["in", "cart"]);
  tour.go(0); tour.togglePlay();
  assert.deepEqual(focus(), ["in", "cart"], "paused, the step shows whole, every story it names lit");
});

test("2.18 · on a phone and on a laptop, each tag's name sits inside the screen, clear of the other tags and rings, the card and the panels", () => {
  // The agents chapter's parallel step at 320: three rings close together, a sessions list above and the card below.
  const room = { width: 320, height: 560 };
  const tags = [{ x: 142, y: 262, width: 115, height: 25 }, { x: 175, y: 262, width: 185, height: 25 }, { x: 145, y: 195, width: 115, height: 25 }];
  const keepOut = [{ x: 10, y: 84, width: 300, height: 86 }, { x: 10, y: 340, width: 300, height: 200 }];
  const placed = placeTags(tags, room, { keepOut, sides: ["right", "left", "below", "above"] });
  const boxes = placed.map((at, index) => ({ x: tags[index]!.x + at.x, y: tags[index]!.y + at.y, width: tags[index]!.width, height: tags[index]!.height }));
  const rings = tags.map(tag => ({ x: tag.x - 17, y: tag.y - 17, width: 34, height: 34 }));
  const meets = (a: typeof boxes[number], b: typeof boxes[number]) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  boxes.forEach((box, index) => {
    assert.ok(box.x >= 8 && box.y >= 8 && box.x + box.width <= room.width - 8 && box.y + box.height <= room.height - 8, `tag ${index} is inside the screen: ${JSON.stringify(box)}`);
    for (const [other, ring] of rings.entries()) assert.ok(!meets(box, ring), `tag ${index} is clear of ring ${other}`);
    for (const [other, label] of boxes.entries()) if (other !== index) assert.ok(!meets(box, label), `tag ${index} is clear of tag ${other}`);
    for (const panel of keepOut) assert.ok(!meets(box, panel), `tag ${index} is clear of ${JSON.stringify(panel)}`);
  });
  // A laptop: the name to the right of its ring, or to the left where the right has no room. A ring between pixels (as
  // the globe drifts) is still clear on the right: the claim step's cart at 1280 once went left by a rounding error.
  const wide = { width: 1440, height: 900 };
  assert.equal(placeTags([{ x: 900, y: 400, width: 160, height: 25 }], wide)[0]!.side, "right");
  assert.equal(placeTags([{ x: 1350, y: 400, width: 160, height: 25 }], wide)[0]!.side, "left");
  assert.equal(placeTags([{ x: 896.0133401209908, y: 598.6357908097438, width: 187, height: 24 }], { width: 1280, height: 800 }, { share: true })[0]!.side, "right");
});

test("2.18 · on a phone, a tag beside its ring slides a little up or down to read clear of an island's name", () => {
  // The parallel step at 390×844 reached from the claim step: Part 2's tag, centred beside Browsing's ring, touched the top
  // of Browsing's own name by half a pixel; above, below and to the left have no room.
  const room = { width: 390, height: 844 };
  const tags = [{ x: 95, y: 376, width: 228.47, height: 24.125 }, { x: 68, y: 330, width: 216, height: 24.125 }, { x: 88, y: 271, width: 121, height: 24.125 }];
  const names = [{ x: 55.12, y: 387.63, width: 78.59, height: 18.28 }, { x: 45, y: 342, width: 46, height: 18.28 }, { x: 48, y: 290, width: 80, height: 18.28 }];
  const panels = [{ x: 10, y: 84, width: 370, height: 135 }, { x: 10, y: 409, width: 370, height: 289 }];
  const placed = placeTags(tags, room, { keepOut: [...names.map(name => ({ ...name, soft: true })), ...panels], sides: ["right", "left", "below", "above"] });
  const boxes = placed.map((at, index) => ({ x: tags[index]!.x + Math.round(at.x), y: tags[index]!.y + Math.round(at.y), width: tags[index]!.width, height: tags[index]!.height }));
  const meets = (a: typeof boxes[number], b: typeof boxes[number]) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  boxes.forEach((box, index) => {
    for (const name of names) assert.ok(!meets(box, name), `tag ${index} is clear of the name ${JSON.stringify(name)}: ${JSON.stringify(box)}`);
    for (const panel of panels) assert.ok(!meets(box, panel), `tag ${index} is clear of ${JSON.stringify(panel)}`);
    for (const [other, label] of boxes.entries()) if (other !== index) assert.ok(!meets(box, label), `tag ${index} is clear of tag ${other}`);
  });
});

test("2.18 · on a laptop, where the first-come sides leave a tag over a panel, the tags share the room so each reads clear", () => {
  // The parallel step at 1280×800 reached from the claim step: Browsing and the cart sit on the sessions list's top edge.
  // Part 2 taking the room above its ring left Part 3 none; Part 2 to the left (over an island's name) frees it.
  const room = { width: 1280, height: 800 };
  const tags = [{ x: 799.27, y: 579.33, width: 120, height: 24 }, { x: 891.82, y: 579.72, width: 187, height: 24 }, { x: 852, y: 400, width: 121, height: 24 }];
  const names = [[847, 743, 83, 18], [760, 610, 79, 18], [856, 625, 71, 18], [812, 421, 80, 18], [957, 616, 78, 18], [914, 434, 62, 18], [783, 246, 112, 33], [901, 260, 70, 18]];
  const panels = [{ x: 24, y: 476, width: 400, height: 248 }, { x: 440, y: 591, width: 824, height: 137 }];
  const keepOut = [...names.map(([x, y, width, height]) => ({ x: x!, y: y!, width: width!, height: height!, soft: true })), ...panels];
  const placed = placeTags(tags, room, { keepOut, sides: ["right", "left", "below", "above"], share: true });
  const boxes = placed.map((at, index) => ({ x: tags[index]!.x + at.x, y: tags[index]!.y + at.y, width: tags[index]!.width, height: tags[index]!.height }));
  const rings = tags.map(tag => ({ x: tag.x - 17, y: tag.y - 17, width: 34, height: 34 }));
  const meets = (a: typeof boxes[number], b: typeof boxes[number]) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  boxes.forEach((box, index) => {
    for (const [other, ring] of rings.entries()) if (other !== index) assert.ok(!meets(box, ring), `tag ${index} is clear of ring ${other}`);
    for (const [other, label] of boxes.entries()) if (other !== index) assert.ok(!meets(box, label), `tag ${index} is clear of tag ${other}`);
    for (const panel of panels) assert.ok(!meets(box, panel), `tag ${index} is clear of ${JSON.stringify(panel)}: ${JSON.stringify(box)}`);
  });
});


test("2.16 · every stage a map step replays from or to is one the shop's replay draws, so no step falls back to the empty globe", () => {
  // The replay skips a recorded stage that changes nothing on the globe, and a step naming one would start from the beginning.
  // Planned as the site plans it (forest-scene's recordedGrowth): a stage whose sessions changed holds a beat.
  type Stage = { id: string; at: string; scene: unknown; wisps: { session: string; story: string }[] };
  const recorded = shop.stages as unknown as Stage[];
  const sessions = (index: number) => JSON.stringify(recorded[index]?.wisps.map(wisp => [wisp.session, wisp.story]) ?? []);
  const stages = recorded.map(({ id, at, scene }, index) => ({ id, at, scene, ...(sessions(index) !== sessions(index - 1) ? { hold: 1 } : {}) }));
  const drawn = new Set(growthPlan(stages as never, { fromPoint: true, seconds: 15, until: recorded.at(-1)!.at }).stages.map(stage => stage.id));
  const named = tourSteps.flatMap(item => typeof item.growth === "object" && item.map === "shop" ? [item.growth.stage, item.growth.until].filter((id): id is string => id !== undefined).map(id => [item.id, id]) : []);
  assert.ok(named.length >= 4);
  assert.deepEqual(named.filter(([, id]) => !drawn.has(id!)), []);
});

test("2.16 · the shop the map chapter teaches on was rebuilt with storytree's guardrails: no stage of its growth has code no part's tests reach, so no step shows hatched ground", () => {
  // ADR-0911 D5: the shop was rebuilt with storytree check in its CI and the landing hold in its agents' link (shop3, 2026-10-05).
  type Island = { story: string; land?: { territories: { capability?: string; lines: number }[] } };
  const stages = shop.stages as { id: string; scene: { islands: Island[] } }[];
  const hatched = stages.flatMap(stage => stage.scene.islands.filter(island => island.land?.territories.some(part => !part.capability && part.lines > 0)).map(island => `${stage.id}: ${(shop.titles as Record<string, string>)[island.story]}`));
  assert.deepEqual(hatched, []);
});
