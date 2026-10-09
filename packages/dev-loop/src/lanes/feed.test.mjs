import assert from "node:assert/strict";
import { test } from "node:test";

import { pickPool, readSurvey, WEBSITE_ARC } from "./feed.mjs";

const now = Date.parse("2026-10-07T03:00:00Z");

function increment(id, body, extra = {}) {
  return { id, arc: "arc_a", arcState: "active", title: id, body, status: "proposal", parked: "2026-10-06T00:00:00Z", ...extra };
}
function survey(increments, extra = {}) {
  return { increments, holds: { waits: {}, heldOn: {} }, claims: [], ...extra };
}

test("11.2 · the survey reads arcs and holds once, with every increment's arc, the arc's state and the standing claims", async () => {
  let reads = 0;
  const record = (id, arc, body, extra = {}) => ({ id, createdAt: new Date(now), fields: { arc, title: id, body, status: "proposal", parked: "2026-10-06T00:00:00Z", waits: [], ...extra } });
  const library = {
    arcViews: async () => {
      reads++;
      return [
        { arc: { id: "arc_laptop" }, state: "active", increments: [record("i1", "arc_laptop", "a"), record("i2", "arc_laptop", "b", { capabilities: ["capability_x"] })] },
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
  assert.deepEqual(read.holds.waits.i1, [{ on: "z", reason: "r" }]);
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
    increment("owner", "needs: the owner's sign-in", { parked: "2026-09-04T00:00:00Z" }),
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
  assert.match(why.owner, /owner action/);
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
