/** The command line 14.1–14.5, 14.7 and 14.8: the counts one window of door-answered lines gives, against the doors' declared surfaces. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { countDoors, type DoorLine } from "./reading.js";

const both = ["agent", "user"] as const;
const declared = {
  commands: ["storytree arc show", "storytree arc list", "storytree library search"].map((verb) => ({ verb, consumers: both })),
  tools: ["show_plan", "search_notes", "retire"].map((verb) => ({ verb, consumers: ["agent"] as const })),
};
const window = { since: "2026-10-01T00:00:00.000Z", until: "2026-10-08T00:00:00.000Z" };
let at = 0;
/** A door-answered line, answered unless told otherwise, each a second after the last. */
function line(session: string, door: DoorLine["door"], verb: string, more: Partial<DoorLine> = {}): DoorLine {
  at += 1;
  return { session, at: new Date(Date.parse(window.since) + at * 1000).toISOString(), door, verb, outcome: "answered", next: [], ...more };
}

test("14.1 · every declared command and tool is listed with its calls and sessions, those with none at zero, and an undeclared verb apart", () => {
  const reading = countDoors([
    line("a", "command", "storytree arc show"),
    line("a", "command", "storytree arc show"),
    line("b", "command", "storytree arc show"),
    line("a", "tool", "show_plan"),
    line("b", "command", "storytree"),
  ], declared, new Map(), window);
  const of = (verb: string) => reading.surfaces.find((surface) => surface.verb === verb);
  assert.deepEqual(of("storytree arc show"), { door: "command", verb: "storytree arc show", declared: true, consumers: both, judged: false, calls: 3, sessions: 2 });
  assert.deepEqual(of("storytree arc list"), { door: "command", verb: "storytree arc list", declared: true, consumers: both, judged: false, calls: 0, sessions: 0 });
  assert.deepEqual(of("retire"), { door: "tool", verb: "retire", declared: true, consumers: ["agent"], judged: true, calls: 0, sessions: 0 });
  assert.deepEqual(of("show_plan"), { door: "tool", verb: "show_plan", declared: true, consumers: ["agent"], judged: true, calls: 1, sessions: 1 });
  assert.deepEqual(of("storytree"), { door: "command", verb: "storytree", declared: false, judged: true, calls: 1, sessions: 1 });
  assert.equal(reading.surfaces.length, 7, "six declared surfaces and the one undeclared verb");
  assert.deepEqual(reading.calls, { command: 4, tool: 1 });
  assert.equal(reading.sessions, 2);
});

test("14.2 · each word refused as unknown is counted with where it was refused and the command named, and each door's unknowns per 1,000 calls", () => {
  const lines = [
    line("a", "command", "storytree arc increment", { outcome: "unknown", word: "show", named: "storytree library read" }),
    line("b", "command", "storytree arc increment", { outcome: "unknown", word: "show", named: "storytree library read" }),
    line("b", "command", "storytree", { outcome: "unknown", word: "plan" }),
    line("a", "command", "storytree arc show"),
    line("a", "tool", "show_plan"),
  ];
  const reading = countDoors(lines, declared, new Map(), window);
  assert.deepEqual(reading.misses, [
    { door: "command", where: "storytree arc increment", word: "show", named: "storytree library read", count: 2 },
    { door: "command", where: "storytree", word: "plan", count: 1 },
  ]);
  assert.deepEqual(reading.unknownPer1000, { command: 750, tool: 0 });
  assert.equal(countDoors([], declared, new Map(), window).unknownPer1000.command, null, "no calls, no rate");
});

test("14.3 · each offered step's follow is counted beside the like-for-like baseline: the same previous verb, the step not offered", () => {
  const reading = countDoors([
    // Offered after arc show: taken once, not taken once.
    line("a", "command", "storytree arc show", { next: ["storytree arc list"] }),
    line("a", "command", "storytree arc list"),
    line("b", "command", "storytree arc show", { next: ["storytree arc list"] }),
    line("b", "tool", "show_plan"),
    // Not offered after arc show: taken once in two.
    line("c", "command", "storytree arc show"),
    line("c", "command", "storytree arc list"),
    line("d", "command", "storytree arc show"),
    line("d", "command", "storytree library search"),
    // Offered on a session's last call: counted as offered, with no next call to take it.
    line("e", "command", "storytree arc show", { next: ["storytree arc list"] }),
  ], declared, new Map(), window);
  assert.deepEqual(reading.follows, [
    { step: "storytree arc list", offered: 3, answered: 2, followed: 1, baseline: { calls: 2, took: 1 } },
  ]);
});

test("14.4 · each call is on a step, each step gives its calls through each door, and failures are counted by class apart from refusals", () => {
  const reading = countDoors([
    line("a", "command", "storytree library search"),
    line("a", "tool", "search_notes"),
    line("a", "tool", "search_notes"),
    line("a", "command", "storytree arc show", { outcome: "failed", class: "TypeError" }),
    line("b", "command", "storytree arc show", { outcome: "failed", class: "TypeError" }),
    line("b", "tool", "show_plan", { outcome: "failed" }),
    line("b", "tool", "show_plan", { outcome: "refused" }),
    line("b", "tool", "made_up_tool"),
  ], declared, new Map(), window);
  const step = (name: string) => reading.steps.find((one) => one.step === name);
  assert.deepEqual(step("search"), { step: "search", command: 1, tool: 2 });
  assert.deepEqual(step("orient"), { step: "orient", command: 2, tool: 2 });
  assert.deepEqual(step("other"), { step: "other", command: 0, tool: 1 });
  assert.deepEqual(reading.failures, [
    { door: "command", verb: "storytree arc show", class: "TypeError", count: 2 },
    { door: "tool", verb: "show_plan", class: "unnamed", count: 1 },
  ]);
  assert.deepEqual(reading.refusals, [{ door: "tool", verb: "show_plan", count: 1 }]);
});

test("14.5 · calls, sessions and unknowns are split by machine, harness, and briefed (at most one prompt) or not", () => {
  const reading = countDoors([
    line("lane", "command", "storytree arc show", { machine: "box", harness: "codex" }),
    line("lane", "command", "storytree", { machine: "box", harness: "codex", outcome: "unknown", word: "plan" }),
    line("owner", "tool", "show_plan", { machine: "laptop", harness: "claude-code" }),
    line("owner", "command", "storytree arc show", { machine: "laptop", harness: "claude-code" }),
    line("quiet", "tool", "show_plan"),
  ], declared, new Map([["lane", 1], ["owner", 4]]), window);
  const split = (by: string, value: string) => reading.splits.find((one) => one.by === by && one.value === value);
  assert.deepEqual(split("machine", "box"), { by: "machine", value: "box", command: 2, tool: 0, sessions: 1, unknown: 1 });
  assert.deepEqual(split("machine", "laptop"), { by: "machine", value: "laptop", command: 1, tool: 1, sessions: 1, unknown: 0 });
  assert.deepEqual(split("machine", "unnamed"), { by: "machine", value: "unnamed", command: 0, tool: 1, sessions: 1, unknown: 0 });
  assert.deepEqual(split("harness", "codex"), { by: "harness", value: "codex", command: 2, tool: 0, sessions: 1, unknown: 1 });
  assert.deepEqual(split("briefed", "briefed"), { by: "briefed", value: "briefed", command: 2, tool: 1, sessions: 2, unknown: 1 });
  assert.deepEqual(split("briefed", "not briefed"), { by: "briefed", value: "not briefed", command: 1, tool: 1, sessions: 1, unknown: 0 });
});

test("14.7 · each declared verb carries its consumers, and one a person may call is not judged by these lines, which record no person's own terminal", () => {
  const reading = countDoors([line("a", "command", "storytree arc show")], {
    commands: [{ verb: "storytree settings show", consumers: ["user"] }, { verb: "storytree quality brief", consumers: ["agent"] }, { verb: "storytree arc show", consumers: both }],
    tools: [],
  }, new Map(), window);
  const of = (verb: string) => reading.surfaces.find((surface) => surface.verb === verb);
  assert.deepEqual(of("storytree settings show"), { door: "command", verb: "storytree settings show", declared: true, consumers: ["user"], judged: false, calls: 0, sessions: 0 });
  assert.deepEqual(of("storytree quality brief"), { door: "command", verb: "storytree quality brief", declared: true, consumers: ["agent"], judged: true, calls: 0, sessions: 0 });
  assert.equal(of("storytree arc show")?.judged, false, "a verb for both is never judged by the agents' lines alone");
});

test("14.8 · each word refused with hints counts its offers, the offers followed by target, and how often none was taken; a refused or failed next call is no follow", () => {
  const refused = (session: string) => line(session, "command", "storytree adr", { outcome: "unknown", word: "show", next: ["storytree library search", "storytree adr list"] });
  const reading = countDoors([
    refused("a"), line("a", "command", "storytree library search"),
    refused("b"), line("b", "command", "storytree adr list"),
    refused("c"), line("c", "command", "storytree library search"),
    refused("d"), line("d", "command", "storytree library search", { outcome: "refused" }),
    refused("e"), line("e", "command", "storytree adr list", { outcome: "failed", class: "TypeError" }),
    refused("f"), line("f", "tool", "search_notes"),
    refused("g"),
    // A refusal that offered no step is not counted.
    line("h", "command", "storytree", { outcome: "unknown", word: "nope" }),
  ], declared, new Map(), window);
  assert.deepEqual(reading.repoints, [{
    door: "command", where: "storytree adr", word: "show", offered: 7,
    followed: [{ target: "storytree library search", count: 2 }, { target: "storytree adr list", count: 1 }], none: 4,
  }]);
});
