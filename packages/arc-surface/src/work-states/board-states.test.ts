import assert from "node:assert/strict";
import { test } from "node:test";
import type { Claim } from "@storytree/agent-link";
import type { FieldsOf, Hold, NoteWait } from "@storytree/library";
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

const owner: NoteWait = { releaser: "owner", note: "approve the spend", holds: true };
const event: NoteWait = { releaser: "event", note: "vendor ships the part", checkBack: "2999-01-01", holds: true };
const passed: NoteWait = { ...event, checkBack: "2020-01-01", holds: false };

test("1.5 a holding owner wait reads waiting on you, like a held question; a holding event wait reads queued, like a wait on work (ADR-0938)", () => {
  assert.deepEqual(incrementState(open, { waitsFor: [owner] }), { state: "waiting-on-you", color: "yellow", progress: "planned" });
  assert.deepEqual(incrementState(open, { waitsFor: [event] }), { state: "queued", color: "yellow", progress: "planned" });
  assert.deepEqual(incrementState({ ...open, status: "active" }, { waitsFor: [event] }), { state: "queued", color: "yellow", progress: "in-progress" });
  assert.equal(incrementState(open, { waitsFor: [event, owner] }).state, "waiting-on-you", "an owner wait outranks an event wait");
  assert.equal(incrementState(open, { waitsFor: [event], heldOn: ["q"] }).state, "waiting-on-you", "a question still outranks queued");
  assert.equal(incrementState(open, { waitsFor: [owner], waits }).state, "waiting-on-you");
  assert.equal(incrementState(open, { waitsFor: [event], claim: held }).state, "queued", "a note wait outranks held");
  assert.equal(incrementState(open, { waitsFor: [] }).state, "open");
});

test("1.5 an event wait whose check-back has passed no longer holds the increment, and the reading says so", () => {
  assert.deepEqual(incrementState(open, { waitsFor: [passed] }), { state: "open", color: "grey", progress: "planned", checkBackPassed: true });
  assert.deepEqual(incrementState(open, { waitsFor: [passed], claim: held }), { state: "held", color: "grey", progress: "planned", checkBackPassed: true });
  assert.deepEqual(incrementState(open, { waitsFor: [passed], waits }), { state: "queued", color: "yellow", progress: "planned", checkBackPassed: true }, "other holds still hold it");
  assert.deepEqual(incrementState(open, { waitsFor: [owner, passed] }), { state: "waiting-on-you", color: "yellow", progress: "planned", checkBackPassed: true });
  assert.equal("checkBackPassed" in incrementState(open, { waitsFor: [owner, event] }), false, "a wait still holding is not a passed check-back");
});

test("1.6 a lane held only by note waits reads queued; a free increment beside them reads ready", () => {
  const reading = (waitsFor: NoteWait[]) => incrementState(open, { waitsFor });
  assert.equal(arcState("active", { increments: [reading([owner]), reading([event])] }), "queued");
  assert.equal(arcState("active", { increments: [reading([owner]), reading([passed])] }), "ready", "a passed check-back leaves the work free to take");
});

test("1.6 the arc reads closed/parked, waiting, blocked, queued, claimed, ready, idle, quiet in that order", () => {
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
