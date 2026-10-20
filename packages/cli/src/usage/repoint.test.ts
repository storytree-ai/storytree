/** The command line 14.9: the repoint hints a refused word offers, learned from what sessions ran next after it. */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { DoorLine } from "./reading.js";
import { learnedTargets, repointHints } from "./repoint.js";

let at = 0;
function line(session: string, verb: string, more: Partial<DoorLine> = {}): DoorLine {
  at += 1;
  return { session, at: new Date(Date.parse("2026-10-01T00:00:00.000Z") + at * 1000).toISOString(), door: "command", verb, outcome: "answered", next: [], ...more };
}
const refused = (session: string) => line(session, "storytree adr", { outcome: "unknown", word: "show" });

test("14.9 · a refused word learns the commands sessions ran next after it, answered, most often first; a refused, failed or tool next call teaches nothing", () => {
  const learned = learnedTargets([
    refused("a"), line("a", "storytree library search"),
    refused("b"), line("b", "storytree adr list"),
    refused("c"), line("c", "storytree library search"),
    refused("d"), line("d", "storytree adr pull", { outcome: "refused" }),
    refused("e"), line("e", "storytree adr pull", { outcome: "failed" }),
    refused("f"), line("f", "search_notes", { door: "tool" }),
    // The same word refused elsewhere is another word.
    line("g", "storytree arc", { outcome: "unknown", word: "show" }), line("g", "storytree arc show"),
  ], "storytree adr", "show");
  assert.deepEqual(learned, [{ verb: "storytree library search", count: 2 }, { verb: "storytree adr list", count: 1 }]);
});

test("14.9 · a guess offers at most three hints, learned first, then hand-picked, then by spelling, in an order that rotates", () => {
  const hint = (command: string) => ({ command, why: command });
  const candidates = { learned: [hint("library search"), hint("adr list")], handPicked: hint("adr pull"), spelled: [hint("adr new"), hint("adr list")] };
  const orders = [0, 1, 2].map((turn) => repointHints({ ...candidates, turn }).map(({ command }) => command));
  assert.deepEqual(orders, [
    ["library search", "adr list", "adr pull"],
    ["adr list", "adr pull", "library search"],
    ["adr pull", "library search", "adr list"],
  ], "each hint takes each position in turn");
});

test("14.9 · a mistake leads with the right command for its job, whatever the turn, and offers two more", () => {
  const hint = (command: string) => ({ command, why: command });
  for (const turn of [0, 1, 2]) {
    const offered = repointHints({ right: hint("library read"), learned: [hint("library read"), hint("library search")], spelled: [hint("arc show"), hint("arc list")], turn });
    assert.equal(offered[0]?.command, "library read");
    assert.deepEqual(new Set(offered.slice(1).map(({ command }) => command)), new Set(["library search", "arc show"]));
  }
});

test("14.9 · the hand-picked command keeps a place among the three, whatever the turn, however many commands were learned", () => {
  const hint = (command: string) => ({ command, why: command });
  for (const turn of [0, 1, 2]) {
    const guessed = repointHints({ learned: [hint("capability"), hint("library read"), hint("map")], handPicked: hint("tree"), spelled: [], turn });
    const mistaken = repointHints({ right: hint("capability"), learned: [hint("capability"), hint("library read"), hint("map")], handPicked: hint("tree"), spelled: [], turn });
    assert.ok(guessed.some(({ command }) => command === "tree"), `turn ${turn}: ${guessed.map(({ command }) => command).join(", ")}`);
    assert.equal(guessed.length, 3);
    assert.ok(mistaken.some(({ command }) => command === "tree"), `turn ${turn}: ${mistaken.map(({ command }) => command).join(", ")}`);
    assert.equal(mistaken[0]?.command, "capability");
  }
});
