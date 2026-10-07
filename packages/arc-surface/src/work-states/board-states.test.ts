import assert from "node:assert/strict";
import { test } from "node:test";
import type { Claim } from "@storytree/agent-link";
import type { FieldsOf, Hold } from "@storytree/library";
import { arcState, incrementState } from "./board-states.js";

const open: FieldsOf<"increment"> = { arc: "a", title: "Build", objective: "Build it", body: "Build it", status: "proposal" };
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

test("1.5 waiting on you precedes queued, held, open; a proposal waits on you only while your question holds it, and released active work stays in progress", () => {
  assert.equal(incrementState(open, { heldOn: ["q"], waits, claim: held }).state, "waiting-on-you");
  assert.equal(incrementState(open, { heldOn: [], waits, claim: held }).state, "queued");
  assert.equal(incrementState(open, { heldOn: [], waits: [], claim: held }).state, "held");
  assert.deepEqual(incrementState({ ...open, status: "active" }), { state: "open", color: "grey", progress: "in-progress" });
  const proposal = { ...open, status: "proposal" as const, parked: "2026-09-27" };
  assert.deepEqual(incrementState(proposal), { state: "open", color: "grey", progress: "planned" });
  assert.deepEqual(incrementState(proposal, { heldOn: ["q"] }), { state: "waiting-on-you", color: "yellow", progress: "planned" });
  assert.equal(incrementState(open, { waits }).color, "yellow");
});

test("1.6 the arc reads closed/parked, waiting, blocked, queued, claimed, idle, ready, quiet in that order", () => {
  const all = { openQuestions: 1, waits, claims: [held, { ...held, holder: "live" as const }] };
  assert.equal(arcState("closed", all), "closed");
  assert.equal(arcState("parked", all), "parked");
  assert.equal(arcState("active", all), "waiting");
  assert.equal(arcState("active", { ...all, openQuestions: 0 }), "blocked");
  assert.equal(arcState("active", { claims: all.claims }), "claimed");
  assert.equal(arcState("active", { claims: [held] }), "idle");
  assert.equal(arcState("active"), "quiet");
});

test("1.6 the arc rolls up its open increments: every one held reads queued, any free and unclaimed reads ready", () => {
  const reading = (facts: Parameters<typeof incrementState>[1]) => incrementState(open, facts);
  const queued = reading({ waits }), ownerHeld = reading({ heldOn: ["q"] }), free = reading({}), claimed = reading({ claim: held });
  const landed = incrementState({ ...open, status: "closed", outcome: { date: "2026-09-27", disposition: "landed" } });
  assert.equal(arcState("active", { increments: [landed, queued, ownerHeld] }), "queued");
  assert.equal(arcState("active", { increments: [queued], claims: [{ ...held, holder: "live" }] }), "queued", "queued sorts above claimed");
  assert.equal(arcState("active", { increments: [queued], waits }), "blocked");
  assert.equal(arcState("active", { increments: [queued], openQuestions: 1 }), "waiting");
  assert.equal(arcState("active", { increments: [queued, free, free] }), "ready");
  assert.equal(arcState("active", { increments: [free, claimed], claims: [{ ...held, holder: "live" }] }), "claimed");
  assert.equal(arcState("active", { increments: [landed] }), "quiet", "nothing open is not work to take");
});

test("1.6 an idle claim does not hide free work: free work reads ready beside it, a live holder still reads claimed, nothing free still reads idle (ADR-0938 D3)", () => {
  const free = incrementState(open), claimed = incrementState(open, { claim: held });
  assert.equal(arcState("active", { increments: [free, claimed], claims: [held] }), "ready", "an idle claim leaves the free increment to take");
  assert.equal(arcState("active", { increments: [free, claimed], claims: [{ ...held, holder: "live" }] }), "claimed", "a live holder still outranks free work");
  assert.equal(arcState("active", { increments: [claimed], claims: [held] }), "idle", "only idle-claimed work and nothing free reads idle");
  assert.equal(arcState("active", { increments: [incrementState(open, { waits })], claims: [held] }), "queued", "queued still outranks idle");
});
