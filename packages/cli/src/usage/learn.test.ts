/** The command line 14.10 and 14.11: what the doors learn from 28 days of their own lines. */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { DoorLine } from "./reading.js";
import { learnDoors, TOOLS_ALONE, type Surfaces } from "./learn.js";

const SINCE = "2026-10-01T00:00:00.000Z";
let at = 0;
function line(session: string, verb: string, more: Partial<DoorLine> = {}): DoorLine {
  at += 1;
  return { session, at: new Date(Date.parse(SINCE) + at * 1000).toISOString(), door: "command", verb, outcome: "answered", next: [], ...more };
}
const agent = ["agent"] as const;
const surfaces: Surfaces = {
  commands: [
    { verb: "storytree adr pull", consumers: agent },
    { verb: "storytree adr list", consumers: agent },
    { verb: "storytree quality graduate", consumers: agent },
    { verb: "storytree quality ledger", consumers: agent },
    { verb: "storytree quality brief", consumers: agent },
    { verb: "storytree processes stop", consumers: agent },
    { verb: "storytree setup uninstall", consumers: ["agent", "user"] },
  ],
  tools: [
    { verb: "quality_brief", consumers: agent },
    { verb: "stop_own_run", consumers: agent },
    { verb: "check_setup", consumers: agent },
    { verb: "focus", consumers: agent },
  ],
  twins: [{ command: "storytree quality brief", tool: "quality_brief" }, { command: "storytree processes stop", tool: "stop_own_run" }],
};

/** `count` refusals of `word` in `where`, each in its own session, each followed by that session's next call when given. */
function refusals(where: string, word: string, count: number, next?: (index: number) => DoorLine | undefined): DoorLine[] {
  return Array.from({ length: count }, (_, index) => {
    const session = `${word}-${index}`;
    const after = next?.(index);
    return [line(session, where, { outcome: "unknown", word, next: ["storytree adr pull", "storytree adr list"] }), ...(after === undefined ? [] : [{ ...after, session }])];
  }).flat();
}

test("14.10 · a word refused at least 10 times in one place whose follows stay below the pointer bar is a want; a tool's name, stray text, a rarer word and one above the bar are not", () => {
  const lesson = learnDoors([
    // Ten refusals, followed only three times: a want.
    ...refusals("storytree friction", "list", 10, (index) => (index < 3 ? line("", "storytree adr pull") : undefined)),
    // Twelve refusals, eight follows from eight sessions all to one command: above the bar, a pointer's, not a want.
    ...refusals("storytree adr", "show", 12, (index) => (index < 8 ? line("", "storytree adr pull") : undefined)),
    // Eleven refusals, the follows split across two commands, below the 70% share: a want.
    ...refusals("storytree", "plan", 11, (index) => (index < 10 ? line("", index % 2 === 0 ? "storytree adr pull" : "storytree adr list") : undefined)),
    // A follow that was itself refused is no follow.
    ...refusals("storytree", "board", 10, () => line("", "storytree adr pull", { outcome: "refused" })),
    // Nine refusals: too few.
    ...refusals("storytree", "contract", 9),
    // A tool's name typed as a command is a mistake, kept as a refusal naming the command.
    ...refusals("storytree", "focus", 15),
    // Text that strayed into a command's place is no command's name.
    ...refusals("storytree", "he said \"a b\"", 12),
  ], surfaces, SINCE);
  assert.deepEqual(lesson.wants.map(({ where, word, refusals: count, sessions }) => [where, word, count, sessions]), [
    ["storytree", "plan", 11, 11],
    ["storytree", "board", 10, 10],
    ["storytree friction", "list", 10, 10],
  ]);
  assert.deepEqual(lesson.wants.find(({ word }) => word === "plan")?.followed, [{ target: "storytree adr list", count: 5 }, { target: "storytree adr pull", count: 5 }]);
  assert.deepEqual(lesson.wants.find(({ word }) => word === "board")?.followed, []);
});

test("14.11 · an agent-only verb with no call across 100 sessions in a covered window is a cut candidate by family; a twin unused in one door only is a gap, and a short or thin window cuts nothing", () => {
  const busy = Array.from({ length: 100 }, (_, index) => line(`s${index}`, index % 2 === 0 ? "storytree adr pull" : "storytree adr list"));
  const lines = [...busy, line("t", "storytree processes stop"), line("t", "storytree processes stop"), line("u", "focus", { door: "tool" })];
  const lesson = learnDoors(lines, surfaces, SINCE);
  assert.deepEqual(lesson.cuts, [
    { group: "storytree quality", verbs: [{ command: "storytree quality brief", tool: "quality_brief" }, { command: "storytree quality graduate" }, { command: "storytree quality ledger" }] },
    { group: TOOLS_ALONE, verbs: [{ tool: "check_setup" }] },
  ], "a verb a person may call is never a candidate, and a verb called once is not one");
  assert.deepEqual(lesson.gaps, [{ unused: "stop_own_run", carriedBy: "storytree processes stop", calls: 2 }]);

  const late = lines.map((one) => ({ ...one, at: new Date(Date.parse(one.at) + 2 * 24 * 60 * 60 * 1000).toISOString() }));
  assert.equal(learnDoors(late, surfaces, SINCE).cuts, undefined, "lines that begin after the window's first day cannot judge disuse");
  assert.equal(learnDoors(lines.slice(3), surfaces, SINCE).cuts, undefined, "99 sessions are too few");
});
