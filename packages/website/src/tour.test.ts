import assert from "node:assert/strict";
import { test } from "node:test";
import { mapRecording, mapGrowthPlan, recordedFrame } from "./map-recording.js";
import type { GrowthSnapshot } from "./forest-data.js";
import shop from "./shop-snapshot.json" with { type: "json" };
import { aim, createTour, flight, globeOf, groups, labelsAt, labelWords, lineStarts, placeTags, readingTime, replayMoment, settle, stepAt, viewOf, type TourStep } from "./tour.js";
import { steps as tourSteps } from "./tour-copy.js";
import { fill, growthCounts } from "./tour-counts.js";

const step = (id: string, explainer: TourStep["explainer"], lines = ["One two three four five six seven eight nine ten"]): TourStep => ({
  id, title: id, explainer, lines, decisions: [], surfaces: {},
});
const steps = [step("opening", "opening", ["First line", "Second line"]), step("story", "map"), step("comparison", "map"), step("knowledge", "knowledge")];
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
    { explainer: "opening", steps: [0] }, { explainer: "map", steps: [1, 2] }, { explainer: "knowledge", steps: [3] },
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
  assert.ok(typeof opening.growth === "object" && !opening.growth.stage && opening.growth.until === "plans", "it swells until the plans are shown, before any story");
  const plan = { seconds: 30, stages: [{ id: "plans", start: 2 }, { id: "planned", start: 6 }] };
  assert.equal(replayMoment(plan, opening.growth, 0), 0, "from the point");
  const end = replayMoment(plan, opening.growth, opening.growth.seconds);
  assert.ok(end < 2 && end > 1.99, "to just before the plans: no island shows on the empty globe");
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

test("2.16 · the map chapter plays seven steps in the owner's order: the beginning, your harness, arcs, stories and pathways, capabilities and code, claims, health", () => {
  const chapter = tourSteps.filter(item => item.explainer === "map");
  assert.deepEqual(chapter.map(item => item.id), ["map-empty", "map-harness", "map-arcs", "map-stories", "map-capabilities", "map-claims", "map-health"]);
  assert.ok(chapter.every(item => item.map === "shop" && typeof item.growth === "object"), "every step replays the shop's record");
  for (const item of chapter) assert.ok(item.how && item.why && item.decisions.length === 0);
  const [empty, harness, arcs, stories, capabilities, claims, health] = chapter;
  const tinted = (item: TourStep, line: number) => { let shown = item.surfaces; for (const [from, next] of Object.entries(item.lineSurfaces ?? {})) if (line >= Number(from)) shown = next; return shown; };
  const panels = (item: TourStep) => item.lines.map((_, index) => index + 1 >= (item.panelFromLine ?? 1) ? stepAt(item, index + 1).panel : undefined);
  // Steps 1 to 3: the bare globe; the harnesses storytree works with, each by its own mark and name, over it; then the arcs
  // panel over it, read before the first claim (01:53:08), the arc pointed out as its one line is said.
  assert.deepEqual(panels(empty!), [undefined]);
  assert.deepEqual(panels(harness!), [undefined]);
  assert.deepEqual(harness!.marks?.map(mark => [mark.name, mark.src]), [["Claude Code", "/harness/claude-code.png"], ["Codex", "/harness/codex.png"]]);
  assert.deepEqual([(harness!.growth as { stage: string; until: string }).stage, (harness!.growth as { until: string }).until], ["plans", "plans"]);
  assert.deepEqual(panels(arcs!), ["arcs"]);
  assert.deepEqual(labelsAt(arcs!, 1), [{ point: "arc", text: "a plan of work: an arc" }]);
  assert.ok(arcs!.sessionsAt! < "2026-10-05T01:53:08", "the arcs read the record before anything is held");
  assert.deepEqual([(empty!.growth as { until: string }).until, (arcs!.growth as { stage: string; until: string }).stage, (arcs!.growth as { until: string }).until], ["plans", "plans", "plans"], "the globe stays bare");
  // Step 3: each island rises as it is named; the pathways come on with the second line.
  assert.deepEqual((stories!.growth as { stage: string }).stage, "plans");
  assert.deepEqual((stories!.growth as { beats: unknown }).beats, [{ line: 2, stage: "pathways" }]);
  assert.deepEqual([tinted(stories!, 1).roads, tinted(stories!, 2).roads], [false, true]);
  assert.ok(!tinted(stories!, 1).territories, "nothing is drawn inside an island");
  // Step 4: the capabilities, then the dots, then the panel.
  assert.deepEqual([tinted(capabilities!, 1).territories, tinted(capabilities!, 1).fileCircles, tinted(capabilities!, 2).fileCircles], ["plain", false, true]);
  assert.deepEqual(panels(capabilities!), [undefined, undefined, "story"]);
  // Step 5: the flags, then the arcs panel, then the sessions list, read as the flags stand (after 02:28:27, before 02:29:25).
  assert.deepEqual(panels(claims!), [undefined, "arcs", "sessions"]);
  assert.ok(claims!.sessionsAt! > "2026-10-05T02:28:27" && claims!.sessionsAt! < "2026-10-05T02:29:25");
  assert.deepEqual(chapter.map(item => item.lines.some((_, index) => tinted(item, index + 1).sessionTints === true)), [false, false, false, false, false, true, true], "flags show from the claims step on, and lift in health");
  assert.deepEqual(claims!.compare?.sources.map(source => source?.name), ["Cursor docs", "LangSmith docs", "Linear docs", undefined], "the agents chapter's comparison is kept in the claims step's depth");
  assert.equal(tinted(health!, 1).territories, "health");
  assert.deepEqual(health!.compare?.sources.map(source => source?.name), ["VS Code docs", "Aider docs", undefined], "the comparison with file-browsing tools closes the chapter");
});

test("2.16 · across the map chapter the camera moves twice: into signing in for its capabilities, and back to the four stories for the claims", () => {
  const chapter = tourSteps.filter(item => item.explainer === "map");
  for (const wide of [true, false]) {
    const moves: string[] = [];
    let before: string | undefined;
    for (const item of chapter) item.lines.forEach((_, index) => {
      const view = JSON.stringify(viewOf(item, index + 1, wide));
      if (before !== undefined && view !== before) moves.push(`${item.id}:${index + 1}`);
      before = view;
    });
    assert.deepEqual(moves, ["map-capabilities:1", "map-claims:1"], wide ? "laptop" : "phone");
  }
  const [, , , stories, capabilities, claims] = chapter;
  assert.deepEqual(viewOf(capabilities!, 1, true).target, { kind: "story", story: "story_d263ef0f3f72" }, "it flies into signing in");
  assert.deepEqual(viewOf(claims!, 1, true), viewOf(stories!, 1, true), "and back to the view of the four stories");
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

test("2.16 · the map grows its four islands as they are named, then its pathways, then its capabilities, and plants each recorded claim as a flag in its share", () => {
  const original = shop as unknown as GrowthSnapshot;
  const recording = mapRecording(original);
  const plan = mapGrowthPlan(recording);
  const at = (id: string) => { const stage = plan.stages.find(stage => stage.id === id); assert.ok(stage, id); return stage.start; };
  const missing = tourSteps.filter(step => step.explainer === "map").flatMap(step => typeof step.growth !== "object" ? [] : [step.growth.stage, step.growth.until, ...(step.growth.beats ?? []).map(beat => beat.stage)].filter(id => id && !plan.stages.some(stage => stage.id === id)));
  assert.deepEqual(missing, []);
  const signIn = "story_d263ef0f3f72", browsing = "story_0c07d0047754", cart = "story_2de9e8f4db21", checkout = "story_66f80ffaaa4d";
  const four = [signIn, browsing, cart, checkout].sort();
  const frame = (when: number) => recordedFrame(recording, plan, when);
  const stories = (when: number) => frame(when).scene.islands.map(island => island.story).sort();
  const island = (when: number, story: string) => frame(when).scene.islands.find(island => island.story === story)!;
  const risen = (when: number) => [signIn, browsing, cart, checkout].filter(story => plan.islands.get(story)!.start <= when);
  // Step 3: the islands rise in the order the agents started on them, each mounted for the camera before it rises.
  const beats = ["plans", "planned", "risen-browsing", "risen-round", "pathways", "pathways-browsing"];
  for (const id of beats) assert.deepEqual(stories(at(id)), four, `${id}: all four mounted`);
  assert.deepEqual(beats.slice(0, 4).map(id => risen(at(id) + 1e-6)), [[], [signIn], [signIn, browsing], [signIn, browsing, cart]]);
  assert.deepEqual(risen(at("pathways")), [signIn, browsing, cart, checkout], "the cart and checkout rise before the pathways");
  assert.ok(plan.islands.get(cart)!.start >= at("risen-round"));
  // The pathways: those to signing in first, then those to browsing.
  const links = recording.stages.find(stage => stage.id === "planned")!.scene.links!;
  const storyOf = new Map(recording.stages.find(stage => stage.id === "planned")!.scene.islands.flatMap(island => island.trees.map(tree => [tree.capability, island.story])));
  const roads = (to: string) => links.filter(link => storyOf.get(link.to) === to && storyOf.get(link.from) !== to).map(link => plan.roads.get(`${link.from}->${link.to}`)!.start);
  assert.ok(roads(signIn).length === 10 && roads(signIn).every(start => start >= at("pathways") && start < at("pathways-browsing")), "the pathways to signing in draw with the second line");
  assert.ok(roads(browsing).length === 6 && roads(browsing).every(start => start >= at("pathways-browsing")), "then those to browsing");
  assert.ok(beats.every(id => frame(at(id)).scene.islands.every(island => !island.land)), "nothing is drawn inside an island before step 4");
  // Step 4: signing in's, then browsing's capabilities arrive in the order they were built; the cart and checkout, with no code
  // yet, carry an equal share for each planned capability.
  const landed = plan.stages.filter(stage => stage.id.startsWith("land-"));
  assert.deepEqual(landed.map(stage => stage.id.slice(-4)), ["a414", "2156", "7a32", "44d0", "df4b", "1a72"]);
  assert.deepEqual(landed.map(stage => [island(stage.start, signIn).land?.territories.length ?? 0, island(stage.start, browsing).land?.territories.length ?? 0]), [[1, 0], [2, 0], [3, 0], [3, 1], [3, 2], [3, 3]]);
  for (const stage of landed) for (const [story, planned] of [[cart, 2], [checkout, 3]] as const) {
    const land = island(stage.start, story).land!;
    assert.deepEqual([land.files.length, land.territories.length, new Set(land.territories.map(part => part.lines)).size], [0, planned, 1], `${stage.id}: equal shares, no code`);
  }
  // Step 5: three sessions' eight claims, each a flag in its session's colour standing in a share of its capability.
  const flags = (when: number) => frame(when).wisps.flatMap(wisp => wisp.capabilities.map(capability => [wisp.story, wisp.colour, capability] as const));
  assert.deepEqual(flags(at("pr3-building")), [], "no flag before the first claim");
  assert.ok(at("staked-capability_94f91d2ed3a9") < at("together"), "all eight stand before the claims step's second line");
  const standing = at("together");
  const byStory = (when: number) => Object.fromEntries([browsing, cart, checkout].map(story => [story, flags(when).filter(flag => flag[0] === story).map(flag => flag[1])]));
  assert.deepEqual(byStory(standing), {
    [browsing]: Array(3).fill("hsl(10, 80%, 68%)"), [cart]: Array(2).fill("hsl(188, 80%, 68%)"), [checkout]: Array(3).fill("hsl(214, 80%, 68%)"),
  });
  for (const [story, , capability] of flags(standing)) assert.ok(island(standing, story).land?.territories.some(part => part.capability === capability), `${capability} has a share on its island`);
  assert.ok(island(standing, browsing).land!.territories.filter(part => part.capability === "capability_f29c62742cce").every(part => part.lines > 1), "a claim on an island with code is a share sized like its neighbours");
  assert.equal(plan.stages.filter(stage => stage.id.startsWith("staked-") && stage.start > at("pr3-building") && stage.start <= standing).length, 8);
  // Step 6: flags lift as capabilities land, the cart's and checkout's code takes their shares' place, then the round turns green.
  assert.equal(flags(at("lifted-capability_f29c62742cce")).length, 7);
  const survey = (original.stages.find(stage => stage.id === "pr5")!.scene.islands.find(island => island.story === cart)!.land)!;
  assert.deepEqual([island(at("pr5"), cart).land!.territories.map(part => part.capability), island(at("pr5"), cart).land!.files.map(file => file.path)],
    [survey.territories.map(part => part.capability), survey.files.map(file => file.path)], "the cart's surveyed code takes its shares' place");
  const status = (when: number, story: string) => island(when, story).land!.territories.map(part => part.status);
  assert.ok(status(at("pr4"), checkout).every(status => status === "untested"));
  const checked = at("pr7-building") - .001;
  assert.ok(status(checked, checkout).every(status => status === "healthy"), "health turns green before the step ends");
  assert.ok(plan.stages.filter(stage => stage.start > at("pr4") && stage.start <= checked).every(stage => flags(stage.start).length === 0), "the second round's claims are not shown");
  for (const when of [checked, at("pr7-building")]) assert.deepEqual(stories(when), four, "the chapter stays on the four stories");
  assert.ok([...plan.islands.values()].every(window => window.start > 0));
  assert.equal(original.scene.islands.length, 8, "free play and the other chapters keep the saved recording");
});

test("3.4 · the map chapter lays the shop's first four stories out by their own plan: signing in, browsing above it, the cart and checkout side by side above browsing", () => {
  const original = shop as unknown as GrowthSnapshot;
  const recording = mapRecording(original);
  const signIn = "story_d263ef0f3f72", browsing = "story_0c07d0047754", cart = "story_2de9e8f4db21", checkout = "story_66f80ffaaa4d";
  const place = new Map(recording.places.map(node => [node.id, node.place]));
  assert.deepEqual([signIn, browsing, cart, checkout].map(story => place.get(story)), [1, 1001, 2001, 2002]);
  assert.deepEqual(recording.scene.islands.map(island => island.story).sort(), [signIn, browsing, cart, checkout].sort(), "framed by the four, not the finished shop");
  const spot = new Map(recording.spots);
  const [s, b, c, k] = [spot.get(signIn)!, spot.get(browsing)!, spot.get(cart)!, spot.get(checkout)!];
  assert.ok(Math.abs(c.y - k.y) < 1e-9 && c.x < k.x, "the cart and checkout side by side, the cart to the west");
  assert.ok(c.y > b.y && b.y > s.y, "the cart and checkout above browsing, browsing above signing in");
  assert.deepEqual(original.places.find(node => node.id === checkout)!.place, 3001, "free play keeps the finished shop's places");
});

test("2.21 · each map line labels the one thing it talks about, in words true to the shop's record as it is said, and the label goes when the line passes", () => {
  const original = shop as unknown as GrowthSnapshot;
  const recording = mapRecording(original);
  const plan = mapGrowthPlan(recording);
  const names = (original.reading?.recording.lines ?? []).filter(line => line.kind === "session-named");
  /** What each label on line `line` of step `id` says `into` seconds after the line begins, read from the frame on show then. */
  const said = (id: string, line: number, into = .5) => {
    const step = tourSteps.find(step => step.id === id)!, starts = lineStarts(step);
    if (typeof step.growth !== "object") throw new Error(id);
    const frame = recordedFrame(recording, plan, replayMoment(plan, step.growth, starts[line - 1]! + into, starts));
    const named = (session: string) => names.filter(name => name.session === session && name.at <= frame.at).flatMap(name => "title" in name ? [String(name.title)] : []).at(-1);
    return labelsAt(step, line).map(label => "point" in label ? `point:${label.point}` : `${JSON.stringify(label.target)} ${labelWords(label, frame, named)}`);
  };
  const story = (id: string) => JSON.stringify({ kind: "story", story: id });
  const signIn = "story_d263ef0f3f72", checkout = "story_66f80ffaaa4d";
  // Stories and pathways: the island, then the one pathway the line names.
  assert.deepEqual(said("map-stories", 1, 7), [`${story(signIn)} a story`]);
  assert.deepEqual(said("map-stories", 2), [`${JSON.stringify({ kind: "pathway", link: "capability_ed214990be99->capability_ae20917d7a32", along: .2 })} the cart needs signing in`]);
  // Capabilities: the first territory as it arrives, then the largest of signing in's files with its recorded size; the panel line has none.
  assert.deepEqual(said("map-capabilities", 1), [`${JSON.stringify({ kind: "capability", capability: "capability_323895c5a414" })} a capability`]);
  assert.deepEqual(said("map-capabilities", 2), [`${JSON.stringify({ kind: "file", story: signIn, path: "src/server/server.js" })} server.js · 110 lines`]);
  assert.deepEqual(said("map-capabilities", 3), []);
  // Claims: the first flag, named by the session that planted it; the arcs line has none; the sessions list is pointed out, not labelled.
  assert.deepEqual(said("map-claims", 1, 2), [`${JSON.stringify({ kind: "capability", capability: "capability_f29c62742cce" })} Part 2: product page, sorting, cart`]);
  assert.deepEqual(said("map-claims", 2), []);
  assert.deepEqual(said("map-claims", 3), ["point:sessions"]);
  // Arcs: the shop's first arc in the list is pointed out and named, not labelled on the globe.
  assert.deepEqual(said("map-arcs", 1), ["point:arc"]);
  // Health: checkout reads "not proved yet" while it is yellow, and "tests passed" once the survey turns it green.
  assert.deepEqual(said("map-health", 1), [`${story(checkout)} not proved yet`]);
  assert.deepEqual(said("map-health", 2), [`${story(checkout)} not proved yet`]);
  assert.deepEqual(said("map-health", 2, 8.6), [`${story(checkout)} tests passed`]);
  // A label shows only while its line is the current one, and no other chapter's lines carry one.
  for (const step of tourSteps) for (let line = 1; line <= step.lines.length; line++) {
    const now = labelsAt(step, line), next = labelsAt(step, line + 1);
    assert.ok(now.length <= 1, `${step.id} ${line}: one at a time`);
    assert.ok(next.every(label => !now.includes(label)), `${step.id} ${line}: gone when the line passes`);
    if (step.explainer !== "map") assert.deepEqual(now, [], step.id);
  }
  // On a phone, at most one label on the globe in a step; the narrowest keeps fewer still.
  const onPhone = (width: number) => tourSteps.map(step => new Set(step.lines.flatMap((_, line) => labelsAt(step, line + 1, { width }).flatMap(label => "point" in label ? [] : [label.target.kind]))).size);
  assert.ok(onPhone(390).every(count => count <= 1));
  assert.deepEqual([onPhone(1440), onPhone(390), onPhone(320)].map(counts => counts.reduce((sum, count) => sum + count, 0)), [6, 3, 1]);
});

test("2.21 · a line's label sits inside the screen, clear of its ring, the card and the panels, and off an island's name where it has room", () => {
  // A phone at 320: the label's ring near the right edge, the sessions list above it, the card below, an island's name to its left.
  const room = { width: 320, height: 560 };
  const tag = { x: 250, y: 262, width: 150, height: 25 };
  const panels = [{ x: 10, y: 84, width: 300, height: 86 }, { x: 10, y: 340, width: 300, height: 200 }];
  const name = { x: 60, y: 250, width: 160, height: 22, soft: true };
  const [at] = placeTags([tag], room, { keepOut: [...panels, name], sides: ["right", "left", "below", "above"] });
  const box = { x: tag.x + at!.x, y: tag.y + at!.y, width: tag.width, height: tag.height };
  const meets = (a: typeof box, b: typeof box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  assert.ok(box.x >= 8 && box.y >= 8 && box.x + box.width <= room.width - 8 && box.y + box.height <= room.height - 8, `inside the screen: ${JSON.stringify(box)}`);
  assert.ok(!meets(box, { x: tag.x - 17, y: tag.y - 17, width: 34, height: 34 }), "clear of its ring");
  for (const panel of panels) assert.ok(!meets(box, panel), `clear of ${JSON.stringify(panel)}`);
  assert.ok(!meets(box, name), "off the island's name");
  // A laptop: to the right of its ring, or to the left where the right has no room.
  const wide = { width: 1440, height: 900 };
  assert.equal(placeTags([{ x: 900, y: 400, width: 160, height: 25 }], wide, { share: true })[0]!.side, "right");
  assert.equal(placeTags([{ x: 1350, y: 400, width: 160, height: 25 }], wide, { share: true })[0]!.side, "left");
});

test("2.20 · the knowledge chapter plays three steps on the globe the map chapter leaves: decisions inside it, checkout's shelf, and the orders session reading it before it claims", () => {
  const chapter = tourSteps.filter(item => item.explainer === "knowledge");
  assert.deepEqual(chapter.map(item => item.id), ["knowledge-inside", "knowledge-shelf", "knowledge-reads"]);
  for (const item of chapter) assert.ok(item.how && item.why && item.decisions.length === 0);
  const [inside, shelf, reads] = chapter as [TourStep, TourStep, TourStep];
  const recording = shop as unknown as GrowthSnapshot;
  // Every step holds the map chapter's globe where its health step ends: the first round's four stories, checked.
  const health = tourSteps.find(item => item.id === "map-health")!;
  const plan = mapGrowthPlan(mapRecording(recording));
  // Health runs until the second round's first building stage (03:08:57) and stops just short of it.
  const end = plan.stages.find(stage => stage.id === "pr7-building")!;
  assert.equal(end.at, "2026-10-05T03:08:57.049Z");
  assert.equal((health.growth as { until: string }).until, "pr7-building");
  for (const item of chapter) {
    assert.equal(item.map, "shop", `${item.id} stays on the shop`);
    const growth = item.growth as { seconds: number };
    for (const told of [0, growth.seconds]) assert.ok(Math.abs(replayMoment(plan, growth, told) - end.start) < .01, `${item.id} holds the globe at the 03:08:57 survey`);
  }
  // One idea per line: the notes come in with the first step's third line, the note's card with the shelf's second, and the
  // orders session's flags with the reads step's third.
  const tinted = (item: TourStep, line: number) => { let shown = item.surfaces; for (const [from, next] of Object.entries(item.lineSurfaces ?? {})) if (line >= Number(from)) shown = next; return shown; };
  const panels = (item: TourStep) => item.lines.map((_, index) => index + 1 >= (item.panelFromLine ?? 1) ? stepAt(item, index + 1).panel : undefined);
  assert.deepEqual([1, 2, 3].map(line => tinted(inside, line).knowledgeCore).concat([tinted(shelf, 1).knowledgeCore, tinted(reads, 1).knowledgeCore]), [false, false, true, true, true]);
  assert.deepEqual(panels(shelf), [undefined, "note"]);
  assert.deepEqual(panels(reads), reads.lines.map(() => "sessions"));
  assert.deepEqual(reads.lines.map((_, index) => tinted(reads, index + 1).sessionTints === true), [false, false, true, true]);
  // The camera: it arrives on health's view of the four stories, then goes in to checkout.
  for (const wide of [true, false]) {
    // The four stories' view, centred on browsing: 1.32 globe radii on a laptop, 1.5 on a phone.
    const browsing = { kind: "story", story: "story_0c07d0047754" };
    assert.deepEqual(viewOf(inside, 1, wide), wide ? { target: browsing, framing: 1.32 } : { target: browsing, framing: 1.5, side: 0 }, "the chapter picks up on the four stories");
    assert.deepEqual(viewOf(inside, 1, wide), viewOf(health, 2, wide), "where health leaves the camera");
    for (const item of [shelf, reads]) assert.deepEqual(viewOf(item, 1, wide).target, { kind: "story", story: "story_66f80ffaaa4d" });
  }
  // The shelf's note is a decision on one of checkout's capabilities; the session the reads step follows opened it in full
  // from that shelf, then claimed checkout's capabilities, all before the moment the chapter reads and the survey it holds at.
  const checkout = recording.reading!.tree.stories.find(story => story.id === "story_66f80ffaaa4d")!.capabilities.map(item => item.id);
  const note = recording.changes!.find(change => change.recordId === shelf.note)!;
  assert.ok(note.type === "decision" && checkout.includes(String(note.record.fields.frontCoverOf)), "the note sits on checkout's shelf");
  const moment = reads.sessionsAt!;
  assert.ok(chapter.every(item => item.sessionsAt === moment) && moment < recording.stages.find(stage => stage.id === "pr7-building")!.at);
  const lines = recording.reading!.recording.lines.filter(line => line.session === reads.follow && line.at <= moment) as readonly { kind: string; at: string; note?: string; read?: string; found?: string; capability?: string }[];
  const opened = lines.find(line => line.kind === "note-read" && line.note === shelf.note && line.read === "whole" && line.found === "shelf");
  assert.ok(opened, "the followed session opened the note in full from its shelf");
  const claims = lines.filter(line => line.kind === "claimed" && checkout.includes(line.capability ?? ""));
  assert.ok(claims.length > 0 && claims.every(line => line.at > opened.at), "and claimed checkout's capabilities only after");
  assert.deepEqual(reads.compare?.sources.map(source => source?.name), ["Cursor docs", "Graphiti docs", undefined], "the memory comparison is in the reads step's depth");
  // The count the first step's depth gives is the decisions written by the survey the chapter holds at.
  assert.match(fill(inside.how!, growthCounts(recording, recording)), /had written 47 decisions/);
});
