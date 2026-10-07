import assert from "node:assert/strict";
import { test } from "node:test";
import { mapRecording, mapGrowthPlan, recordedScene } from "./map-recording.js";
import type { GrowthSnapshot } from "./forest-data.js";
import shop from "./shop-snapshot.json" with { type: "json" };
import { aim, createTour, flight, globeOf, groups, placeTags, readingTime, replayMoment, settle, type TourStep } from "./tour.js";
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
  assert.deepEqual(globeOf(opening, tour.state, tour.elapsed()), { map: "shop", at: 0, focus: [] }, "the shop's globe, still a point");
  assert.ok(typeof opening.growth === "object" && !opening.growth.stage && opening.growth.until === "pr1-building", "it swells until its stories are planned");
  const plan = { seconds: 30, stages: [{ id: "planned", start: 2 }, { id: "pr1-building", start: 6 }] };
  assert.equal(replayMoment(plan, opening.growth, 0), 0, "from the point");
  assert.equal(replayMoment(plan, opening.growth, opening.growth.seconds), 6, "to the four faint planned stories, before building begins");
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

test("2.15 · a step's view is reached even when its island is drawn after the step begins", () => {
  const checkout = { kind: "story", story: "checkout" } as const, overview = { kind: "core" } as const;
  let drawn = false, waiting: (() => void) | undefined;
  const aimed: string[] = [];
  const place = (target: { kind: string }) => { aimed.push(target.kind); return drawn; };
  aim(place, checkout, overview, again => { waiting = again; });
  assert.ok(waiting, "an island not yet drawn is aimed at again on a later beat, not left at the last step's turn");
  drawn = true; waiting!(); waiting = undefined; aimed.length = 0;
  aim(place, checkout, overview, again => { waiting = again; });
  assert.equal(waiting, undefined, "once it is drawn the camera stops trying");
  assert.deepEqual(aimed, ["story"]);
  let tries = 0; drawn = false;
  const retry = (again: () => void) => { tries++; again(); };
  aim(place, checkout, overview, retry);
  assert.ok(tries > 0 && tries <= 100, "an island that never comes is given up on");
});

test("2.16 · the map chapter plays the four approved steps on the shop's recorded build", () => {
  const chapter = tourSteps.filter(item => item.explainer === "map");
  assert.deepEqual(chapter.map(item => item.lines), [
    ["Let's start from the beginning and build a shopping site, so you can see how storytree draws a map as your agents build."],
    ["As your agents build your project, each of its stories shows up on the map as an island.",
      "Look inside a story and you'll find it's broken up into capabilities, the pieces that make it work.",
      "Your code is glued to its capability: each dot is a file.",
      "Select a story and a panel shows how its capabilities work together."],
    ["Stories are like the organs of your app: each plays its role, and many can't work without others.",
      "These dependencies are shown as pathways.",
      "Browsing, the cart and checkout all need signing in. With it built, three agents can build them at once."],
    ["As your automated tests run in CI, storytree shows you which capabilities are healthy and which need your attention.",
      "Yellow means nothing has proved it yet; green means its tests passed."],
  ]);
  assert.ok(chapter.every(item => item.map === "shop"));
  const [empty, first, together, health] = chapter;
  assert.equal((empty!.growth as { until: string }).until, "pr1-building", "the four faint planned stories finish the first step");
  assert.deepEqual(empty!.focus, [], "all four are faint");
  assert.equal((first!.growth as { stage: string }).stage, "pr1-building");
  assert.equal((first!.growth as { until: string }).until, "pr2-building");
  assert.deepEqual(first!.target, { kind: "story", story: "story_d263ef0f3f72" });
  assert.equal(first!.panel, "story");
  assert.equal(first!.panelFromLine, 4, "the panel opens after the capability growth and the file dots");
  assert.equal(first!.lineSurfaces?.[3]?.fileCircles, true);
  assert.deepEqual(together!.focus, ["story_d263ef0f3f72", "story_0c07d0047754", "story_2de9e8f4db21", "story_66f80ffaaa4d"]);
  assert.equal((together!.growth as { stage: string }).stage, "pr3-building");
  assert.equal((together!.growth as { until: string }).until, "pr4");
  assert.equal(together!.lineSurfaces?.[2]?.roads, true);
  assert.equal((health!.growth as { stage: string }).stage, "pr4");
  assert.equal(health!.surfaces.territories, "health");
  assert.ok(health!.compare?.sources.some(Boolean));
  for (const item of chapter) assert.ok(item.how && item.why && item.decisions.length === 0);
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


test("2.16 · the map replays capability landings and recorded health without later code or islands leaking in", () => {
  const original = shop as unknown as GrowthSnapshot;
  const recording = mapRecording(original);
  const plan = mapGrowthPlan(recording);
  const at = (id: string) => { const stage = plan.stages.find(stage => stage.id === id); assert.ok(stage, id); return stage.start; };
  const missing = tourSteps.filter(step => step.explainer === "map").flatMap(step => typeof step.growth !== "object" ? [] : [step.growth.stage, step.growth.until].filter(id => id && !plan.stages.some(stage => stage.id === id)));
  assert.deepEqual(missing, []);
  const signIn = "story_d263ef0f3f72", checkout = "story_66f80ffaaa4d", browsing = "story_0c07d0047754";
  const landings = original.reading!.recording.lines.filter(line => line.kind === "landed" && line.at < "2026-10-05T02:01:00.000Z" && "capability" in line);
  const files = (id: string) => recordedScene(recording, plan, at(id)).islands.find(island => island.story === signIn)?.land?.files.length ?? 0;
  assert.equal(files("pr1-building"), 0);
  assert.ok(recording.stages.every(stage => stage.scene.islands.every(island => !island.land || island.land.territories.length > 0)), "unbuilt islands have no land yet");
  assert.ok(files("land-capability_323895c5a414") > 0);
  assert.ok(files("land-capability_678463042156") > files("land-capability_323895c5a414"));
  assert.equal(files("pr1"), 8);
  for (const line of landings) {
    const id = (line as { capability: string }).capability;
    if (!recording.stages.some(stage => stage.id === `land-${id}`)) continue;
    assert.equal(plan.capabilities.get(id)?.start, at(`land-${id}`), "territories fill when their agent lands them, not when planned");
  }
  const status = (stage: string, story: string) => recordedScene(recording, plan, at(stage)).islands.find(island => island.story === story)!.land!.territories.map(cap => cap.status);
  assert.ok(status("pr4", checkout).every(status => status === "untested"));
  assert.ok(status("pr7-building", checkout).every(status => status === "healthy"));
  assert.ok(status("pr4", browsing).every(status => status === "healthy"), "Browsing's recorded green is drawn at 02:46, without its later capabilities");
  assert.equal(recordedScene(recording, plan, 0).islands.length, 4, "planned islands are mounted for the opening camera; the growth clock keeps them invisible until planned");
  assert.ok([...plan.islands.values()].every(window => window.start > 0));
  assert.equal(recording.scene.islands.length, 4);
  assert.ok(recording.stages.every(stage => stage.scene.islands.length <= 4));
  assert.equal(original.scene.islands.length, 8, "free play and the other chapters keep the saved recording");
});
