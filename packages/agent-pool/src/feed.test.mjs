import assert from "node:assert/strict";
import { test } from "node:test";

import { blind, LANE_FAILURES, laneFailures, main, noteLaneFailure, pickPlan, pickPool, planState, readOnly, readSurvey, reoffer } from "./feed.mjs";

const now = Date.parse("2026-10-07T03:00:00Z");

function increment(id, body, extra = {}) {
  return { id, arc: "arc_a", arcState: "active", title: id, body, status: "proposal", parked: "2026-10-06T00:00:00Z", ...extra };
}
function survey(increments, extra = {}) {
  return { increments, holds: { waits: {}, heldOn: {} }, claims: [], ...extra };
}

test("2.2 · the survey reads arcs and holds once, with every increment's arc, capabilities list, machine field, the arc's state, this machine's name, the standing claims and the refusals under every open increment on an active arc, whoever holds the capability now", async () => {
  let reads = 0;
  const record = (id, arc, body, extra = {}) => ({ id, createdAt: new Date(now), fields: { arc, title: id, body, status: "proposal", parked: "2026-10-06T00:00:00Z", waits: [], ...extra } });
  const library = {
    arcViews: async () => {
      reads++;
      return [
        { arc: { id: "arc_laptop", createdAt: new Date(now) }, state: "active", questions: [{ fields: { lifecycle: "open" } }, { fields: { lifecycle: "settled" } }], increments: [record("i1", "arc_laptop", "a"), record("i2", "arc_laptop", "b", { capabilities: ["capability_x"] })] },
        { arc: { id: "arc_cap" }, state: "active", increments: [record("i3", "arc_cap", "c", { capabilities: ["capability_x"] })] },
        { arc: { id: "arc_box" }, state: "parked", increments: [record("i4", "arc_box", "d")] },
        { arc: { id: "arc_stale" }, state: "active", increments: [record("i5", "arc_stale", "e", { machine: "laptop" })] },
      ];
    },
    holds: async () => ({ waits: { i1: [{ on: "z", reason: "r" }] }, heldOn: {} }),
  };
  const claims = [{ increment: "i1", session: "laptop", holder: "live", since: "2026-10-07T02:30:00Z" }, { capability: "capability_y", session: "quiet", holder: "gone", since: "2026-10-07T02:30:00Z" },
    { increment: "i3", session: "desk", holder: "live", since: "2026-10-07T02:30:00Z" }, { capability: "capability_z", session: "laptop", holder: "live", since: "2026-10-07T02:30:00Z" }];
  const asked = [];
  const refused = [{ capability: "capability_x", under: "i2", holder: "laptop" }, { capability: "capability_y", under: "i5", holder: "quiet" }];
  const read = await readSurvey({ library, claims: async () => claims, refusals: async (under) => (asked.push(under), refused), here: async () => "mint" });
  assert.deepEqual(asked, [["i1", "i2", "i3", "i5"]], "refusals are read once, under every open increment on an active arc, a capability nobody holds included (ADR-1079 D1)");
  assert.equal(read.refusals, refused);
  assert.equal(reads, 1);
  assert.deepEqual(read.increments.map((one) => [one.id, one.arc, one.arcState, one.body]), [
    ["i1", "arc_laptop", "active", "a"], ["i2", "arc_laptop", "active", "b"], ["i3", "arc_cap", "active", "c"], ["i4", "arc_box", "parked", "d"], ["i5", "arc_stale", "active", "e"]]);
  assert.deepEqual(read.increments.map((one) => one.capabilities), [[], ["capability_x"], ["capability_x"], [], []], "with each one's capabilities list");
  assert.deepEqual(read.increments.map((one) => one.machine), [undefined, undefined, undefined, undefined, "laptop"], "with each one's machine field");
  assert.equal(read.here, "mint", "and this machine's name");
  assert.deepEqual(read.holds.waits.i1, [{ on: "z", reason: "r" }]);
  assert.deepEqual(read.arcs.map((arc) => [arc.id, arc.state, arc.openQuestions]), [["arc_laptop", "active", 1], ["arc_cap", "active", 0], ["arc_box", "parked", 0], ["arc_stale", "active", 0]]);
  assert.equal(read.claims, claims);
  const parked = { ...library, arcViews: async () => [{ arc: { id: "arc_box" }, state: "parked", increments: [record("i4", "arc_box", "d")] }] };
  assert.deepEqual((await readSurvey({ library: parked, claims: async () => claims, refusals: async () => assert.fail("no open increment on an active arc, no read") })).refusals, []);
});

test("2.8 · the pool picks ready work from every package by claims alone, oldest first, an arc nobody is on before a busy one", () => {
  const work = survey([
    increment("library-work", "Build it in packages/library.", { arc: "arc_busy", parked: "2026-10-01T00:00:00Z" }),
    increment("app-work", "Build it in packages/app.", { arc: "arc_idle", parked: "2026-10-02T00:00:00Z" }),
    increment("dev-loop-work", "Build it in packages/dev-loop and packages/cli.", { arc: "arc_idle", parked: "2026-10-03T00:00:00Z" }),
    increment("unplaced", "No package named.", { arc: "arc_other", parked: "2026-10-04T00:00:00Z" }),
    increment("claimed", "packages/app", { arc: "arc_busy", parked: "2026-09-01T00:00:00Z" }),
    increment("waits", "packages/app", { parked: "2026-09-02T00:00:00Z" }),
    increment("owner-wait", "packages/app", { parked: "2026-09-02T00:00:00Z" }),
    increment("question", "packages/app", { parked: "2026-09-03T00:00:00Z" }),
    increment("laptop", "packages/app", { parked: "2026-09-04T00:00:00Z", machine: "laptop" }),
    increment("closed", "packages/app", { parked: "2026-09-04T00:00:00Z", status: "closed" }),
    increment("parked-arc", "packages/app", { parked: "2026-09-04T00:00:00Z", arcState: "parked" }),
  ], {
    holds: { waits: { waits: [{ on: "x" }] }, waitsFor: { "owner-wait": [{ releaser: "owner", note: "his call", holds: true }] }, heldOn: { question: ["question_1"] } },
    claims: [{ increment: "claimed", session: "s1", holder: "live", since: "2026-10-07T00:00:00Z" }],
    here: "mint",
  });
  const { picks, skipped } = pickPool(work, { max: 3 });
  assert.deepEqual(picks.map((one) => one.id), ["app-work", "unplaced", "library-work"], "arc_busy has a live session, so its older work comes after the idle arcs'; one pick per idle arc first");
  assert.equal(pickPool(work, { max: 4 }).picks.at(-1).id, "dev-loop-work", "two sessions may share an arc");
  const why = Object.fromEntries(skipped.map((skip) => [skip.id, skip.why]));
  assert.match(why.claimed, /held by live session s1/);
  assert.match(why.waits, /waits on x/);
  assert.match(why["owner-wait"], /waits for the owner/);
  assert.match(why.question, /held on question_1/);
  assert.equal(why.laptop, "needs laptop");
  assert.equal(why.closed, undefined);
  assert.equal(why["parked-arc"], undefined);
  assert.deepEqual(pickPool(work, { max: 9, running: ["app-work"] }).picks.map((one) => one.id).includes("app-work"), false, "never started twice");

  const attempts = new Map([["refused", { at: Date.parse("2026-10-07T01:00:00Z") }], ["ran", { at: Date.parse("2026-10-07T01:00:00Z") }]]);
  const later = survey([increment("refused", "x"), increment("ran", "x")],
    { claims: [{ increment: "refused", session: "s9", holder: "live", since: "2026-10-07T00:30:00Z" }] });
  assert.deepEqual(pickPool(later, { attempts, max: 2 }).picks, []);
  assert.equal(attempts.get("refused").refusedBy, "s9", "a claim older than the start refused it");
  assert.deepEqual(pickPool(survey([increment("refused", "x"), increment("ran", "x")]), { attempts, max: 2 }).picks.map((one) => one.id), ["refused"],
    "retried once its claim clears; work it ran is not");
  assert.deepEqual(pickPool(survey([increment("website", "packages/app", { arc: "arc_e42da2528db8" })]), {}).picks.map((one) => one.id), ["website"],
    "the website arc's ready work is picked like any other arc's");
});

test("2.15 · only a wait for the owner or a held-on question keeps work from the pool as his; no wording in its body does", () => {
  const work = survey([
    increment("worded", "needs: the owner's sign-in. An owner action names the build.", { parked: "2026-09-01T00:00:00Z" }),
    increment("waited", "Build it in packages/app.", { parked: "2026-09-02T00:00:00Z" }),
  ], { holds: { waits: {}, waitsFor: { waited: [{ releaser: "owner", note: "sign in to the store", holds: true }] }, heldOn: {} } });
  const { picks, skipped } = pickPool(work, { max: 2 });
  assert.deepEqual(picks.map((one) => one.id), ["worded"]);
  assert.deepEqual(skipped, [{ id: "waited", why: "waits for the owner: sign in to the store" }]);
});

test("2.10 · the pool takes ready work by its arc's priority, then by when it was parked", async () => {
  const work = survey([
    increment("old-unranked", "x", { arc: "arc_none", parked: "2026-09-01T00:00:00Z" }),
    increment("old-second", "x", { arc: "arc_two", parked: "2026-09-02T00:00:00Z", priority: 2 }),
    increment("young-first", "x", { arc: "arc_one", parked: "2026-10-05T00:00:00Z", priority: 1 }),
    increment("older-first", "x", { arc: "arc_one", parked: "2026-10-01T00:00:00Z", priority: 1 }),
    increment("busy-first", "x", { arc: "arc_busy", parked: "2026-10-04T00:00:00Z", priority: 1 }),
    increment("held", "x", { arc: "arc_busy", parked: "2026-08-01T00:00:00Z", priority: 1 }),
  ], { claims: [{ increment: "held", session: "s1", holder: "live", since: "2026-10-07T00:00:00Z" }] });
  assert.deepEqual(pickPool(work, { max: 5 }).picks.map((one) => one.id), ["older-first", "busy-first", "young-first", "old-second", "old-unranked"],
    "priority 1 before 2 before none; an idle arc goes before a busy one only within one priority");

  const record = (id, arc) => ({ id, createdAt: new Date(now), fields: { arc, title: id, status: "proposal", waits: [] } });
  const library = {
    arcViews: async () => [
      { arc: { id: "arc_r", fields: { priority: 3 } }, state: "active", increments: [record("r1", "arc_r")] },
      { arc: { id: "arc_u", fields: {} }, state: "active", increments: [record("u1", "arc_u")] },
    ],
    holds: async () => ({ waits: {}, heldOn: {} }),
  };
  const read = await readSurvey({ library, claims: async () => [] });
  assert.deepEqual(read.increments.map((one) => one.priority), [3, undefined], "the survey carries each increment's arc priority");
});

test("2.9 · an active arc whose open work all waits on an event, or has none, with no open question, is offered for planning, oldest first, and not again in the state it was planned in", () => {
  const arc = (id, created, extra = {}) => ({ id, state: "active", title: id, created, openQuestions: 0, ...extra });
  const work = survey([
    increment("waiting", "x", { arc: "arc_waits" }), increment("done", "x", { arc: "arc_waits", status: "closed" }),
    increment("ready", "x", { arc: "arc_ready" }),
    increment("claimed", "x", { arc: "arc_claimed" }), increment("event", "x", { arc: "arc_event" }),
  ], {
    arcs: [arc("arc_waits", "2026-10-03T00:00:00Z"), arc("arc_empty", "2026-10-02T00:00:00Z"),
      arc("arc_ready", "2026-09-01T00:00:00Z"), arc("arc_claimed", "2026-09-01T00:00:00Z"), arc("arc_asked", "2026-09-01T00:00:00Z", { openQuestions: 1 }),
      arc("arc_parked", "2026-09-01T00:00:00Z", { state: "parked" }), arc("arc_event", "2026-10-05T00:00:00Z")],
    holds: { waits: {}, heldOn: {}, waitsFor: { waiting: [{ releaser: "event", note: "the vendor ships 2.0", holds: true }], event: [{ releaser: "event", note: "PR", holds: true }] } },
    claims: [{ increment: "claimed", session: "s1", holder: "live", since: "2026-10-07T00:00:00Z" }],
  });
  const plan = (planned) => pickPlan(work, { planned });
  const after = (...ids) => new Map(ids.map((id) => [id, planState(work, id)]));
  assert.equal(plan(new Map())?.id, "arc_empty", "an arc with no open work qualifies, oldest first");
  assert.equal(plan(after("arc_empty"))?.id, "arc_waits", "closed work does not count; an arc planned in its present state is not offered again");
  assert.deepEqual(["arc_empty", "arc_waits", "arc_event"].map((id, at, all) => plan(after(...all.slice(0, at)))?.id), ["arc_empty", "arc_waits", "arc_event"]);
  assert.equal(plan(after("arc_empty", "arc_waits", "arc_event")), undefined,
    "ready or claimed work, an open question and a parked arc never qualify");
  assert.equal(pickPlan(survey([], { arcs: [arc("arc_e42da2528db8", "2026-09-01T00:00:00Z")] }))?.id, "arc_e42da2528db8", "the website arc is planned like any other");
  assert.equal(pickPlan(survey([])), undefined, "a survey without arcs offers none");
});

test("2.13 · an arc whose open work waits on its own handed-over pull requests is in flight, not offered for planning", () => {
  const arc = (id, created) => ({ id, state: "active", title: id, created, openQuestions: 0 });
  const handed = (pr) => [{ releaser: "event", note: `PR #${pr} is open and green and handed to the Mint box's watcher, which closes this on its merge or starts a fix session on a red.`, holds: true }];
  const work = survey([
    increment("landing", "x", { arc: "arc_landing" }), increment("next", "x", { arc: "arc_landing" }),
    increment("fixing", "x", { arc: "arc_fixing" }),
    increment("stalled", "x", { arc: "arc_stalled" }),
  ], {
    arcs: [arc("arc_landing", "2026-10-01T00:00:00Z"), arc("arc_fixing", "2026-10-02T00:00:00Z"), arc("arc_stalled", "2026-10-03T00:00:00Z")],
    holds: { waits: { next: [{ on: "landing", reason: "x", forGood: false }] }, heldOn: {}, waitsFor: {
      landing: handed(1085), fixing: [{ releaser: "event", note: "PR #1090 is with the Mint box's watcher, and a fix session works it", holds: true }],
      stalled: [{ releaser: "event", note: "the vendor ships 2.0", holds: true }],
    } },
  });
  assert.equal(pickPlan(work)?.id, "arc_stalled", "a hand-over wait, its watcher record, and a wait on an increment holding one are in flight");
});

test("2.20 · an arc planned while its open work waits on an event is offered again only once that work changes", () => {
  const arcs = [{ id: "arc_owner", state: "active", title: "Owner", created: "2026-10-01T00:00:00Z", openQuestions: 0 }];
  const owner = { releaser: "event", note: "Apple renews the certificate", holds: true };
  const work = (increments, waitsFor) => survey(increments, { arcs, holds: { waits: {}, heldOn: {}, waitsFor } });
  const waiting = work([increment("cert", "x", { arc: "arc_owner" })], { cert: [owner] });
  const first = pickPlan(waiting);
  assert.equal(first?.id, "arc_owner");
  const planned = new Map([[first.id, first.state]]);
  assert.equal(pickPlan(work([increment("cert", "x", { arc: "arc_owner" })], { cert: [{ ...owner }] }), { planned }), undefined,
    "the same open work, read again (as a restarted dispatcher reads it), is not planned again");
  assert.equal(pickPlan(work([increment("cert", "x", { arc: "arc_owner" }), increment("next", "x", { arc: "arc_owner" })], { cert: [owner], next: [owner] }), { planned })?.id, "arc_owner",
    "a newly parked increment is a change");
  assert.equal(pickPlan(work([increment("cert", "x", { arc: "arc_owner" })], { cert: [{ ...owner, note: "the vendor ships 2.0" }] }), { planned })?.id, "arc_owner",
    "a different wait is a change");
  assert.equal(pickPlan(work([increment("cert", "x", { arc: "arc_owner", status: "closed" })], {}), { planned })?.id, "arc_owner",
    "its work closing is a change");
});

test("2.21 · an arc whose open work all waits on the owner, a question or other live work is not offered for planning; one with an event wait or a dead blocker still is", () => {
  const arc = (id, created) => ({ id, state: "active", title: id, created, openQuestions: 0 });
  const owner = { releaser: "owner", note: "the owner sets CSC_LINK", holds: true };
  const work = survey([
    increment("cert", "x", { arc: "arc_mac" }), increment("reply", "x", { arc: "arc_mac" }), increment("after", "x", { arc: "arc_mac" }),
    increment("asked", "x", { arc: "arc_asked" }),
    increment("vendor", "x", { arc: "arc_event" }),
    increment("orphan", "x", { arc: "arc_dead" }),
  ], {
    arcs: [arc("arc_mac", "2026-09-01T00:00:00Z"), arc("arc_asked", "2026-09-02T00:00:00Z"), arc("arc_event", "2026-09-03T00:00:00Z"), arc("arc_dead", "2026-09-04T00:00:00Z")],
    holds: {
      waits: { after: [{ on: "cert", reason: "needs a signed release", forGood: false }], orphan: [{ on: "gone", reason: "x", forGood: true }] },
      heldOn: { asked: ["question_1"] },
      waitsFor: { cert: [owner], reply: [{ ...owner, note: "Quinn replies" }], vendor: [{ releaser: "event", note: "the vendor ships 2.0", holds: true }] },
    },
  });
  const plan = (...planned) => pickPlan(work, { planned: new Map(planned.map((id) => [id, planState(work, id)]))})?.id;
  assert.equal(plan(), "arc_event", "owner waits, a wait on live work and a held-on question leave planning nothing to add");
  assert.equal(plan("arc_event"), "arc_dead", "a wait on a blocker that can never land is stale, for planning to clear");
  assert.equal(plan("arc_event", "arc_dead"), undefined);
});

test("2.22 · an arc whose own wait holds is not offered for planning; one whose blocker can never land still is", () => {
  const arc = (id, created) => ({ id, state: "active", title: id, created, openQuestions: 0 });
  const work = survey([increment("learner", "x", { arc: "arc_learn" })], {
    arcs: [arc("arc_prune", "2026-09-01T00:00:00Z"), arc("arc_stale", "2026-09-02T00:00:00Z")],
    holds: {
      waits: { arc_prune: [{ on: "learner", reason: "the learner says what to prune", forGood: false }], arc_stale: [{ on: "gone", reason: "x", forGood: true }] },
      heldOn: {}, waitsFor: {},
    },
  });
  assert.equal(pickPlan(work)?.id, "arc_stale", "an arc with nothing open that waits on live work leaves planning nothing to add");
  assert.equal(pickPlan(work, { planned: new Map([["arc_stale", planState(work, "arc_stale")]]) }), undefined);
});

test("2.26 · an arc made in the last half hour is left to the session that made it, and offered for planning after (arc_c331455caee0 planned twice on 2026-10-19, arc_2916ca6c651b 40 seconds after it was made on 2026-10-21)", async () => {
  const library = (createdAt) => ({ arcViews: async () => [{ arc: { id: "arc_new", createdAt, fields: { title: "New" } }, state: "active", questions: [], increments: [] }], holds: async () => ({ waits: {}, heldOn: {} }) });
  const work = await readSurvey({ library: library("2026-10-07T02:45:00.000Z"), claims: async () => [] });
  assert.equal(pickPlan(work, { now }), undefined, "fifteen minutes old, its time read as the library stores it: its author may still be parking its work");
  assert.equal(pickPlan(work, { now: now + 15 * 60_000 })?.id, "arc_new", "thirty minutes old: planning takes it");
  for (const createdAt of [undefined, null, "not a time"]) {
    const unknown = await readSurvey({ library: library(createdAt), claims: async () => [] });
    assert.equal(pickPlan(unknown, { now: now + 15 * 60_000 }), undefined, `an arc whose making time cannot be read (${createdAt}) is not taken for an old one`);
  }
});

test("2.11 · work whose session ended without a hand-off is offered again after a back-off, and not before", () => {
  const ran = Date.parse("2026-10-07T01:00:00Z"), minute = 60_000;
  const attempts = new Map([["bounced", { at: ran }], ["handed", { at: ran }]]);
  const work = survey([increment("bounced", "x"), increment("handed", "x")], { holds: { waits: {}, heldOn: {}, waitsFor: { handed: [{ releaser: "event", note: "PR", holds: true }] } } });
  const pick = (at, running = []) => pickPool(work, { attempts, running, max: 2, now: at, backoffMs: 30 * minute }).picks.map((one) => one.id);
  assert.deepEqual(pick(ran + minute, ["bounced", "handed"]), [], "running work is not offered");
  assert.deepEqual(pick(ran + 5 * minute), [], "the dispatcher sees the session gone: the back-off starts");
  assert.deepEqual(pick(ran + 34 * minute), [], "not before the back-off passes");
  assert.deepEqual(pick(ran + 35 * minute), ["bounced"], "offered again once it passes; work handed to the watcher still waits");
});

test("2.12 · work whose listed capability a live session holds is left out, and offered again once that claim clears", () => {
  const ran = Date.parse("2026-10-07T01:00:00Z");
  const attempts = new Map([["bounced", { at: ran }]]);
  const held = [
    { capability: "capability_hot", session: "s7", holder: "live", since: "2026-10-07T00:30:00Z" },
    { capability: "capability_old", session: "s8", holder: "gone", since: "2026-10-07T00:30:00Z" },
  ];
  const work = (claims) => survey([
    increment("listed", "x", { parked: "2026-10-01T00:00:00Z", capabilities: ["capability_cold", "capability_hot"] }),
    increment("bounced", "x", { parked: "2026-10-02T00:00:00Z", capabilities: ["capability_hot"] }),
    increment("gone-holder", "x", { parked: "2026-10-03T00:00:00Z", capabilities: ["capability_old"] }),
    increment("unlisted", "x", { parked: "2026-10-04T00:00:00Z" }),
  ], { claims });
  const { picks, skipped } = pickPool(work(held), { attempts, max: 4, now: ran + 60_000 });
  assert.deepEqual(picks.map((one) => one.id), ["gone-holder", "unlisted"], "a claim whose holder is not live leaves its work ready");
  const why = Object.fromEntries(skipped.map((skip) => [skip.id, skip.why]));
  assert.match(why.listed, /capability_hot held by live session s7/);
  assert.equal(attempts.get("bounced").refusedBy, "s7", "a capability claim older than the start refused it");
  assert.deepEqual(pickPool(work([]), { attempts, max: 4, now: ran + 2 * 60_000 }).picks.map((one) => one.id), ["listed", "gone-holder", "unlisted"],
    "offered again as soon as the claim clears, with no back-off (bounced shares capability_hot with listed, so it waits a round)");
});

test("2.18 · work whose lane was refused a capability not yet on its list is left out while any live session holds it, whoever it passed to (increment_8a3301a85e42, increment_201f02e6baef dispatched six times on 2026-10-11)", () => {
  const work = (claims, refusals) => survey([
    increment("bounced", "x", { parked: "2026-10-01T00:00:00Z" }),
    increment("passed", "x", { parked: "2026-10-02T00:00:00Z" }),
  ], { claims, refusals });
  const holding = [{ capability: "capability_tools", session: "s0f2", holder: "live", since: "2026-10-11T06:34:01Z" }];
  const refusals = [{ capability: "capability_tools", under: "bounced", holder: "s0f2" }, { capability: "capability_tools", under: "passed", holder: "s1b7" }];
  const { picks, skipped } = pickPool(work(holding, refusals), { max: 2, now });
  assert.deepEqual(picks, [], "a refusal by a holder that has since let the capability go still holds the work off while another session holds it");
  const why = Object.fromEntries(skipped.map((skip) => [skip.id, skip.why]));
  assert.match(why.bounced, /capability_tools refused its lane, held by live session s0f2/);
  assert.match(why.passed, /capability_tools refused its lane, held by live session s0f2/, "naming the session that holds it now");
  assert.deepEqual(pickPool(work([{ ...holding[0], holder: "gone" }], refusals), { max: 2, now }).picks.map((one) => one.id), ["bounced"],
    "offered again once no live session holds it, one at a time while both were refused it");
});

test("2.16 · work is left out while a capability on its list is on the list of an increment another live session holds", () => {
  const work = (claims) => survey([
    increment("driven", "x", { parked: "2026-10-01T00:00:00Z", capabilities: ["capability_shared", "capability_own"] }),
    increment("wide", "y", { arc: "arc_b", parked: "2026-10-02T00:00:00Z", capabilities: ["capability_free", "capability_shared"] }),
    increment("apart", "z", { arc: "arc_c", parked: "2026-10-03T00:00:00Z", capabilities: ["capability_own2"] }),
  ], { claims });
  const driving = [{ increment: "driven", session: "s9", holder: "live", since: "2026-10-07T00:30:00Z" }];
  const { picks, skipped } = pickPool(work(driving), { max: 3, now });
  assert.deepEqual(picks.map((one) => one.id), ["apart"]);
  assert.match(Object.fromEntries(skipped.map((skip) => [skip.id, skip.why])).wide, /capability_shared held by live session s9 on the list of driven/);
  assert.deepEqual(pickPool(work([{ ...driving[0], holder: "gone" }]), { max: 3, now }).picks.map((one) => one.id), ["driven", "apart"],
    "offered again once the holder's claim is no longer live (wide shares capability_shared with driven, so it waits a round)");
});

test("2.17 · only the body's leading needs clause routes work: read-only or blind said later is not its need", () => {
  const sameLine = "Needs: packages/website; Mint-capable. Build the panels and retain usable read-only panels for a blind reviewer on the laptop.";
  const quoted = "Needs: packages/dev-loop.\nThe bug: a label reading needs: read-only, blind, or needs: the laptop, later in a body.";
  for (const body of [sameLine, quoted]) {
    assert.equal(readOnly(body), false, body);
    assert.equal(blind(body), false, body);
  }
  assert.equal(readOnly("needs: read-only. Survey the arc."), true);
  assert.equal(blind("Needs: blind review of the change."), true);
  assert.equal(readOnly("needs: read-only, blind"), true);
  assert.equal(blind("needs: read-only, blind"), true);
  assert.deepEqual(pickPool(survey([increment("build", quoted)]), { now }).picks.map((one) => one.id), ["build"]);
});

test("2.19 · work whose machine field names another machine is left out, with that machine's name; work naming this one, or none, is picked, whatever its body says", () => {
  const work = survey([
    increment("laptop", "Build it in packages/app.", { machine: "laptop" }),
    increment("mint", "Build it in packages/app.", { machine: "mint" }),
    increment("any", "Build it in packages/app.", { parked: "2026-10-06T00:00:01Z" }),
    increment("worded", "needs: the laptop, or another machine. Build it there.", { parked: "2026-10-06T00:00:02Z" }),
  ], { here: "mint" });
  const { picks, skipped } = pickPool(work, { max: 4, now });
  assert.deepEqual(picks.map((one) => one.id), ["mint", "any", "worded"]);
  assert.deepEqual(skipped, [{ id: "laptop", why: "needs laptop" }]);
  assert.deepEqual(pickPool({ ...work, here: undefined }, { max: 4, now }).skipped.map((skip) => skip.id), ["laptop", "mint"], "an unnamed machine takes no work that names one");
});

test("2.23 · of two ready increments listing one capability, only the older starts in a round; the other is skipped naming the capability and the pick, and work with disjoint needs starts beside it (ADR-1079 D1)", () => {
  const work = survey([
    increment("older", "x", { arc: "arc_a", parked: "2026-10-01T00:00:00Z", capabilities: ["capability_shared"] }),
    increment("newer", "x", { arc: "arc_b", parked: "2026-10-02T00:00:00Z", capabilities: ["capability_other", "capability_shared"] }),
    increment("apart", "x", { arc: "arc_c", parked: "2026-10-03T00:00:00Z", capabilities: ["capability_own"] }),
  ]);
  const { picks, skipped } = pickPool(work, { max: 3, now });
  assert.deepEqual(picks.map((one) => one.id), ["older", "apart"]);
  assert.deepEqual(skipped, [{ id: "newer", why: "shares capability_shared with older, started this round" }]);
  assert.deepEqual(pickPool(work, { max: 3, now }).picks.map((one) => one.id), ["older", "apart"], "offered again on the next survey, with no back-off recorded");
});

test("2.24 · a candidate whose lane was refused a capability an earlier pick needs is skipped, though that refusal's holder is long gone (ADR-1079 D1)", () => {
  const work = survey([
    increment("listed", "x", { arc: "arc_a", parked: "2026-10-01T00:00:00Z", capabilities: ["capability_hot"] }),
    increment("refused", "x", { arc: "arc_b", parked: "2026-10-02T00:00:00Z" }),
  ], { refusals: [{ capability: "capability_hot", under: "refused", holder: "s_gone" }], claims: [{ capability: "capability_hot", session: "s_gone", holder: "gone", since: "2026-10-01T00:00:00Z" }] });
  const { picks, skipped } = pickPool(work, { max: 2, now });
  assert.deepEqual(picks.map((one) => one.id), ["listed"]);
  assert.deepEqual(skipped, [{ id: "refused", why: "shares capability_hot with listed, started this round" }]);
});

test("2.25 · a candidate whose known needs meet a still-running lane's is skipped, though that lane has claimed nothing yet (ADR-1079 D1)", () => {
  const work = survey([
    increment("starting", "x", { arc: "arc_a", parked: "2026-10-01T00:00:00Z" }),
    increment("waiting", "x", { arc: "arc_b", parked: "2026-10-02T00:00:00Z", capabilities: ["capability_tools"] }),
    increment("free", "x", { arc: "arc_c", parked: "2026-10-03T00:00:00Z", capabilities: ["capability_own"] }),
  ], { refusals: [{ capability: "capability_tools", under: "starting", holder: "s_old" }] });
  const { picks, skipped } = pickPool(work, { running: ["starting"], max: 2, now });
  assert.deepEqual(picks.map((one) => one.id), ["free"]);
  assert.deepEqual(skipped, [{ id: "starting", why: "running now" }, { id: "waiting", why: "shares capability_tools with starting, running now" }]);
});

test("2.27 · work whose lanes failed three times is no longer offered, whatever restarted in between; two failures leave it ready, and the survey reads the failures under every open increment", async () => {
  assert.equal(LANE_FAILURES, 3);
  const failed = (increment, n) => Array.from({ length: n }, (_, i) => ({ increment, at: `2026-10-0${i + 1}T00:00:00Z`, why: "exit 0, no report or push" }));
  const work = survey([increment("tripped", "x", { arc: "arc_a" }), increment("twice", "x", { arc: "arc_b" }), increment("clean", "x", { arc: "arc_c" })],
    { failures: [...failed("tripped", 3), ...failed("twice", 2)] });
  const { picks, skipped } = pickPool(work, { max: 3, now });
  assert.deepEqual(picks.map((one) => one.id), ["twice", "clean"]);
  assert.deepEqual(skipped.map((skip) => skip.id), ["tripped"]);
  assert.match(skipped[0].why, /^its lanes failed 3 times \(2026-10-01T00:00:00Z, 2026-10-02T00:00:00Z, 2026-10-03T00:00:00Z\): the pool offers it no more/);

  const library = {
    arcViews: async () => [{ arc: { id: "arc_a" }, state: "active", increments: [
      { id: "i1", fields: { arc: "arc_a", title: "i1", status: "proposal", parked: "2026-10-06T00:00:00Z" } },
      { id: "i2", fields: { arc: "arc_a", title: "i2", status: "closed", parked: "2026-10-06T00:00:00Z" } }] }],
    holds: async () => ({ waits: {}, heldOn: {} }),
  };
  const asked = [];
  const read = await readSurvey({ library, claims: async () => [], failures: async (under) => (asked.push(under), failed("i1", 3)) });
  assert.deepEqual(asked, [["i1"]], "read once, under the open increments only");
  assert.deepEqual(pickPool(read, { max: 1, now }).picks, [], "a fresh survey, as a restarted dispatcher reads it, still holds it off");
});

test("2.27 · a failed lane is one lane-failed line on the pool, and the failures so far come back; a lane refused a claim since it started is no failure", async () => {
  const lines = [];
  const log = {
    append: async (project, line) => { const kept = { ...line, project, seq: lines.length + 1, at: `2026-10-07T0${lines.length + 1}:00:00.000Z` }; lines.push(kept); return kept; },
    lines: async (project, filter) => lines.filter((line) => filter.kinds.includes(line.kind)
      && (!filter.sessions || filter.sessions.includes(line.session)) && (!filter.since || line.at >= filter.since)
      && Object.entries(filter.where ?? {}).every(([key, value]) => line[key] === value)),
  };
  const failure = { increment: "increment_abc", why: "exit 0, no report or push, twice", logs: ["/lanes/a.log"], lane: "s1", started: "2026-10-07T00:00:00.000Z" };
  const first = await noteLaneFailure({ log, project: "storytree", failure });
  assert.deepEqual(lines.map((line) => [line.session, line.harness, line.source, line.kind, line.increment, line.why, line.logs, line.lane]),
    [["pool", "pool", "tool", "lane-failed", "increment_abc", "exit 0, no report or push, twice", ["/lanes/a.log"], "s1"]]);
  assert.deepEqual(first.map((one) => one.why), ["exit 0, no report or push, twice"]);
  const { lane: _lane, ...unnamed } = failure;
  assert.equal((await noteLaneFailure({ log, project: "storytree", failure: unnamed })).length, 2, "a lane whose log named no session is still a failure");
  assert.equal(lines.at(-1).lane, undefined);

  lines.push({ kind: "claim-refused", session: "s2", capability: "capability_x", at: "2026-10-07T05:00:00.000Z" });
  assert.equal(await noteLaneFailure({ log, project: "storytree", failure: { ...failure, lane: "s2" } }), null, "refused a claim: not a failure");
  assert.equal(lines.filter((line) => line.kind === "lane-failed").length, 2);
  assert.equal((await noteLaneFailure({ log, project: "storytree", failure: { ...failure, lane: "s2", started: "2026-10-07T06:00:00.000Z" } })).length, 3,
    "a refusal before this lane started was another lane's");
});

test("2.28 · one lane-reoffered line offers a tripped increment to the pool again with a fresh count of three; with no failure counted it is refused and writes nothing", async () => {
  const lines = [];
  const log = {
    append: async (project, line) => { const kept = { ...line, project, seq: lines.length + 1, at: `2026-10-07T0${lines.length + 1}:00:00.000Z` }; lines.push(kept); return kept; },
    lines: async (project, filter) => lines.filter((line) => filter.kinds.includes(line.kind)
      && Object.entries(filter.where ?? {}).every(([key, value]) => (Array.isArray(value) ? value.includes(line[key]) : line[key] === value))),
  };
  const project = "storytree";
  const fail = (increment) => noteLaneFailure({ log, project, failure: { increment, why: "exit 2 with no report and no push", logs: ["/lanes/a.log"] } });
  for (let n = 0; n < LANE_FAILURES; n += 1) await fail("increment_abc");
  await fail("increment_other");
  const work = async () => pickPool(await readSurvey({ library: {
    arcViews: async () => [{ arc: { id: "arc_a" }, state: "active", increments: ["increment_abc", "increment_other"].map((id) => ({ id, fields: { arc: "arc_a", title: id, status: "proposal", parked: "2026-10-06T00:00:00Z" } })) }],
    holds: async () => ({ waits: {}, heldOn: {} }) }, claims: async () => [], failures: laneFailures(log, project) }), { max: 2, now });
  assert.deepEqual((await work()).picks.map((one) => one.id), ["increment_other"], "tripped, it is not offered");
  assert.match((await work()).skipped[0].why, /feed\.mjs reoffer increment_abc --reason/, "the skip names the verb");

  assert.equal(await reoffer({ log, project, increment: "increment_abc", why: "the brief is fixed", by: "s1" }), LANE_FAILURES);
  assert.deepEqual(lines.filter((line) => line.kind === "lane-reoffered").map((line) => [line.session, line.harness, line.source, line.increment, line.why, line.by]),
    [["pool", "pool", "tool", "increment_abc", "the brief is fixed", "s1"]]);
  assert.deepEqual((await work()).picks.map((one) => one.id), ["increment_abc", "increment_other"], "offered again");
  assert.equal((await fail("increment_abc")).length, 1, "the count starts again from none");
  assert.equal((await fail("increment_other")).length, 2, "another increment's count is its own");
  assert.equal((await fail("increment_abc")).length, 2);
  assert.equal((await fail("increment_abc")).length, LANE_FAILURES, "the third fresh failure trips it again");
  assert.deepEqual((await work()).picks.map((one) => one.id), ["increment_other"]);

  const written = lines.length;
  await assert.rejects(reoffer({ log, project, increment: "increment_clean", why: "nothing", by: "s1" }), /no failed lane counted/);
  await assert.rejects(reoffer({ log, project, increment: "increment_abc", why: " " }), /--reason/);
  assert.equal(lines.length, written, "a refused reoffer writes nothing");

  const said = [];
  const asked = [];
  const options = { env: { CODEX_THREAD_ID: "t1" }, say: (text) => said.push(text), complain: (text) => said.push(text), offer: async (request) => (asked.push(request), 3) };
  assert.equal(await main(["reoffer", "increment_abc", "--reason", "the brief is fixed"], options), 0);
  assert.deepEqual(asked, [{ increment: "increment_abc", why: "the brief is fixed", by: "t1" }]);
  assert.match(said.at(-1), /cleared 3 failed lanes/);
  assert.equal(await main(["reoffer", "increment_abc"], options), 2, "a reoffer must say what was fixed");
  assert.equal(await main(["reoffer", "increment_abc", "--reason", "x"], { ...options, offer: async () => { throw new Error("nothing to clear"); } }), 1);
  assert.match(said.at(-1), /^reoffer refused: nothing to clear/);
});
