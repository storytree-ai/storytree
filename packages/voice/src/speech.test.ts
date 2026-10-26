/** Capability 3 · The speech layer, contracts 3.1-3.4: spoken handles resolved through tell_me, on the door run against a stand-in command line. */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Client } from "@modelcontextprotocol/client";

import { pages, parseHandle, speaksAnId, spokenNumber } from "./speech.js";
import { childrenIn, connect, gitRepo, testDoor, textOf, type TestDoor } from "./testing/door.js";

const repo = gitRepo({ "readme.txt": "a repository for the door\n" });
after(() => repo.remove());

/** A tell_me call on a door of its own, with the commands its children ran. */
const tellMe = (args: Record<string, unknown>) => call("tell_me", args);

/** One tool call on a door of its own, with the commands its children ran. */
async function call(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean; commands: string[][] }> {
  const door = await testDoor(repo.dir);
  const client = await connect(door.port, door.token);
  try {
    const result = (await client.callTool({ name, arguments: args })) as { content?: unknown; isError?: boolean };
    return { text: textOf(result), isError: result.isError === true, commands: childrenIn(door.cliLog).commands };
  } finally {
    await client.close();
    await door.close();
  }
}
/** The records read whole (catch_up's own read of several questions, for their Created times, is not one). */
const reads = (commands: string[][]) => commands.filter(([family, verb]) => (family === "library" && verb === "read") || (family === "question" && verb === "show")).filter((command) => command.length === 3);

test("3.1 · a number said as words or digits is that number, however it is grouped aloud", () => {
  const said: Array<[string, number]> = [
    ["eleven-oh-three", 1103], ["eleven oh three", 1103], ["one one oh three", 1103], ["eleven hundred and three", 1103],
    ["one thousand one hundred three", 1103], ["seventeen twenty-three", 1723], ["seventeen twenty three", 1723], ["1103", 1103],
    ["nine forty", 940], ["two", 2], ["twenty", 20], ["two thousand and five", 2005],
  ];
  for (const [words, number] of said) assert.equal(spokenNumber(words), number, words);
  for (const words of ["the voice decision", "eleven apples", ""]) assert.equal(spokenNumber(words), undefined, words);
  assert.deepEqual(parseHandle("decision eleven-oh-three"), { kind: "decision", number: 1103 });
  assert.deepEqual(parseHandle("ADR-1103"), { kind: "decision", number: 1103 });
  assert.deepEqual(parseHandle("decision number eleven oh three"), { kind: "decision", number: 1103 });
  assert.deepEqual(parseHandle("pull request seventeen twenty-three"), { kind: "pull request", number: 1723 });
  assert.deepEqual(parseHandle("PR #1723"), { kind: "pull request", number: 1723 });
});

test("3.1 · tell_me reads the decision a spoken number names, and the work a spoken pull request landed", async () => {
  const decision = await tellMe({ handle: "decision eleven-oh-three" });
  assert.deepEqual(reads(decision.commands), [["library", "read", "decision_0000000011a3"]]);
  // The stand-in's recent work landed as #1101 (increment_…065) among others.
  const pr = await tellMe({ handle: "pull request eleven-oh-one" });
  assert.deepEqual(reads(pr.commands), [["library", "read", "increment_000000000065"]]);
  const none = await tellMe({ handle: "decision ninety-nine ninety-nine" });
  assert.equal(none.isError, true);
  assert.match(none.text, /no decision is numbered 9999/);
  assert.deepEqual(reads(none.commands), []);
});

test("3.2 · \"number two\", \"the second one\" and \"item 2\" name catch_up's number 2, and a position past its last refuses", async () => {
  // catch_up's fixed order on the stand-in: the owner's two waits (…a1, …a2), then the questions oldest first.
  for (const handle of ["number two", "the second one", "item 2", "2nd"]) {
    assert.deepEqual(reads((await tellMe({ handle })).commands), [["library", "read", "increment_0000000000a2"]], handle);
  }
  assert.deepEqual(reads((await tellMe({ handle: "number five" })).commands), [["question", "show", "question_0000000000c1"]]);
  const past = await tellMe({ handle: "number forty" });
  assert.equal(past.isError, true);
  assert.match(past.text, /catch_up numbers 13 items/);
  assert.deepEqual(reads(past.commands), []);
});

test("3.3 · two or more matches answer \"which one?\" with at most three names, read none, and speak no id", async () => {
  // Every recent landing on the stand-in is titled "Work n.m landed".
  const many = await tellMe({ handle: "the work that landed" });
  assert.equal(many.isError, false);
  const offered = many.text.split("\n").filter((line) => /^\d+\. /.test(line));
  assert.equal(offered.length, 3);
  assert.ok(many.text.split("\n").every((line) => !speaksAnId(line)), many.text);
  assert.deepEqual(reads(many.commands), []);
  // A bare "three" is both catch_up's number 3 and decision 3.
  const both = await tellMe({ handle: "three" });
  assert.equal(both.text.split("\n").filter((line) => /^\d+\. /.test(line)).length, 2, both.text);
  assert.deepEqual(reads(both.commands), []);
  // One match is read: open questions are matched by title words.
  assert.deepEqual(reads((await tellMe({ handle: "the question about the secret address" })).commands), [["question", "show", "question_0000000000c1"]]);
  assert.deepEqual(reads((await tellMe({ handle: "watcher" })).commands), [["library", "read", "definition_0000000000f2"]]);
});

test("3.4 · an answer is at most 2,000 words a page, with \"say more\" pages, and speaks no id but its own at the last line's end", async () => {
  const first = await tellMe({ handle: "question_0000000000c1" });
  const second = await tellMe({ handle: "question_0000000000c1", page: 2 });
  for (const page of [first, second]) {
    const lines = page.text.split("\n");
    const spoken = lines.slice(0, -1).join(" ").split(/\s+/).filter(Boolean);
    assert.ok(spoken.length <= 2000, `${spoken.length} words`);
    assert.ok(lines.every((line) => !speaksAnId(line)), page.text);
    assert.match(lines.at(-1)!, / — question_0000000000c1$/);
  }
  assert.match(first.text.split("\n").at(-1)!, /page 2/);
  assert.ok(first.text.split(/\s+/).length > 1500, "a long record's first page carries well over 200 words");
  assert.notEqual(first.text, second.text);
  const beyond = await tellMe({ handle: "question_0000000000c1", page: 9 });
  assert.equal(beyond.isError, true);
  const record = await tellMe({ handle: "decision three" });
  assert.ok(record.text.split("\n").every((line) => !speaksAnId(line)), record.text);
  assert.match(record.text, /^decision: The decision numbered 3$/m);
  // Paging alone: no page over the limit, nothing lost.
  const text = Array.from({ length: 4500 }, (_, at) => `w${at}`).join(" ");
  const cut = pages(text);
  assert.deepEqual(cut.map((page) => page.split(/\s+/).length), [2000, 2000, 500]);
  assert.equal(cut.join(" ").split(/\s+/).length, 4500);
});

test("3.5 · a parked arc named by its words lists its open increments numbered a page at a time, and \"number two\" on it reads that increment whole", async () => {
  const first = await call("list_work", { arc: "the hardening arc" });
  assert.equal(first.isError, false, first.text);
  const numbered = (text: string) => text.split("\n").filter((line) => /^\d+\. /.test(line));
  assert.deepEqual(numbered(first.text).map((line) => line.split(".")[0]), ["1", "2", "3", "4", "5", "6", "7", "8"]);
  assert.match(numbered(first.text)[0]!, /^1\. Hardening step 1 — increment_000000000401$/);
  // A wait is read as arc show writes it, its ids left unspoken.
  assert.match(numbered(first.text)[2]!, /^3\. Hardening step 3; waits on: Plan order from the security audit: step 2 first\. — increment_000000000403$/);
  assert.ok(first.text.split("\n").every((line) => !speaksAnId(line)), first.text);
  assert.match(first.text, /20 open/);
  assert.match(first.text.split("\n").at(-1)!, /page 2/);
  assert.deepEqual(first.commands.filter(([family, verb]) => family === "arc" && verb === "show"), [["arc", "show", "arc_0000000000b4"]]);

  const second = await call("list_work", { arc: "the hardening arc", page: 2 });
  assert.match(numbered(second.text)[0]!, /^9\. Hardening step 9 — increment_000000000409$/);
  const last = await call("list_work", { arc: "arc_0000000000b4", page: 3 });
  assert.deepEqual(numbered(last.text).map((line) => line.split(".")[0]), ["17", "18", "19", "20"]);
  assert.match(last.text.split("\n").at(-1)!, /the last/);
  assert.equal((await call("list_work", { arc: "the hardening arc", page: 4 })).isError, true);

  for (const handle of ["number two", "the second one", "2"]) {
    const two = await tellMe({ handle, arc: "the hardening arc" });
    assert.deepEqual(reads(two.commands), [["library", "read", "increment_000000000402"]], handle);
  }
  const past = await tellMe({ handle: "number twenty-one", arc: "the hardening arc" });
  assert.equal(past.isError, true);
  assert.match(past.text, /20 open increments/);
  // A closed arc is not named; nothing outside the reads the confined door's role is granted (4.3) is run.
  const closed = await call("list_work", { arc: "the old release process arc" });
  assert.equal(closed.isError, true, closed.text);
  const granted = new Set(["arc list", "arc show", "library read", "library find", "question list", "arc recent", "arc waits", "library list"]);
  for (const ran of [...first.commands, ...past.commands, ...closed.commands]) assert.ok(granted.has(`${ran[0]} ${ran[1]}`), ran.join(" "));
});

test("3.3 · title words name a parked arc as they name an active one, and never a closed one", async () => {
  // The stand-in's arcs hold "Hardening before the public launch" (parked) and "Hardening the old release process" (closed).
  const arc = await tellMe({ handle: "the hardening arc" });
  assert.equal(arc.isError, false, arc.text);
  assert.deepEqual(reads(arc.commands), [["library", "read", "arc_0000000000b4"]]);
});
