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

test("2.16 · the map chapter plays the five approved steps on the shop's recorded build", () => {
  const chapter = tourSteps.filter(item => item.explainer === "map");
  assert.deepEqual(chapter.map(item => item.lines), [
    ["Let's start from the beginning and build a shopping site, so you can see how storytree draws a map as your agents build."],
    ["As your agents build your project, each of its stories shows up on the map as an island.",
      "Look inside a story and you'll find it's broken up into capabilities, the pieces that make it work.",
      "Before an agent writes, its session claims the capability it's working on, so no two agents change the same thing.",
      "Storytree lists your conversations with AI here as active sessions."],
    ["It starts as one. Each time your agent builds another capability, the island splits to make room for it.",
      "Your code is glued to its capability: each dot is a file.",
      "Select a story and a panel shows how its capabilities work together."],
    ["Stories are like the organs of your app: each plays its role, and many can't work without others.",
      "These dependencies are shown as pathways.",
      "Browsing, the cart and checkout all need signing in. With it built, three agents can build them at once."],
    ["As your automated tests run in CI, storytree shows you which capabilities are healthy and which need your attention.",
      "Yellow means nothing has proved it yet; green means its tests passed."],
  ]);
  assert.ok(chapter.every(item => item.map === "shop"));
  const [empty, first, code, together, health] = chapter;
  const shopServer = "capability_323895c5a414", session = "capability_678463042156", signOut = "capability_918e1fa754ab";
  const moments = chapter.map(item => typeof item.growth === "object" ? [item.growth.stage, item.growth.until] : item.growth);
  assert.deepEqual(moments, [[undefined, "planned"], ["planned", `lifted-${signOut}`], [`land-${shopServer}`, "pr1"], ["pr3-building", "pr4"], ["pr4", "pr7-building"]]);
  // Signing in rises with the first line; its first flag drops with the second, the flag moves through its lots on the third,
  // and stands in sign-out's while the sessions list is open on the fourth.
  assert.deepEqual((first!.growth as { beats: unknown }).beats, [{ line: 2, stage: `staked-${shopServer}` }, { line: 3, stage: `staked-${session}` }, { line: 4, stage: `staked-${signOut}` }]);
  const tinted = (item: TourStep, line: number) => { let shown = item.surfaces; for (const [from, next] of Object.entries(item.lineSurfaces ?? {})) if (line >= Number(from)) shown = next; return shown.sessionTints === true; };
  assert.deepEqual(first!.lines.map((_, index) => tinted(first!, index + 1)), [false, true, true, true], "signing in appears plain; its flags draw from the second line");
  assert.ok(!tinted(empty!, 1) && !first!.focus && !code!.lines.some((_, index) => tinted(code!, index + 1)), "nothing reads as a claim before the first flag, or once its code lands");
  assert.equal(first!.panel, "sessions");
  assert.equal(first!.panelFromLine, 4, "the sessions list opens on the fourth line");
  assert.equal(first!.sessionsAt?.slice(0, 16), "2026-10-05T01:58", "the list reads the one session live then");
  assert.equal(code!.lineSurfaces?.[2]?.fileCircles, true, "the dots appear with the second line");
  assert.ok(!code!.surfaces.fileCircles);
  assert.equal(code!.panel, "story");
  assert.equal(code!.panelFromLine, 3, "the story panel opens with the third line");
  assert.equal(together!.lineSurfaces?.[2]?.roads, true, "pathways come on with the second line");
  assert.ok(tinted(together!, 1), "the three agents' flags are let through");
  assert.equal(health!.surfaces.territories, "health");
  assert.ok(health!.compare?.sources.some(Boolean), "the comparison with other tools closes the chapter");
  for (const item of chapter) assert.ok(item.how && item.why && item.decisions.length === 0);
  assert.match(first!.how!, /flag/);
  assert.ok(!tourSteps.some(item => [item.how, item.why, ...item.lines].some(text => /outline/i.test(text ?? "") && !/Outline lists/.test(text ?? ""))), "the site speaks of flags, not outlines");
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
    assert.deepEqual(moves, ["map-first:2", "map-together:1"], wide ? "laptop" : "phone");
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


test("2.16 · the map stakes signing in's claims as flags in lots before its code lands, then replays its landings, claims and health from the same recorded stage", () => {
  const original = shop as unknown as GrowthSnapshot;
  const recording = mapRecording(original);
  const plan = mapGrowthPlan(recording);
  const at = (id: string) => { const stage = plan.stages.find(stage => stage.id === id); assert.ok(stage, id); return stage.start; };
  const missing = tourSteps.filter(step => step.explainer === "map").flatMap(step => typeof step.growth !== "object" ? [] : [step.growth.stage, step.growth.until, ...(step.growth.beats ?? []).map(beat => beat.stage)].filter(id => id && !plan.stages.some(stage => stage.id === id)));
  assert.deepEqual(missing, []);
  const signIn = "story_d263ef0f3f72", browsing = "story_0c07d0047754", cart = "story_2de9e8f4db21", checkout = "story_66f80ffaaa4d";
  const frame = (when: number) => recordedFrame(recording, plan, when);
  const stories = (when: number) => frame(when).scene.islands.map(island => island.story).sort();
  const signingIn = (when: number) => frame(when).scene.islands.find(island => island.story === signIn);
  const flags = (when: number) => frame(when).wisps.flatMap(wisp => wisp.capabilities.map(capability => `${wisp.colour} ${capability.slice(-4)}`));
  for (const id of ["planned", "pr1"]) assert.deepEqual(stories(at(id)), [signIn], `${id}: only signing in is on the map`);
  assert.equal(signingIn(at("planned"))?.land, undefined, "signing in rises plain, before any claim");
  // Steps 2: its session stakes each capability as it claims it, a flag in a lot on an equal share of the island with no code.
  const claims = plan.stages.filter(stage => /^(staked|lifted)-/.test(stage.id));
  const purple = "hsl(300, 80%, 68%)";
  assert.deepEqual(claims.map(stage => [stage.id.replace(/capability_\w+/, ""), flags(stage.start)]), [
    ["staked-", [`${purple} a414`]], ["staked-", [`${purple} a414`, `${purple} 2156`]], ["lifted-", [`${purple} 2156`]], ["lifted-", []],
    ["staked-", [`${purple} 7a32`]], ["lifted-", []], ["staked-", [`${purple} 13aa`]], ["lifted-", []], ["staked-", [`${purple} 54ab`]], ["lifted-", []],
  ], "the shop server, the session, the page shell, the sign-in page and sign-out, one after another");
  for (const stage of claims) {
    const land = signingIn(stage.start)!.land!;
    assert.deepEqual([land.files.length, land.territories.length, new Set(land.territories.map(part => part.lines)).size], [0, 5, 1], `${stage.id}: five equal shares, no code`);
  }
  const first = claims[0]!.start;
  for (const part of signingIn(first)!.land!.territories) { const window = plan.capabilities.get(part.capability!)!; assert.ok(window.start + window.seconds <= first + 1e-9, `${part.title}'s share is whole as the first flag drops`); }
  // Step 3: its code lands when its pull request merged: the surveyed territories take the lots' place in the order it built them.
  const landed = plan.stages.filter(stage => stage.id.startsWith("land-"));
  assert.deepEqual(landed.map(stage => stage.id.slice(5)), ["capability_323895c5a414", "capability_678463042156", "capability_ae20917d7a32"]);
  assert.ok(landed[0]!.start > claims.at(-1)!.start, "after the last claim is released");
  assert.deepEqual(landed.map(stage => signingIn(stage.start)!.land!.territories.length), [1, 2, 3], "it starts as one, then splits");
  assert.ok(landed.every(stage => flags(stage.start).length === 0));
  assert.equal(signingIn(at("pr1"))!.land!.files.length, 8);
  // Steps 4 and 5: the first round, checkout's two surveyed claims at pr5, then its recorded green; the second round never rises.
  assert.deepEqual(stories(at("pr3-building")), [signIn, browsing, cart, checkout].sort());
  assert.ok(plan.islands.get(browsing)!.start >= at("pr3-building"), "browsing, the cart and checkout grow in step 4");
  const surveyed = (when: number) => {
    const shown = frame(when), codes = new Set(shown.scene.islands.flatMap(island => island.land?.territories.map(part => part.capability) ?? []));
    return shown.wisps.flatMap(wisp => wisp.capabilities.filter(capability => codes.has(capability)).map(capability => `${wisp.colour} ${capability.slice(-4)}`));
  };
  assert.deepEqual(surveyed(at("pr5")).sort(), ["hsl(214, 80%, 68%) a358", "hsl(214, 80%, 68%) b593"]);
  const status = (when: number, story: string) => frame(when).scene.islands.find(island => island.story === story)!.land!.territories.map(cap => cap.status);
  assert.ok(status(at("pr4"), checkout).every(status => status === "untested"));
  const checked = at("pr7-building") - .001;
  assert.ok(status(checked, checkout).every(status => status === "healthy"), "health turns green before the step ends");
  assert.deepEqual(flags(checked), []);
  for (const when of [checked, at("pr7-building")]) assert.deepEqual(stories(when), [signIn, browsing, cart, checkout].sort(), "the chapter stays on the four stories");
  assert.equal(recordedFrame(recording, plan, 0).scene.islands.length, 1, "signing in is mounted for the opening camera; the growth clock keeps it invisible until planned");
  assert.ok([...plan.islands.values()].every(window => window.start > 0));
  assert.equal(original.scene.islands.length, 8, "free play and the other chapters keep the saved recording");
});
