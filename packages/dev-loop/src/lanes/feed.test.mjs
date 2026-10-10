import assert from "node:assert/strict";
import { test } from "node:test";

import { pickPlan, pickPool, readSurvey, WEBSITE_ARC } from "./feed.mjs";

const now = Date.parse("2026-10-07T03:00:00Z");

function increment(id, body, extra = {}) {
  return { id, arc: "arc_a", arcState: "active", title: id, body, status: "proposal", parked: "2026-10-06T00:00:00Z", ...extra };
}
function survey(increments, extra = {}) {
  return { increments, holds: { waits: {}, heldOn: {} }, claims: [], ...extra };
}

test("11.2 · the survey reads arcs and holds once, with every increment's arc, capabilities list, the arc's state and the standing claims", async () => {
  let reads = 0;
  const record = (id, arc, body, extra = {}) => ({ id, createdAt: new Date(now), fields: { arc, title: id, body, status: "proposal", parked: "2026-10-06T00:00:00Z", waits: [], ...extra } });
  const library = {
    arcViews: async () => {
      reads++;
      return [
        { arc: { id: "arc_laptop", createdAt: new Date(now) }, state: "active", questions: [{ fields: { lifecycle: "open" } }, { fields: { lifecycle: "settled" } }], increments: [record("i1", "arc_laptop", "a"), record("i2", "arc_laptop", "b", { capabilities: ["capability_x"] })] },
        { arc: { id: "arc_cap" }, state: "active", increments: [record("i3", "arc_cap", "c", { capabilities: ["capability_x"] })] },
        { arc: { id: "arc_box" }, state: "parked", increments: [record("i4", "arc_box", "d")] },
        { arc: { id: "arc_stale" }, state: "active", increments: [record("i5", "arc_stale", "e")] },
      ];
    },
    holds: async () => ({ waits: { i1: [{ on: "z", reason: "r" }] }, heldOn: {} }),
  };
  const claims = [{ increment: "i1", session: "laptop", holder: "live", since: "2026-10-07T02:30:00Z" }];
  const read = await readSurvey({ library, claims: async () => claims });
  assert.equal(reads, 1);
  assert.deepEqual(read.increments.map((one) => [one.id, one.arc, one.arcState, one.body]), [
    ["i1", "arc_laptop", "active", "a"], ["i2", "arc_laptop", "active", "b"], ["i3", "arc_cap", "active", "c"], ["i4", "arc_box", "parked", "d"], ["i5", "arc_stale", "active", "e"]]);
  assert.deepEqual(read.increments.map((one) => one.capabilities), [[], ["capability_x"], ["capability_x"], [], []], "with each one's capabilities list");
  assert.deepEqual(read.holds.waits.i1, [{ on: "z", reason: "r" }]);
  assert.deepEqual(read.arcs.map((arc) => [arc.id, arc.state, arc.openQuestions]), [["arc_laptop", "active", 1], ["arc_cap", "active", 0], ["arc_box", "parked", 0], ["arc_stale", "active", 0]]);
  assert.equal(read.claims, claims);
});

test("11.8 · the pool picks ready work from every package by claims alone, oldest first, an arc nobody is on before a busy one", () => {
  const work = survey([
    increment("library-work", "Build it in packages/library.", { arc: "arc_busy", parked: "2026-10-01T00:00:00Z" }),
    increment("app-work", "Build it in packages/app.", { arc: "arc_idle", parked: "2026-10-02T00:00:00Z" }),
    increment("dev-loop-work", "Build it in packages/dev-loop and packages/cli.", { arc: "arc_idle", parked: "2026-10-03T00:00:00Z" }),
    increment("unplaced", "No package named.", { arc: "arc_other", parked: "2026-10-04T00:00:00Z" }),
    increment("claimed", "packages/app", { arc: "arc_busy", parked: "2026-09-01T00:00:00Z" }),
    increment("waits", "packages/app", { parked: "2026-09-02T00:00:00Z" }),
    increment("owner-wait", "packages/app", { parked: "2026-09-02T00:00:00Z" }),
    increment("question", "packages/app", { parked: "2026-09-03T00:00:00Z" }),
    increment("laptop", "needs: the laptop", { parked: "2026-09-04T00:00:00Z" }),
    increment("website", "packages/app", { parked: "2026-09-04T00:00:00Z", arc: WEBSITE_ARC }),
    increment("closed", "packages/app", { parked: "2026-09-04T00:00:00Z", status: "closed" }),
    increment("parked-arc", "packages/app", { parked: "2026-09-04T00:00:00Z", arcState: "parked" }),
  ], {
    holds: { waits: { waits: [{ on: "x" }] }, waitsFor: { "owner-wait": [{ releaser: "owner", note: "his call", holds: true }] }, heldOn: { question: ["question_1"] } },
    claims: [{ increment: "claimed", session: "s1", holder: "live", since: "2026-10-07T00:00:00Z" }],
  });
  const { picks, skipped } = pickPool(work, { max: 3 });
  assert.deepEqual(picks.map((one) => one.id), ["app-work", "unplaced", "library-work"], "arc_busy has a live session, so its older work comes after the idle arcs'; one pick per idle arc first");
  assert.equal(pickPool(work, { max: 4 }).picks.at(-1).id, "dev-loop-work", "two sessions may share an arc");
  const why = Object.fromEntries(skipped.map((skip) => [skip.id, skip.why]));
  assert.match(why.claimed, /held by live session s1/);
  assert.match(why.waits, /waits on x/);
  assert.match(why["owner-wait"], /waits for the owner/);
  assert.match(why.question, /held on question_1/);
  assert.match(why.laptop, /another machine/);
  assert.match(why.website, /website arc/);
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
});

test("11.15 · only a wait for the owner or a held-on question keeps work from the pool as his; no wording in its body does", () => {
  const work = survey([
    increment("worded", "needs: the owner's sign-in. An owner action names the build.", { parked: "2026-09-01T00:00:00Z" }),
    increment("waited", "Build it in packages/app.", { parked: "2026-09-02T00:00:00Z" }),
  ], { holds: { waits: {}, waitsFor: { waited: [{ releaser: "owner", note: "sign in to the store", holds: true }] }, heldOn: {} } });
  const { picks, skipped } = pickPool(work, { max: 2 });
  assert.deepEqual(picks.map((one) => one.id), ["worded"]);
  assert.deepEqual(skipped, [{ id: "waited", why: "waits for the owner: sign in to the store" }]);
});

test("11.10 · the pool takes ready work by its arc's priority, then by when it was parked", async () => {
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

test("11.9 · an active arc whose open work all waits, with no open question, is offered for planning, oldest first and once", () => {
  const arc = (id, created, extra = {}) => ({ id, state: "active", title: id, created, openQuestions: 0, ...extra });
  const work = survey([
    increment("waiting", "x", { arc: "arc_waits" }), increment("done", "x", { arc: "arc_waits", status: "closed" }),
    increment("held", "x", { arc: "arc_held" }), increment("ready", "x", { arc: "arc_ready" }),
    increment("claimed", "x", { arc: "arc_claimed" }), increment("event", "x", { arc: "arc_event" }),
  ], {
    arcs: [arc("arc_waits", "2026-10-03T00:00:00Z"), arc("arc_empty", "2026-10-02T00:00:00Z"), arc("arc_held", "2026-10-04T00:00:00Z"),
      arc("arc_ready", "2026-09-01T00:00:00Z"), arc("arc_claimed", "2026-09-01T00:00:00Z"), arc("arc_asked", "2026-09-01T00:00:00Z", { openQuestions: 1 }),
      arc("arc_parked", "2026-09-01T00:00:00Z", { state: "parked" }), arc(WEBSITE_ARC, "2026-09-01T00:00:00Z"), arc("arc_event", "2026-10-05T00:00:00Z")],
    holds: { waits: { waiting: [{ on: "x" }] }, heldOn: { held: ["question_1"] }, waitsFor: { event: [{ releaser: "event", note: "PR", holds: true }] } },
    claims: [{ increment: "claimed", session: "s1", holder: "live", since: "2026-10-07T00:00:00Z" }],
  });
  assert.equal(pickPlan(work)?.id, "arc_empty", "an arc with no open work qualifies, oldest first");
  assert.equal(pickPlan(work, { planned: new Set(["arc_empty"]) })?.id, "arc_waits", "closed work does not count; each arc once");
  assert.deepEqual(["arc_empty", "arc_waits", "arc_held", "arc_event"].map((id, at, all) => pickPlan(work, { planned: new Set(all.slice(0, at)) })?.id), ["arc_empty", "arc_waits", "arc_held", "arc_event"]);
  assert.equal(pickPlan(work, { planned: new Set(["arc_empty", "arc_waits", "arc_held", "arc_event"]) }), undefined,
    "ready or claimed work, an open question, a parked arc and the website arc never qualify");
  assert.equal(pickPlan(survey([])), undefined, "a survey without arcs offers none");
});

test("11.13 · an arc whose open work waits on its own handed-over pull requests is in flight, not offered for planning", () => {
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

test("11.11 · work whose session ended without a hand-off is offered again after a back-off, and not before", () => {
  const ran = Date.parse("2026-10-07T01:00:00Z"), minute = 60_000;
  const attempts = new Map([["bounced", { at: ran }], ["handed", { at: ran }]]);
  const work = survey([increment("bounced", "x"), increment("handed", "x")], { holds: { waits: {}, heldOn: {}, waitsFor: { handed: [{ releaser: "event", note: "PR", holds: true }] } } });
  const pick = (at, running = []) => pickPool(work, { attempts, running, max: 2, now: at, backoffMs: 30 * minute }).picks.map((one) => one.id);
  assert.deepEqual(pick(ran + minute, ["bounced", "handed"]), [], "running work is not offered");
  assert.deepEqual(pick(ran + 5 * minute), [], "the dispatcher sees the session gone: the back-off starts");
  assert.deepEqual(pick(ran + 34 * minute), [], "not before the back-off passes");
  assert.deepEqual(pick(ran + 35 * minute), ["bounced"], "offered again once it passes; work handed to the watcher still waits");
});

test("11.12 · work whose listed capability a live session holds is left out, and offered again once that claim clears", () => {
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
  assert.deepEqual(pickPool(work([]), { attempts, max: 4, now: ran + 2 * 60_000 }).picks.map((one) => one.id), ["listed", "bounced", "gone-holder", "unlisted"],
    "offered again as soon as the claim clears, with no back-off");
});

test("11.16 · work is left out while a capability on its list is on the list of an increment another live session holds", () => {
  const work = (claims) => survey([
    increment("driven", "x", { parked: "2026-10-01T00:00:00Z", capabilities: ["capability_shared", "capability_own"] }),
    increment("wide", "y", { arc: "arc_b", parked: "2026-10-02T00:00:00Z", capabilities: ["capability_free", "capability_shared"] }),
    increment("apart", "z", { arc: "arc_c", parked: "2026-10-03T00:00:00Z", capabilities: ["capability_own2"] }),
  ], { claims });
  const driving = [{ increment: "driven", session: "s9", holder: "live", since: "2026-10-07T00:30:00Z" }];
  const { picks, skipped } = pickPool(work(driving), { max: 3, now });
  assert.deepEqual(picks.map((one) => one.id), ["apart"]);
  assert.match(Object.fromEntries(skipped.map((skip) => [skip.id, skip.why])).wide, /capability_shared held by live session s9 on the list of driven/);
  assert.deepEqual(pickPool(work([{ ...driving[0], holder: "gone" }]), { max: 3, now }).picks.map((one) => one.id), ["driven", "wide", "apart"],
    "offered again once the holder's claim is no longer live");
});
