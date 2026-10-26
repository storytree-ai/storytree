/** The MCP server 8.1–8.3: its own tools' use, counted from one window of the tool door's door-answered lines. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { readToolUse, type ToolLine } from "./tool-use.js";

const served = ["show_plan", "search_notes", "retire"].map((verb) => ({ verb, consumers: ["agent"] as const }));
const line = (session: string, verb: string, more: Partial<ToolLine> = {}): ToolLine => ({ session, verb, outcome: "answered", ...more });

test("8.1 · every served tool is counted with its calls, sessions and consumers, those with none at zero and an unserved tool apart; one a person may call is not judged", () => {
  const use = readToolUse([
    line("a", "show_plan"),
    line("a", "show_plan"),
    line("b", "show_plan"),
    line("b", "made_up_tool"),
  ], [...served, { verb: "settings", consumers: ["agent", "user"] }]);
  const of = (verb: string) => use.surfaces.find((surface) => surface.verb === verb);
  assert.deepEqual(of("show_plan"), { door: "tool", verb: "show_plan", declared: true, consumers: ["agent"], judged: true, calls: 3, sessions: 2 });
  assert.deepEqual(of("retire"), { door: "tool", verb: "retire", declared: true, consumers: ["agent"], judged: true, calls: 0, sessions: 0 });
  assert.equal(of("settings")?.judged, false, "a person's own calls write no line, so its zero is no sign it went unused");
  assert.deepEqual(of("made_up_tool"), { door: "tool", verb: "made_up_tool", declared: false, judged: true, calls: 1, sessions: 1 });
  assert.deepEqual(use.surfaces.map((surface) => surface.verb), ["show_plan", "retire", "search_notes", "settings", "made_up_tool"], "most used first, the unserved last");
  assert.equal(use.calls, 4);
});

test("8.2 · each tool name refused as unknown is counted with what the refusal named, and the door's unknowns per 1,000 calls", () => {
  const use = readToolUse([
    line("a", "show_plan"),
    line("a", "plan", { outcome: "unknown", word: "plan", named: "show_plan" }),
    line("b", "plan", { outcome: "unknown", word: "plan", named: "show_plan" }),
    line("b", "lsit", { outcome: "unknown", word: "lsit" }),
  ], served);
  assert.deepEqual(use.misses, [
    { door: "tool", where: "plan", word: "plan", named: "show_plan", count: 2 },
    { door: "tool", where: "lsit", word: "lsit", count: 1 },
  ]);
  assert.equal(use.unknownPer1000, 750);
  assert.equal(readToolUse([], served).unknownPer1000, null, "no calls, no rate");
});

test("8.3 · tool failures are counted by class, apart from refusals by design", () => {
  const use = readToolUse([
    line("a", "show_plan", { outcome: "failed", class: "TypeError" }),
    line("b", "show_plan", { outcome: "failed", class: "TypeError" }),
    line("b", "retire", { outcome: "failed" }),
    line("b", "retire", { outcome: "refused" }),
  ], served);
  assert.deepEqual(use.failures, [
    { door: "tool", verb: "show_plan", class: "TypeError", count: 2 },
    { door: "tool", verb: "retire", class: "unnamed", count: 1 },
  ]);
  assert.deepEqual(use.refusals, [{ door: "tool", verb: "retire", count: 1 }]);
});
