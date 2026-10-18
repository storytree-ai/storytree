/** The command line 15.1–15.4: a reading printed for a person, and the same readings for a script. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { countDoors, type DoorLine } from "./reading.js";
import { doorsJson, doorsTable } from "./table.js";

const agent = ["agent"] as const;
const declared = {
  commands: [{ verb: "storytree arc show", consumers: agent }, { verb: "storytree arc list", consumers: agent }, { verb: "storytree settings show", consumers: ["agent", "user"] as const }],
  tools: [{ verb: "show_plan", consumers: agent }, { verb: "retire", consumers: agent }],
};
const line = (session: string, door: DoorLine["door"], verb: string, at: string, more: Partial<DoorLine> = {}): DoorLine =>
  ({ session, at, door, verb, outcome: "answered", next: [], ...more });
const lines = [
  line("a", "command", "storytree arc show", "2026-09-20T00:00:00.000Z"),
  line("a", "command", "storytree arc show", "2026-10-05T00:00:00.000Z", { next: ["storytree arc list"] }),
  line("a", "command", "storytree arc list", "2026-10-05T00:00:01.000Z"),
  line("b", "command", "storytree arc increment", "2026-10-06T00:00:00.000Z", { outcome: "unknown", word: "show", named: "storytree library read" }),
  line("b", "tool", "show_plan", "2026-10-06T00:00:01.000Z", { outcome: "failed", class: "TypeError" }),
];
const week = countDoors(lines.slice(1), declared, new Map(), { since: "2026-10-01T00:00:00.000Z", until: "2026-10-08T00:00:00.000Z" });
const month = countDoors(lines, declared, new Map(), { since: "2026-09-10T00:00:00.000Z", until: "2026-10-08T00:00:00.000Z" });

/** The table's row for `name`, its words split on runs of spaces. */
function row(table: string, name: string): string[] | undefined {
  return table.split("\n").map((text) => text.trim().split(/\s{2,}/)).find((cells) => cells[0] === name);
}

test("15.1 · every command and tool is printed with its calls and sessions in the short window and the long one beside it, then the misses with the command named", () => {
  const table = doorsTable(week, month);
  assert.deepEqual(row(table, "storytree arc show"), ["storytree arc show", "agent", "1", "1", "2", "1"]);
  assert.deepEqual(row(table, "retire")?.slice(0, 6), ["retire", "agent", "0", "0", "0", "0"], "a tool with no call is printed at zero");
  assert.deepEqual(row(table, "storytree arc increment show"), ["storytree arc increment show", "1", "1", "→ storytree library read"]);
  assert.match(table, /2026-10-01 to 2026-10-08/);
  assert.deepEqual(row(table, "→ storytree arc list"), ["→ storytree arc list", "1", "1", "100%", "–"], "an offered step, its follow rate, and no like-for-like call to set a baseline");
  assert.deepEqual(row(table, "show_plan TypeError"), ["show_plan TypeError", "1", "1"], "failures by class, the short window and the long");
});

test("15.3 · each command and tool is printed with its consumers, and one with no call is marked unused, or not judged when a person may call it", () => {
  const table = doorsTable(week, month);
  assert.deepEqual(row(table, "retire"), ["retire", "agent", "0", "0", "0", "0", "unused"]);
  assert.deepEqual(row(table, "storytree settings show"), ["storytree settings show", "agent, user", "0", "0", "0", "0", "not judged"]);
  assert.match(table, /Not judged: a person may call it, and a person's own terminal writes no line/);
});

test("15.2 · the JSON carries both readings as the reading returns them", () => {
  const { short, long } = JSON.parse(doorsJson(week, month));
  assert.deepEqual([short.since, short.until, long.since], ["2026-10-01T00:00:00.000Z", "2026-10-08T00:00:00.000Z", "2026-09-10T00:00:00.000Z"]);
  assert.equal(short.surfaces.find((surface: { verb: string }) => surface.verb === "storytree arc show").calls, 1);
  assert.equal(long.surfaces.find((surface: { verb: string }) => surface.verb === "storytree arc show").calls, 2, "the long window counts the September call too");
  assert.deepEqual(short.misses.map(({ word, named }: { word: string; named: string }) => [word, named]), [["show", "storytree library read"]]);
});

test("15.4 · each word refused with hints is printed with its offers, the hints followed by target, and how often none was taken", () => {
  const hinted = [
    line("c", "command", "storytree adr", "2026-10-06T00:00:00.000Z", { outcome: "unknown", word: "show", next: ["storytree library search", "storytree adr list"] }),
    line("c", "command", "storytree library search", "2026-10-06T00:00:01.000Z"),
    line("d", "command", "storytree adr", "2026-10-06T00:00:02.000Z", { outcome: "unknown", word: "show", next: ["storytree library search", "storytree adr list"] }),
  ];
  const reading = countDoors(hinted, declared, new Map(), { since: "2026-10-01T00:00:00.000Z", until: "2026-10-08T00:00:00.000Z" });
  assert.deepEqual(row(doorsTable(reading, reading), "↳ storytree adr show"), ["↳ storytree adr show", "2", "storytree library search 1", "1"]);
});
