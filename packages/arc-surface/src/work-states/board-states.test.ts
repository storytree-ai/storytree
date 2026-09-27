import assert from "node:assert/strict";
import { test } from "node:test";
import type { Claim } from "@storytree/agent-link";
import type { FieldsOf, Hold } from "@storytree/library";
import { arcState, incrementState } from "./board-states.js";

const open: FieldsOf<"increment"> = { arc: "a", title: "Build", objective: "Build it", body: "Build it", status: "ready" };
const held: Claim = { increment: "i", session: "s", label: "Codex", reason: "building", since: "2026-09-27T00:00:00Z", holder: "idle" };
const waits: Hold[] = [{ on: "other", reason: "needs it", forGood: false }];

test("1.4 only a recorded landing or pull request makes a closed increment green; every other close keeps its reason", () => {
  const closed = { ...open, status: "closed" as const };
  assert.deepEqual(incrementState(closed), { state: "not-completed", color: "red", progress: "not-completed", close: "unrecorded" });
  for (const disposition of ["landed", "failed", "withdrawn"] as const) {
    const outcome = { date: "2026-09-27", disposition, note: "why" };
    const reading = incrementState({ ...closed, outcome }, { heldOn: ["q"], waits, claim: held });
    assert.equal(reading.state, disposition === "landed" ? "landed" : "not-completed");
    assert.equal(reading.color, disposition === "landed" ? "green" : "red");
    assert.equal(reading.close, disposition);
    assert.equal(incrementState({ ...closed, outcome: { ...outcome, pr: "42" } }).state, "landed");
  }
});

test("1.5 waiting on you precedes queued, held, open; proposals do not await approval and released active work stays in progress", () => {
  assert.equal(incrementState(open, { heldOn: ["q"], waits, claim: held }).state, "waiting-on-you");
  assert.equal(incrementState(open, { heldOn: [], waits, claim: held }).state, "queued");
  assert.equal(incrementState(open, { heldOn: [], waits: [], claim: held }).state, "held");
  assert.deepEqual(incrementState({ ...open, status: "active" }), { state: "open", color: "grey", progress: "in-progress" });
  assert.deepEqual(incrementState({ ...open, status: "proposal", parked: "2026-09-27" }, { heldOn: ["q"] }), { state: "open", color: "grey", progress: "planned" });
  assert.equal(incrementState(open, { waits }).color, "yellow");
});

test("1.6 the arc reads closed/parked, waiting, blocked, claimed, idle, quiet in that order", () => {
  const all = { openQuestions: 1, waits, claims: [held, { ...held, holder: "live" as const }] };
  assert.equal(arcState("closed", all), "closed");
  assert.equal(arcState("parked", all), "parked");
  assert.equal(arcState("active", all), "waiting");
  assert.equal(arcState("active", { ...all, openQuestions: 0 }), "blocked");
  assert.equal(arcState("active", { claims: all.claims }), "claimed");
  assert.equal(arcState("active", { claims: [held] }), "idle");
  assert.equal(arcState("active"), "quiet");
});
