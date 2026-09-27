/** Capability 3 · Reads by session and agent (stories/knowledge-core.md). */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { Agent, Line } from "@storytree/agent-link";

import { NO_RECORDED_READS, ReadRecord } from "./reads.js";

let seq = 0;
function read(session: string, note: string, how: "peek" | "whole", agent?: Agent, extra: Partial<{ project: string; at: string; seq: number; found: "search" | "link" | "id" | "shelf" }> = {}): Line {
  seq += 10;
  return {
    seq: extra.seq ?? seq, project: extra.project ?? "app", at: extra.at ?? new Date(Date.UTC(2026, 8, 27, 0, 0, seq)).toISOString(),
    session, source: "tool", kind: "note-read", note, found: extra.found ?? "search", read: how, ...(agent === undefined ? {} : { agent }),
  };
}
const worker: Agent = { subagent: "w1", type: "explorer", task: "find the tests" };
const present = (...ids: string[]) => new Set(ids);

test("3.1 peeks and whole reads of a note by several agents in one session are one visit; a second session makes two", () => {
  const record = new ReadRecord("app");
  record.add([
    read("s1", "n", "peek", "orchestrator"), read("s1", "n", "whole", "orchestrator"), read("s1", "n", "peek", worker),
    read("s1", "n", "whole", worker), read("s1", "other", "whole", worker),
  ]);
  assert.equal(record.visits("n"), 1);
  record.add([read("s2", "n", "peek")]);
  assert.equal(record.visits("n"), 2);
  assert.deepEqual(record.totals("n"), { peeks: 3, wholes: 2 });
  assert.equal(record.visits("never-read"), 0);
});

test("3.2 interleaved agents replay apart in recorded order, ties broken by line number; a missing agent is 'unknown'", () => {
  const record = new ReadRecord("app");
  const at = "2026-09-27T00:00:00.000Z";
  record.add([
    read("s1", "b", "whole", "orchestrator", { seq: 2, at }),
    read("s1", "a", "whole", "orchestrator", { seq: 1, at }),
    read("s1", "x", "whole", worker, { seq: 3, at }),
    read("s1", "c", "whole", "orchestrator", { seq: 4 }),
    read("s2", "d", "whole", "orchestrator", { seq: 5 }),
    read("s1", "u", "whole", undefined, { seq: 6 }),
    read("s1", "v", "whole", "unknown", { seq: 7 }),
  ]);
  const { agents } = record.replay("s1", present("a", "b", "c", "d", "x", "u", "v"));
  const orchestrator = agents.find(({ agent }) => agent === "orchestrator")!;
  assert.deepEqual(orchestrator.jumps.map(({ from, to }) => [from, to]), [[undefined, "a"], ["a", "b"], ["b", "c"]], "d is another session's");
  const sub = agents.find(({ agent }) => agent === "subagent:w1")!;
  assert.deepEqual(sub.jumps.map(({ from, to }) => [from, to]), [[undefined, "x"]], "no step crosses from the orchestrator");
  const unknown = agents.find(({ agent }) => agent === "unknown")!;
  assert.equal(unknown.known, false);
  assert.deepEqual(unknown.lit.map(({ note }) => note), ["u", "v"], "no agent field and 'unknown' are the same agent");
  assert.deepEqual(unknown.jumps, [], "an unknown agent has no path");
  assert.equal(agents.filter(({ agent }) => agent === "unknown").length, 1);
});

test("3.3 a peek draws no step and keeps the last full-read stop; a whole read found by link is still a jump", () => {
  const record = new ReadRecord("app");
  record.add([
    read("s1", "a", "whole", "orchestrator"),
    read("s1", "p", "peek", "orchestrator"),
    read("s1", "b", "whole", "orchestrator", { found: "link" }),
  ]);
  const [orchestrator] = record.replay("s1", present("a", "b", "p")).agents;
  assert.deepEqual(orchestrator!.jumps.map(({ from, to, move }) => [from, to, move]), [[undefined, "a", "jump"], ["a", "b", "jump"]]);
  assert.deepEqual(orchestrator!.lit.map(({ note, read: how }) => [note, how]), [["a", "whole"], ["p", "peek"], ["b", "whole"]], "the peek still lights its note");
});

test("3.4 the same lines twice count once; switching projects clears the picture; a read of a note gone is counted missing", () => {
  const record = new ReadRecord("app");
  const lines = [read("s1", "n", "whole", "orchestrator"), read("s1", "gone", "whole", "orchestrator"), read("s1", "elsewhere", "whole", "orchestrator", { project: "site" })];
  record.add(lines);
  record.add(lines);
  assert.equal(record.visits("n"), 1);
  assert.deepEqual(record.totals("n"), { peeks: 0, wholes: 1 });
  assert.equal(record.visits("elsewhere"), 0, "another project's lines are not this picture's");

  const replay = record.replay("s1", present("n"));
  assert.deepEqual(replay.missing, new Map([["gone", 1]]));
  assert.deepEqual(replay.agents[0]!.jumps.map(({ to }) => to), ["n"], "a missing note is neither lit nor reconstructed");

  record.switchTo("site");
  assert.equal(record.visits("n"), 0);
  assert.deepEqual(record.sessions(), []);
  record.add(lines);
  assert.equal(record.visits("elsewhere"), 1);
});

test("3.5 with no captured reads the picture says 'no recorded reads', never that the knowledge went unused", () => {
  const record = new ReadRecord("app");
  assert.equal(record.status(), NO_RECORDED_READS);
  assert.equal(NO_RECORDED_READS, "no recorded reads");
  assert.doesNotMatch(NO_RECORDED_READS, /unused|never read|not used/);
  record.add([{ seq: 1, project: "app", at: "2026-09-27T00:00:00.000Z", session: "s1", source: "hook", kind: "turn-ended" }]);
  assert.equal(record.status(), NO_RECORDED_READS, "other activity is not a read");
  record.add([read("s1", "n", "peek")]);
  assert.equal(record.status(), undefined);
  assert.deepEqual(record.sessions(), ["s1"]);
});
