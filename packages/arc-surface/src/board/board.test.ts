import assert from "node:assert/strict";
import { test } from "node:test";
import type { Line } from "@storytree/agent-link";
import type { ArcView, FieldsOf, NoteWait } from "@storytree/library";
import { record } from "../testing/records.js";
import { boardView, type BoardSnapshot } from "./board.js";
import { renderBoard } from "../view/render.js";

const increment = (id: string, status: FieldsOf<"increment">["status"], at: string, disposition?: "landed" | "failed") => record(id, "increment", {
  arc: "a", title: id, objective: id, body: id, status, parked: at,
  ...(disposition ? { outcome: { date: at, disposition } } : {}),
}, at);
const arc = (id: string, state: ArcView["state"] = "active", at = "2026-09-27"): ArcView => ({
  arc: record(id, "arc", { title: id, intent: `Intent of ${id}`, endState: "Done" }, at), state, increments: [], questions: [],
});

test("3.2 lanes show finished bars first, then oldest open work, with named counts and state colours", () => {
  const a = arc("a");
  a.increments.push(increment("new", "proposal", "2026-09-27"), increment("failed", "closed", "2026-09-26", "failed"), increment("old", "proposal", "2026-09-25"), increment("landed", "closed", "2026-09-24", "landed"));
  const snapshot: BoardSnapshot = { arcs: [a], waits: { old: [{ on: "outside", reason: "needs it", forGood: true }] }, heldOn: {} };
  const board = boardView(snapshot, [], new Date());
  assert.deepEqual(board.lanes[0]?.bars.map(({ id, reading }) => [id, reading.color]), [["landed", "green"], ["failed", "red"], ["old", "yellow"], ["new", "grey"]]);
  assert.equal(board.lanes[0]?.count, "1 landed · 1 not completed · 2 open");
  const html = renderBoard(board, "a");
  assert.match(html, /data-increment-id="old"/);
  assert.match(html, /will not release by itself/);
  assert.doesNotMatch(html, /NaN|undefined/);
});

test("3.3 lanes sort waiting, blocked, in progress, idle, quiet then recent activity; scopes partition arcs, an in-progress chip never says claimed, and idle age is on it", () => {
  const quiet = arc("quiet", "active", "2026-09-20");
  const recent = arc("recent");
  const idle = arc("idle"); idle.increments.push(record("i", "increment", { arc: "idle", title: "Build", objective: "Build", body: "Build", status: "active" }));
  const claimed = arc("claimed"); claimed.increments.push(record("j", "increment", { arc: "claimed", title: "Build", objective: "Build", body: "Build", status: "active" }));
  const waiting = arc("waiting"); waiting.questions.push(record("q", "question", { arc: "waiting", title: "Question", lifecycle: "open", statement: "Pick", stakes: "Matters", context: "Context", options: "A or B" }));
  const snapshot: BoardSnapshot = { arcs: [quiet, recent, idle, claimed, arc("blocked"), waiting, arc("parked", "parked"), arc("closed", "closed")], waits: { blocked: [{ on: "missing", reason: "needs it", forGood: true }] }, heldOn: {} };
  const lines = [
    { seq: 1, project: "p", session: "s", harness: "claude-code", source: "hook" as const, kind: "claimed" as const, increment: "i", reason: "building", at: "2026-09-27T00:00:00Z" },
    { seq: 2, project: "p", session: "t", harness: "codex", source: "hook" as const, kind: "claimed" as const, increment: "j", reason: "building", at: "2026-09-27T00:40:00Z" },
  ];
  const now = new Date("2026-09-27T00:42:00Z");
  const board = boardView(snapshot, lines, now);
  assert.deepEqual(board.lanes.map(({ id }) => id), ["waiting", "blocked", "claimed", "idle", "recent", "quiet"]);
  assert.equal(board.lanes.find(({ id }) => id === "idle")?.chip, "in progress · idle 42 min");
  assert.equal(board.lanes.find(({ id }) => id === "claimed")?.chip, "in progress");
  assert.equal(board.selected, "waiting");
  assert.deepEqual(boardView(snapshot, lines, now, "parked").lanes.map(({ id }) => id), ["parked"]);
  assert.deepEqual(boardView(snapshot, lines, now, "closed").lanes.map(({ id }) => id), ["closed"]);
});

test("3.3 a lane whose open work all waits reads queued, ranks with blocked and names what it waits on; free work reads ready · N to take", () => {
  const work = (id: string, arcId: string, at = "2026-09-20") => record(id, "increment", { arc: arcId, title: `Build ${id}`, objective: id, body: id, status: "proposal" }, at);
  const ready = arc("ready", "active", "2026-09-20"); ready.increments.push(work("r1", "ready"), work("r2", "ready"));
  const queued = arc("queued", "active", "2026-09-20"); queued.increments.push(work("q1", "queued"));
  const claimed = arc("claimed"); claimed.increments.push(work("c1", "claimed", "2026-09-27"));
  const snapshot: BoardSnapshot = { arcs: [ready, claimed, queued, arc("blocked", "active", "2026-09-19")], heldOn: {},
    waits: { blocked: [{ on: "missing", reason: "needs it", forGood: true }], q1: [{ on: "r1", reason: "needs r1", forGood: false }] } };
  const lines = [{ seq: 1, project: "p", session: "s", harness: "codex", source: "hook" as const, kind: "claimed" as const, increment: "c1", reason: "building", at: "2026-09-27T00:40:00Z" }];
  const board = boardView(snapshot, lines, new Date("2026-09-27T00:42:00Z"));
  assert.deepEqual(board.lanes.map(({ id, state }) => [id, state]), [["queued", "queued"], ["blocked", "blocked"], ["claimed", "in-progress"], ["ready", "ready"]]);
  const lane = (id: string) => board.lanes.find((lane) => lane.id === id)!;
  assert.equal(lane("ready").chip, "ready · 2 to take");
  assert.deepEqual(lane("queued").waits.map(({ title, arc }) => [title, arc?.title]), [["Build r1", "ready"]]);
});

test("3.3 an idle claim does not hide free work: the lane reads ready with its idle claims beside the chip; only-idle work still reads idle (ADR-0938 D3)", () => {
  const work = (id: string, arcId: string, status: FieldsOf<"increment">["status"] = "proposal") => record(id, "increment", { arc: arcId, title: `Build ${id}`, objective: id, body: id, status }, "2026-09-20");
  const only = arc("only"); only.increments.push(work("o1", "only", "active"));
  const mixed = arc("mixed"); mixed.increments.push(work("m1", "mixed", "active"), work("m2", "mixed"), work("m3", "mixed"));
  const free = arc("free", "active", "2026-09-20"); free.increments.push(work("f1", "free"));
  const snapshot: BoardSnapshot = { arcs: [free, mixed, only], waits: {}, heldOn: {} };
  const claim = (seq: number, session: string, increment: string) => ({ seq, project: "p", session, harness: "claude-code", source: "hook" as const, kind: "claimed" as const, increment, reason: "building", at: "2026-09-27T00:00:00Z" });
  const board = boardView(snapshot, [claim(1, "s1", "o1"), claim(2, "s2", "m1")], new Date("2026-09-27T00:42:00Z"));
  assert.deepEqual(board.lanes.map(({ id, state }) => [id, state]), [["only", "idle"], ["mixed", "ready"], ["free", "ready"]]);
  const lane = (id: string) => board.lanes.find((lane) => lane.id === id)!;
  assert.equal(lane("only").chip, "in progress · idle 42 min");
  assert.equal(lane("only").idle, undefined, "an idle lane's own chip says it; there is no beside-marker");
  assert.equal(lane("mixed").chip, "ready · 2 to take");
  assert.deepEqual(lane("mixed").idle, { chip: "in progress · idle 42 min", agents: [lane("mixed").agents[0]] });
  assert.equal(lane("mixed").idle?.agents[0]?.session, "s2");
  assert.equal(lane("free").idle, undefined);
});

test("2.1 a pip carries only its own increment's claim: capability claims mark no pip, and the lane still counts every holder (ADR-0944 D1)", () => {
  const a = arc("a");
  const touching = (id: string, status: FieldsOf<"increment">["status"], disposition?: "landed") => record(id, "increment", {
    arc: "a", title: id, objective: id, body: id, status, parked: "2026-09-20", capabilities: ["c1", "c2"],
    ...(disposition ? { outcome: { date: "2026-09-21", disposition } } : {}),
  }, "2026-09-20");
  a.increments.push(touching("done", "closed", "landed"), touching("open", "active"));
  const claim = (seq: number, target: { increment: string } | { capability: string; under?: string }) => ({ seq, project: "p", session: "s", harness: "claude-code", source: "hook" as const, kind: "claimed" as const, ...target, reason: "building", at: "2026-09-27T00:00:00Z" });
  const board = boardView({ arcs: [a], waits: {}, heldOn: {} }, [claim(1, { increment: "open" }), claim(2, { capability: "c1", under: "open" }), claim(3, { capability: "c2", under: "open" })], new Date("2026-09-27T00:01:00Z"));
  const bar = (id: string) => board.lanes[0]!.bars.find((bar) => bar.id === id)!;
  assert.deepEqual(bar("done").agents, [], "a landed pip draws no mark for its capabilities' claims");
  assert.deepEqual(bar("open").agents.map((agent) => agent.increment), ["open"], "one mark: the increment's own claim");
  assert.equal(board.lanes[0]!.agents.length, 3);
});

test("3.3 an unclaimed increment listing a capability another live increment holds reads blocked by it until that one closes or releases (ADR-0949 D3)", () => {
  const work = (id: string, arcId: string, capabilities: string[], status: FieldsOf<"increment">["status"] = "proposal") => record(id, "increment", { arc: arcId, title: `Build ${id}`, objective: id, body: id, status, capabilities }, "2026-09-20");
  const mine = arc("mine"); mine.increments.push(work("waits", "mine", ["shared"]), work("free", "mine", ["own"]));
  const theirs = arc("theirs"); theirs.increments.push(work("holder", "theirs", ["shared"], "active"));
  const snapshot: BoardSnapshot = { arcs: [mine, theirs], waits: {}, heldOn: {} };
  const line = (seq: number, kind: "claimed" | "closed" | "released", extra: object = {}) => ({ seq, project: "p", session: "s", harness: "claude-code", source: "tool", kind, increment: "holder", reason: "building", at: "2026-09-27T00:00:00Z", ...extra }) as Line;
  const now = new Date("2026-09-27T00:01:00Z");
  const bar = (lines: Line[], id: string) => boardView(snapshot, lines, now).lanes.flatMap(({ bars }) => bars).find((bar) => bar.id === id)!.reading;
  assert.deepEqual([bar([line(1, "claimed")], "waits").state, bar([line(1, "claimed")], "waits").blockedBy], ["blocked", "holder"]);
  assert.equal(bar([line(1, "claimed")], "free").state, "open");
  assert.equal(bar([line(1, "claimed"), line(2, "released")], "waits").state, "open", "released, it holds nothing");
  assert.equal(bar([line(1, "claimed"), line(2, "closed", { disposition: "landed" })], "waits").state, "open", "closed, it holds nothing");
  const byCapability = [{ ...line(1, "claimed", { increment: undefined, capability: "shared", under: "holder" }) }];
  assert.equal(bar(byCapability, "waits").blockedBy, "holder", "a capability claim blocks on behalf of the increment it was taken under");
  const blocked = boardView(snapshot, [line(1, "claimed")], now).lanes.find(({ id }) => id === "mine")!;
  assert.equal(blocked.state, "ready", "the free increment beside it is still to take");
  assert.equal(blocked.chip, "ready · 1 to take");
  assert.match(renderBoard(boardView(snapshot, [line(1, "claimed")], now), "mine"), /title="Build waits\nblocked · planned\nBlocked by Build holder \(theirs\), which holds a capability it lists"/);
});

const ownerWait: NoteWait = { releaser: "owner", note: "approve the spend", holds: true };
const eventWait: NoteWait = { releaser: "event", note: "vendor ships the part", checkBack: "2999-01-01", holds: true };
const passedWait: NoteWait = { releaser: "event", note: "the review window", checkBack: "2020-01-01", holds: false };
const noted = (id: string, arcId: string) => record(id, "increment", { arc: arcId, title: `Build ${id}`, objective: id, body: id, status: "proposal" }, "2026-09-20");

test("3.3 a ready lane's increments held by a note wait are not 'to take', and the lane names them (ADR-0938)", () => {
  const ready = arc("ready"); ready.increments.push(noted("r1", "ready"), noted("r2", "ready"), noted("r3", "ready"), noted("r4", "ready"));
  const board = boardView({ arcs: [ready], heldOn: {}, waits: {}, waitsFor: { r2: [ownerWait], r3: [eventWait], r4: [passedWait] } }, [], new Date());
  const lane = board.lanes[0]!;
  assert.deepEqual([lane.state, lane.chip], ["ready", "ready · 2 to take"], "the free increment and the one whose check-back passed");
  assert.deepEqual(lane.bars.map(({ id, reading }) => [id, reading.state, reading.color]), [["r1", "open", "grey"], ["r2", "waiting-on-you", "yellow"], ["r3", "queued", "yellow"], ["r4", "open", "grey"]]);
  assert.equal(lane.bars[3]?.reading.checkBackPassed, true);
  assert.deepEqual(lane.bars.map(({ noteWaits }) => noteWaits), [[], [ownerWait], [eventWait], [passedWait]]);
  assert.deepEqual(lane.noteWaits, [{ ...ownerWait, increment: { id: "r2", title: "Build r2" } }, { ...eventWait, increment: { id: "r3", title: "Build r3" } }], "only the waits that still hold");
});

test("3.3 a lane whose only open work waits for the owner or an event reads queued and names what for; a wait on work and a note wait both count", () => {
  const owner = arc("owner"); owner.increments.push(noted("o1", "owner"));
  const mixed = arc("mixed"); mixed.increments.push(noted("m1", "mixed"), noted("m2", "mixed"));
  const board = boardView({ arcs: [owner, mixed], heldOn: {}, waits: { m1: [{ on: "o1", reason: "needs o1", forGood: false }] }, waitsFor: { o1: [ownerWait], m2: [eventWait] } }, [], new Date());
  const lane = (id: string) => board.lanes.find((lane) => lane.id === id)!;
  assert.deepEqual([lane("owner").state, lane("owner").chip], ["queued", "queued"]);
  assert.deepEqual(lane("owner").waits, []);
  assert.deepEqual(lane("owner").noteWaits.map(({ note }) => note), ["approve the spend"]);
  assert.equal(lane("mixed").state, "queued");
  assert.deepEqual(lane("mixed").waits.map(({ title }) => title), ["Build o1"]);
  assert.deepEqual(lane("mixed").noteWaits.map(({ note }) => note), ["vendor ships the part"]);
});

test("3.3 a snapshot without note waits (a board kept by an older build) reads as before", () => {
  const ready = arc("ready"); ready.increments.push(noted("r1", "ready"));
  const lane = boardView({ arcs: [ready], heldOn: {}, waits: {} }, [], new Date()).lanes[0]!;
  assert.deepEqual([lane.chip, lane.noteWaits, lane.bars[0]?.noteWaits], ["ready · 1 to take", [], []]);
});

test("3.3 a bar waiting on work that is held on your question reads waiting on you, and its hover names the question", () => {
  const mine = arc("mine"); mine.increments.push(noted("m1", "mine"), noted("m2", "mine"));
  const middle = arc("middle"); middle.increments.push(noted("w1", "middle"));
  const owner = arc("owner"); owner.increments.push(noted("o1", "owner"));
  owner.questions.push(record("q1", "question", { arc: "owner", title: "Which vendor?", lifecycle: "open" } as never));
  const on = (id: string) => [{ on: id, reason: `needs ${id}`, forGood: false }];
  const board = boardView({ arcs: [mine, middle, owner], heldOn: { o1: ["q1"] }, waits: { m1: on("w1"), w1: on("o1") } }, [], new Date());
  const lane = board.lanes.find((lane) => lane.id === "mine")!;
  const bar = lane.bars[0]!;
  assert.equal(lane.chip, "ready · 1 to take", "work behind your question is not to take");
  assert.deepEqual([bar.reading.state, bar.reading.behind], ["waiting-on-you", ["q1"]]);
  assert.match(renderBoard(board, "mine"), /data-increment-id="m1"[^>]*title="[^"]*waiting on you: Which vendor\?/);
});
