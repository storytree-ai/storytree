import assert from "node:assert/strict";
import { test } from "node:test";
import { mapRecording, mapGrowthPlan, recordedFrame } from "./map-recording.js";
import type { GrowthSnapshot } from "./forest-data.js";
import shop from "./shop-snapshot.json" with { type: "json" };
import { aim, createTour, flight, globeOf, groups, lineStarts, placeTags, readingTime, replayMoment, settle, viewOf, type TourStep } from "./tour.js";
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
  assert.ok(typeof opening.growth === "object" && !opening.growth.stage && opening.growth.until === "planned", "it swells until its first story is planned");
  const plan = { seconds: 30, stages: [{ id: "planned", start: 2 }, { id: "pr1-building", start: 6 }] };
  assert.equal(replayMoment(plan, opening.growth, 0), 0, "from the point");
  const end = replayMoment(plan, opening.growth, opening.growth.seconds);
  assert.ok(end < 2 && end > 1.99, "to just before the first story is planned: no island shows on the empty globe");
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

test("2.16 · the map chapter plays the six approved steps on the shop's recorded build", () => {
  const chapter = tourSteps.filter(item => item.explainer === "map");
  assert.deepEqual(chapter.map(item => item.lines), [
    ["Let's start from the beginning and build a shopping site, so you can see how storytree draws a map as your agents build."],
    ["As your agents build your project, each of its stories shows up on the map as an island.",
      "Look inside a story and you'll find it's broken up into capabilities, the pieces that make it work.",
      "It starts as one. Each time your agent builds another capability, the island splits to make room for it."],
    ["Your code is glued to its capability: each dot is a file.",
      "Select a story and a panel shows how its capabilities work together."],
    ["Stories are like the organs of your app: each plays its role, and many can't work without others.",
      "These dependencies are shown as pathways.",
      "Browsing, the cart and checkout all need signing in. With it built, three agents can build them at once."],
    ["As your automated tests run in CI, storytree shows you which capabilities are healthy and which need your attention.",
      "Yellow means nothing has proved it yet; green means its tests passed."],
    ["Before an agent writes, its session claims the capability it's working on, so no two agents change the same thing.",
      "Here the shop is growing, and the agent adding orders needs to change checkout and the cart. Its claims show on both.",
      "Storytree lists your conversations with AI here as active sessions."],
  ]);
  assert.ok(chapter.every(item => item.map === "shop"));
  const [empty, first, code, together, health, claims] = chapter;
  const moments = chapter.map(item => typeof item.growth === "object" ? [item.growth.stage, item.growth.until] : item.growth);
  assert.deepEqual(moments, [[undefined, "planned"], ["planned", "pr1"], ["pr1", "pr1"], ["pr3-building", "pr4"], ["pr4", "pr7-building"], ["pr7-building", "pr9"]]);
  // Signing in rises with the first line, and its capabilities split it in time with the third.
  assert.deepEqual((first!.growth as { beats: unknown }).beats, [{ line: 2, stage: "pr1-building" }, { line: 3, stage: "pr1-building" }]);
  // Nothing in steps 2 and 3 reads as a claim: no session tints (their outlines and rings), no focus ring.
  for (const item of [empty, first, code]) assert.ok(!item!.surfaces.sessionTints && !item!.focus && !Object.values(item!.lineSurfaces ?? {}).some(next => next.sessionTints), item!.id);
  assert.equal(code!.lineSurfaces?.[1]?.fileCircles ?? code!.surfaces.fileCircles, true, "the dots appear with the first line");
  assert.equal(code!.panel, "story");
  assert.equal(code!.panelFromLine, 2, "the story panel opens with the second line");
  assert.equal(together!.lineSurfaces?.[2]?.roads, true, "pathways come on with the second line");
  assert.equal(health!.surfaces.territories, "health");
  assert.ok(claims!.surfaces.sessionTints, "the Orders session's outlines draw");
  assert.equal(claims!.panel, "sessions");
  assert.equal(claims!.panelFromLine, 3, "the sessions list opens on the third line");
  assert.equal(claims!.sessionsAt?.slice(0, 16), "2026-10-05T03:09", "the list reads the three sessions live at 03:09");
  assert.ok(claims!.compare?.sources.some(Boolean), "the comparison with other tools closes the chapter");
  assert.ok(!health!.compare);
  for (const item of chapter) assert.ok(item.how && item.why && item.decisions.length === 0);
  assert.match(claims!.how!, /code on the map/);
});

test("2.16 · across the map chapter the camera moves only on the line that says why, never at a step change", () => {
  const chapter = tourSteps.filter(item => item.explainer === "map");
  for (const wide of [true, false]) {
    const moves: string[] = [];
    let before: string | undefined;
    for (const item of chapter) item.lines.forEach((_, index) => {
      const view = JSON.stringify(viewOf(item, index + 1, wide));
      if (before !== undefined && view !== before) moves.push(`${item.id}:${index + 1}`);
      before = view;
    });
    // A phone also eases in on the cart as the claims step's second line names it and checkout: its whole shop is too small.
    assert.deepEqual(moves, ["map-first:2", "map-together:1", ...(wide ? [] : ["map-claims:2"])], wide ? "laptop" : "phone");
  }
  const first = chapter[1]!;
  assert.notDeepEqual(viewOf(first, 1, true), viewOf(first, 2, true), "it eases in on \"Look inside a story\"");
  assert.deepEqual(viewOf(first, 1, true), viewOf(chapter[0]!, 1, true), "the second step opens on the first's view");
});

test("2.16 · a replay can hold a stage until a line begins, and stops short of the stage it runs until", () => {
  const plan = { seconds: 30, stages: [{ id: "planned", start: 2 }, { id: "building", start: 4 }, { id: "land", start: 6 }, { id: "merged", start: 10 }] };
  const growth = { seconds: 20, stage: "planned", until: "merged", beats: [{ line: 2, stage: "building" }, { line: 3, stage: "building" }] };
  const starts = [0, 5, 12];
  assert.equal(replayMoment(plan, growth, 0, starts), 2);
  assert.equal(replayMoment(plan, growth, 2.5, starts), 3, "towards the first beat");
  assert.equal(replayMoment(plan, growth, 5, starts), 4);
  assert.equal(replayMoment(plan, growth, 9, starts), 4, "held until the third line begins");
  assert.ok(Math.abs(replayMoment(plan, growth, 16, starts) - 7) < .01, "then on to the end");
  const end = replayMoment(plan, growth, 20, starts);
  assert.ok(end < 10 && end > 9.99, "short of the stage it runs until");
  assert.equal(replayMoment(plan, { seconds: 1, stage: "merged", until: "merged" }, 1), 10, "a stage until itself stands still");
  assert.deepEqual(lineStarts({ ...step("s", "map"), lines: ["one", "two words"] }), [0, readingTime("one") / 1000]);
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

test("2.18 · phone tags clear the taller progress labels on unsurveyed islands", () => {
  for (const width of [390, 320]) {
    const shift = (390 - width) / 2;
    const tags = [{ x: 94 - shift, y: 366, width: 229, height: 25 }, { x: 69 - shift, y: 322, width: 216, height: 25 }, { x: 88 - shift, y: 265, width: 121, height: 25 }];
    const names = [{ x: 55 - shift, y: 374, width: 79, height: 19 }, { x: 30 - shift, y: 336, width: 76, height: 39 }, { x: 48 - shift, y: 285, width: 80, height: 39 }];
    const panels = [{ x: 10, y: 84, width: width - 20, height: 135 }, { x: 10, y: 409, width: width - 20, height: 289 }];
    const placed = placeTags(tags, { width, height: 844 }, { keepOut: [...names, ...panels], sides: ["right", "left", "below", "above"] });
    const boxes = placed.map((at, i) => ({ ...tags[i]!, x: tags[i]!.x + Math.round(at.x), y: tags[i]!.y + Math.round(at.y) }));
    const rings = tags.map(tag => ({ x: tag.x - 17, y: tag.y - 17, width: 34, height: 34 }));
    boxes.forEach((box, i) => {
      assert.ok(box.x >= 0 && box.x + box.width <= width);
      for (const other of [...names, ...panels, ...boxes.filter((_, j) => j !== i), ...rings.filter((_, j) => j !== i)])
        assert.ok(box.x + box.width <= other.x || other.x + other.width <= box.x || box.y + box.height <= other.y || other.y + other.height <= box.y, `${width}: tag ${i} clears ${JSON.stringify(other)}`);
    });
  }
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


test("2.16 · the map replays capability landings, claims and health from the same recorded stage", () => {
  const original = shop as unknown as GrowthSnapshot;
  const recording = mapRecording(original);
  const plan = mapGrowthPlan(recording);
  const at = (id: string) => { const stage = plan.stages.find(stage => stage.id === id); assert.ok(stage, id); return stage.start; };
  const missing = tourSteps.filter(step => step.explainer === "map").flatMap(step => typeof step.growth !== "object" ? [] : [step.growth.stage, step.growth.until, ...(step.growth.beats ?? []).map(beat => beat.stage)].filter(id => id && !plan.stages.some(stage => stage.id === id)));
  assert.deepEqual(missing, []);
  const signIn = "story_d263ef0f3f72", browsing = "story_0c07d0047754", cart = "story_2de9e8f4db21", checkout = "story_66f80ffaaa4d";
  const frame = (when: number) => recordedFrame(recording, plan, when);
  const stories = (when: number) => frame(when).scene.islands.map(island => island.story).sort();
  const files = (id: string) => frame(at(id)).scene.islands.find(island => island.story === signIn)?.land?.files.length ?? 0;
  // Steps 1 to 3: signing in alone, its capabilities landing in their recorded order (the shop server first, 01:56).
  for (const id of ["planned", "pr1-building", "pr1"]) assert.deepEqual(stories(at(id)), [signIn], `${id}: only signing in is on the map`);
  const landed = plan.stages.filter(stage => stage.id.startsWith("land-")).map(stage => stage.id.slice(5));
  assert.equal(landed[0], "capability_323895c5a414");
  assert.deepEqual(landed, ["capability_323895c5a414", "capability_678463042156", "capability_ae20917d7a32"], "only the landings that change signing in's land take a beat");
  assert.equal(files("pr1-building"), 0);
  assert.ok(files("land-capability_678463042156") > files("land-capability_323895c5a414"));
  assert.equal(files("pr1"), 8);
  for (const id of landed) assert.equal(plan.capabilities.get(id)?.start, at(`land-${id}`), "territories fill when their agent lands them, not when planned");
  // Its code reached the map when its pull request merged, after its claims were released: no outline while it fills.
  const outlines = (when: number) => {
    const shown = frame(when);
    const surveyed = new Set(shown.scene.islands.flatMap(island => island.land?.territories.map(part => part.capability) ?? []));
    return shown.wisps.flatMap(wisp => wisp.capabilities.filter(capability => surveyed.has(capability)).map(capability => `${wisp.colour} ${capability}`));
  };
  for (const id of ["pr1-building", ...landed.map(id => `land-${id}`), "pr1"]) assert.deepEqual(outlines(at(id)), [], `${id}: no claim draws on signing in`);
  // Steps 4 and 5: the first round, then checkout's recorded green before the second round rises.
  assert.deepEqual(stories(at("pr3-building")), [signIn, browsing, cart, checkout].sort());
  assert.ok(plan.islands.get(browsing)!.start >= at("pr3-building"), "browsing, the cart and checkout grow in step 4");
  const status = (when: number, story: string) => frame(when).scene.islands.find(island => island.story === story)!.land!.territories.map(cap => cap.status);
  assert.ok(status(at("pr4"), checkout).every(status => status === "untested"));
  const checked = at("pr7-building") - .001;
  assert.ok(status(checked, checkout).every(status => status === "healthy"), "health turns green before the step ends");
  assert.deepEqual(stories(checked), [signIn, browsing, cart, checkout].sort(), "the second round is not on the map yet");
  assert.deepEqual(outlines(checked), []);
  // Step 6: the second round's four planned stories, and the Orders session's two surveyed claims until its merge.
  assert.equal(stories(at("pr7-building")).length, 8);
  const orders = ["hsl(193, 80%, 68%) capability_276fa436dc33", "hsl(193, 80%, 68%) capability_668ca101a358"];
  for (const id of ["pr7-building", "pr9-building", "pr8-building", "pr7"]) assert.deepEqual(outlines(at(id)).sort(), orders, `${id}: Order overview and Side menu`);
  assert.deepEqual(outlines(at("pr9")), [], "released when its pull request merges");
  assert.equal(recordedFrame(recording, plan, 0).scene.islands.length, 1, "signing in is mounted for the opening camera; the growth clock keeps it invisible until planned");
  assert.ok([...plan.islands.values()].every(window => window.start > 0));
  assert.equal(original.scene.islands.length, 8, "free play and the other chapters keep the saved recording");
});
