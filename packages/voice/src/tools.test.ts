/** Capability 2 · The read tools, contracts 2.1-2.19: the door run in-process against a stand-in command line and a throwaway git repository. */
import assert from "node:assert/strict";
import { rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import type { Client } from "@modelcontextprotocol/client";

import { OLD_NAMES, TOOL_NAMES } from "./tools.js";
import { childrenIn, connect, gitRepo, namesOnlyListedTools, seen, testDoor, textOf, type TestDoor } from "./testing/door.js";

const lines = (count: number, make: (n: number) => string) => Array.from({ length: count }, (_, at) => make(at + 1)).join("\n") + "\n";

const repo = gitRepo({
  "notes.txt": "committed line\n",
  "swap.txt": "the committed swap file\n",
  "many.ts": lines(8, (n) => `const needle${n} = ${n};`),
  ...Object.fromEntries(Array.from({ length: 14 }, (_, at) => [`bulk/f${String(at + 1).padStart(2, "0")}.txt`, lines(5, (n) => `bulk needle ${n}`)])),
  "long.txt": `wide needle ${"w".repeat(600)}\n`,
  "dash.txt": "run it with --output=x here\n",
  "-lead.txt": "a file whose name starts with a dash\n",
  "big.txt": lines(400, (n) => `line ${n}`),
  "wide.txt": lines(100, (n) => `${n} ${"x".repeat(200)}`),
  "folder/inner.txt": "inside\n",
  "binary.bin": Buffer.from([0x89, 0x50, 0x00, 0x00, 0x01, 0x02]),
  "huge.txt": "h".repeat(5_100_000),
});
// A committed symbolic link, made through the index so it is one on every platform.
const linkBlob = repo.git("rev-parse", "HEAD:notes.txt").trim();
repo.git("update-index", "--add", "--cacheinfo", `120000,${linkBlob},link.txt`);
repo.git("commit", "-q", "-m", "a link");
// Left uncommitted: an edit, a staged-only file, and (where the platform allows) a link swapped in for a tracked file.
writeFileSync(path.join(repo.dir, "notes.txt"), "committed line\nWORKTREE_ONLY_SECRET\n");
writeFileSync(path.join(repo.dir, "staged.txt"), "STAGED_ONLY_SECRET\n");
repo.git("add", "staged.txt");
let swapped = false;
try {
  rmSync(path.join(repo.dir, "swap.txt"));
  symlinkSync(path.join(repo.dir, "staged.txt"), path.join(repo.dir, "swap.txt"));
  swapped = true;
} catch {
  // Windows without the right to make links: the swap is not possible there, so neither is the attack.
}

let door: TestDoor;
let client: Client;
before(async () => {
  door = await testDoor(repo.dir);
  client = await connect(door.port, door.token);
});
after(async () => {
  await client.close();
  await door.close();
  await repo.remove();
});

const call = async (name: string, args: Record<string, unknown> = {}) => (await client.callTool({ name, arguments: args })) as { content?: unknown; isError?: boolean };
/** Calls on a door of their own, to see that they start no child. */
async function alone(body: (client: Client, door: TestDoor) => Promise<void>): Promise<void> {
  const own = await testDoor(repo.dir);
  const ownClient = await connect(own.port, own.token);
  try {
    await body(ownClient, own);
  } finally {
    await ownClient.close();
    await own.close();
  }
}
const refusedWithoutChild = async (name: string, inputs: Array<Record<string, unknown>>) =>
  alone(async (own, ownDoor) => {
    for (const args of inputs) {
      const result = await own.callTool({ name, arguments: args });
      assert.equal(result.isError, true, `${name} ${JSON.stringify(args).slice(0, 80)}: ${textOf(result as never).slice(0, 200)}`);
    }
    assert.equal(childrenIn(ownDoor.cliLog).started, 0, "a child started");
  });

test("2.1 tools/list offers exactly the read tools, each read-only and not destructive, to 2025-era and 2026-07-28 clients alike", async () => {
  const modern = await connect(door.port, door.token, { versionNegotiation: { mode: { pin: "2026-07-28" } } } as never);
  try {
    for (const each of [client, modern]) {
      const { tools } = await each.listTools();
      assert.deepEqual(tools.map((tool) => tool.name).sort(), [...TOOL_NAMES, ...Object.keys(OLD_NAMES)].sort());
      for (const tool of tools) {
        assert.equal(tool.annotations?.readOnlyHint, true, tool.name);
        assert.equal(tool.annotations?.destructiveHint, false, tool.name);
      }
    }
  } finally {
    await modern.close();
  }
});

test("2.18 · each of the spike's old tool names answers what its new tool answers, so a connector holding the old tool list keeps working", async () => {
  const pairs: Array<[string, string, Record<string, unknown>]> = [
    ["open_questions", "catch_up", {}],
    ["search_library", "find", { query: "voice door" }],
    ["search_library", "find", { query: "seven hits" }],
    ["read_code_file", "read_code", { path: "big.txt", start_line: 3, end_line: 9 }],
    ["show_question", "tell_me", { id: "Question_0000 0000 00C1" }],
    ["read_note", "tell_me", { id: "ADR-3" }],
  ];
  assert.deepEqual(Object.fromEntries(pairs.map(([old, now]) => [old, now])), OLD_NAMES);
  for (const [old, now, args] of pairs) {
    const answer = await call(old, args);
    assert.notEqual(answer.isError, true, `${old}: ${textOf(answer)}`);
    assert.ok(textOf(answer).length > 0, old);
    // show_question and read_note took an id, which tell_me takes as its handle.
    const asNew = now === "tell_me" ? { handle: args.id } : args;
    assert.deepEqual(answer.content, (await call(now, asNew)).content, `${old} ${JSON.stringify(args)}`);
  }
  const { tools } = await client.listTools();
  for (const [old, now] of Object.entries(OLD_NAMES)) assert.match(tools.find((tool) => tool.name === old)?.description ?? "", new RegExp(`old name for ${now}`), old);
});

test("2.2 catch_up gives what needs the owner's action, then his open questions oldest first, then what landed, numbered, each id at the line's end, then the FYIs he has not heard; its action list closes with how many waits for him it left out on parked arcs", async () => {
  const text = textOf(await call("catch_up", { since: "2h" }));
  const heads = ["Needs your action:", "Needs your decision (oldest first):", "Landed since 2026-10-22 10:00 UTC:", "FYIs, until you have heard them:"].map((head) => text.indexOf(head));
  assert.ok(heads.every((at) => at >= 0) && heads[0]! < heads[1]! && heads[1]! < heads[2]! && heads[2]! < heads[3]!, text);
  // Unnumbered, oldest first, each with when, what happened and its id at the line's end.
  assert.deepEqual(text.slice(heads[3]).split("\n").slice(1), [
    "The secret-check exemptions list changed (2026-10-26 09:00): Two paths were added to the exemptions. (about PR #1801, by session:abc) — fyi_0000000000f1",
    "The box restarted overnight (2026-10-27 06:00): Postgres came back on its own. (about the Mint box, by watcher) — fyi_0000000000f2",
  ]);
  const numbered = text.split("\n").filter((line) => /^\d+\. /.test(line));
  assert.deepEqual(numbered.map((line) => Number(/^(\d+)\./.exec(line)![1])), numbered.map((_, at) => at + 1));
  for (const line of numbered) assert.match(line, / — [a-z]+_[0-9a-f]{12}$/);
  const ids = numbered.map((line) => / — (\S+)$/.exec(line)![1]);
  // The owner's two waits (the event wait is not his), the questions oldest first, then the first 8 of 25 landings.
  assert.deepEqual(ids.slice(0, 5), ["increment_0000000000a1", "increment_0000000000a2", "question_0000000000c3", "question_0000000000c2", "question_0000000000c1"]);
  assert.equal(ids.length, 5 + 8);
  assert.match(text, /\(17 more; what_changed lists them all\)/);
  assert.match(numbered[0]!, /^1\. Feedback corner: PR #1656 is still red/);
  const action = text.slice(heads[0], heads[1]).trim().split("\n");
  assert.equal(action.at(-1), "(20 more wait on parked arcs until they are unparked, not his to take now)", text);
});

test("2.2 catch_up refuses a since it cannot pass on, before any child runs", async () => {
  await refusedWithoutChild("catch_up", [{ since: "--all" }, { since: "yesterday; rm" }, { since: "2 weeks" }]);
});

test("2.19 · the instructions a client gets on connect lead with catch_up and name no tool tools/list does not offer", async () => {
  await namesOnlyListedTools(client);
  const instructions = client.getInstructions() ?? "";
  assert.match(instructions, /Nothing here changes/);
  // ADR-1184 D1: each question as what part of the system, why it needs him, then the recommended option alone.
  assert.match(instructions, /what part of the system it is about, why it needs him, then the recommended option with its reason and the ask/);
  assert.match(instructions, /other options only when he asks for them or turns the recommendation down/);
  assert.doesNotMatch(instructions, /both sides of each option/);
});

test("2.6 find returns at most 5 records closest in meaning, one line each with kind, title and record id", async () => {
  const text = textOf(await call("find", { query: "seven hits" }));
  assert.deepEqual(text.split("\n"), Array.from({ length: 5 }, (_, at) => `${at + 1}. principle: Principle number ${at + 1} — note_${(at + 1).toString(16).padStart(12, "0")}`));
});

test("2.7 find passes its query as words only, and refuses an empty, over-long or NUL query before any child", async () => {
  assert.deepEqual(seen(await call("find", { query: "--limit 99" })).argv, ["library", "search", "--limit", "5", "--", "--limit 99"]);
  assert.ok(childrenIn(door.cliLog).commands.some((argv) => JSON.stringify(argv) === JSON.stringify(["library", "find", "--", "--limit 99"])), "the title lookup took the query as a flag");
  await refusedWithoutChild("find", [{ query: "" }, { query: "   " }, { query: "x".repeat(501) }, { query: "a\u0000b" }]);
});

test("2.15 · tell_me reads one thing whole: a question with its stakes, recommendation and options, a decision by number, an arc, a pull request's work, a term", async () => {
  const question = textOf(await call("tell_me", { handle: "question_0000000000c1" }));
  assert.match(question, /^Question: Newest: keep the secret address alone\?/);
  assert.match(question, /Stakes:/);
  const options = textOf(await call("tell_me", { handle: "question_0000000000c1", page: 2 }));
  assert.match(options, /\(a\) Keep it\. Good: nothing to do\. Bad: anyone with the address\.\n\(b\) Sign in\. Good: tied to you\. Bad: setup\./);
  // ADR-1184 D1: the recommendation is read straight after the stakes, before the options.
  assert.match(`${question}\n${options}`, /Stakes:[\s\S]*\nRecommendation:\n\(b\): the address alone[\s\S]*\nOptions:\n/);
  const decision = textOf(await call("tell_me", { handle: "ADR 3" }));
  assert.match(decision, /^decision: The decision numbered 3\n/);
  assert.match(decision, /^text: Open questions are mirrored to Drive\.$/m);
  assert.match(decision, /^pr: 1723$/m);
  assert.match(decision, / — decision_000000000003$/);
  for (const [handle, id] of [["stability and testing", "arc_0000000000b3"], ["pull request 1101", "increment_000000000065"], ["the term owner question", "definition_0000000000f1"]] as const) {
    assert.match(textOf(await call("tell_me", { handle })), new RegExp(` — ${id}$`), handle);
  }
  await refusedWithoutChild("tell_me", [{ handle: "" }, { handle: "x".repeat(301) }, { handle: "number two", since: "--all" }]);
});

test("2.16 · count gives the library's tallies by kind and status and the arcs with the most open increments, each arc's id at its line's end", async () => {
  const text = textOf(await call("count"));
  assert.match(text, /^ {2}decision {11}503: accepted 491, proposed 12$/m);
  assert.match(text, /^ {2}86 open: Hardening before the public launch — arc_bfbc3b617d69$/m);
  await alone(async (own, ownDoor) => {
    await own.callTool({ name: "count", arguments: { query: "select * from records" } });
    assert.deepEqual(childrenIn(ownDoor.cliLog).commands, [["library", "count"]]);
  });
});

test("2.17 · find gives title matches first, at most 5, and searches by meaning only when no title holds the words", async () => {
  const titled = textOf(await call("find", { query: "voice door" })).split("\n");
  assert.deepEqual(titled.slice(0, 5), Array.from({ length: 5 }, (_, at) => `${at + 1}. increment: Voice door step ${at + 1} — increment_${(0xf00 + at).toString(16).padStart(12, "0")}`));
  assert.match(titled[5]!, /2 more titles hold those words/);
  assert.equal(titled.length, 6);
  // No title holds "seven hits": the meaning search answers (2.6).
  assert.match(textOf(await call("find", { query: "seven hits" })), /^1\. principle: Principle number 1/);
});

test("2.8 what_changed over a span lists what landed by arc with pull requests, at most 20 rows, and refuses a span not on its list", async () => {
  const text = textOf(await call("what_changed", { span: "last 7 days" }));
  const rows = text.split("\n").filter((line) => /^\s+\d+\. /.test(line));
  assert.equal(rows.length, 20);
  assert.match(rows[0]!, /^ {2}1\. Work 1\.1 landed \(#1101\) — increment_[0-9a-f]{12}$/);
  assert.ok(text.indexOf("Arc number 1:") < text.indexOf("Arc number 2:"), text);
  assert.match(text, /\(5 more not shown/);
  assert.ok(!text.includes("An arc that closed"), "the closed arcs section came through");
  const refused = await call("what_changed", { span: "fortnight" });
  assert.equal(refused.isError, true);
  assert.match(textOf(refused), /last hour, last 24 hours, last 3 days, last 7 days/);
});

test("2.9 what_changed with a record id gives its history newest first, at most 20 entries, each with when, who and what", async () => {
  const text = textOf(await call("what_changed", { id: "arc_7c7b7f22a027" }));
  const entries = text.split("\n").filter((line) => /^\d+\. /.test(line));
  assert.equal(entries.length, 20);
  assert.equal(entries[0], "1. 2026-10-25T09:00:00.000Z updated by session:writer-25");
  assert.equal(entries[19], "20. 2026-10-06T09:00:00.000Z updated by session:writer-6");
  assert.match(text, /5 older entries not shown/);
  await refusedWithoutChild("what_changed", [{ id: "not an id" }, { id: "arc_7c7b7f22a027", span: "last hour" }]);
});

test("2.10 search_code finds exact text in HEAD only, at most 60 lines and 5 per file, each cut to 300 characters, saying when more were left out", async () => {
  const head = textOf(await call("search_code", { text: "_SECRET" }));
  assert.equal(head, 'No committed file contains "_SECRET".');
  assert.match(textOf(await call("search_code", { text: "committed line" })), /^notes\.txt:1:committed line$/m);
  assert.equal(textOf(await call("search_code", { text: "needle.*" })), 'No committed file contains "needle.*".');

  const many = textOf(await call("search_code", { text: "needle", path_prefix: "many.ts" })).split("\n");
  assert.equal(many.filter((line) => line.startsWith("many.ts:")).length, 5);

  const all = textOf(await call("search_code", { text: "needle" })).split("\n");
  assert.equal(all.filter((line) => /^\S+:\d+:/.test(line)).length, 60);
  assert.match(all.at(-1)!, /more matches; narrow with path_prefix/);
  const wide = textOf(await call("search_code", { text: "wide needle" })).split("\n")[1]!;
  assert.equal(wide.length, 301);
  assert.ok(wide.endsWith("…"));
});

test("2.11 the code tools refuse absolute, home, drive, '..' and escaping paths and empty or multi-line text; a leading '-' is text or a path, never a git option", async () => {
  await alone(async (own, ownDoor) => {
    const hostile = ["/etc/passwd", "~/x", "C:\\Windows\\win.ini", "../x", "a\\..\\..\\b", "a/../../b", path.join(repo.dir, "notes.txt")];
    for (const wanted of hostile) {
      assert.equal((await own.callTool({ name: "read_code", arguments: { path: wanted } })).isError, true, wanted);
      assert.equal((await own.callTool({ name: "search_code", arguments: { text: "x", path_prefix: wanted } })).isError, true, wanted);
    }
    for (const text of ["", "  ", "two\nlines"]) assert.equal((await own.callTool({ name: "search_code", arguments: { text } })).isError, true, JSON.stringify(text));
    assert.equal(childrenIn(ownDoor.cliLog).started, 0);
  });
  assert.match(textOf(await call("search_code", { text: "--output=x" })), /^dash\.txt:1:run it with --output=x here$/m);
  assert.match(textOf(await call("search_code", { text: "a file whose", path_prefix: "-lead.txt" })), /^-lead\.txt:1:/m);
  assert.match(textOf(await call("read_code", { path: "-lead.txt" })), /^1: a file whose name starts with a dash$/m);
});

test("2.12 read_code returns up to 300 numbered lines, at most 15,000 characters, as committed, from start_line, saying where to continue when it cut", async () => {
  assert.equal(textOf(await call("read_code", { path: "notes.txt" })), "notes.txt, lines 1-1 of 1:\n1: committed line");
  const big = textOf(await call("read_code", { path: "big.txt" })).split("\n");
  assert.equal(big[0], "big.txt, lines 1-300 of 400:");
  assert.equal(big[300], "300: line 300");
  assert.match(big.at(-1)!, /continue with start_line 301/);
  const tail = textOf(await call("read_code", { path: "big.txt", start_line: 391 })).split("\n");
  assert.equal(tail[0], "big.txt, lines 391-400 of 400:");
  assert.equal(tail.length, 11);
  const some = textOf(await call("read_code", { path: "big.txt", start_line: 5, end_line: 7 }));
  assert.equal(some, "big.txt, lines 5-7 of 400:\n5: line 5\n6: line 6\n7: line 7");
  const wide = textOf(await call("read_code", { path: "wide.txt" }));
  const body = wide.split("\n").slice(1, -1).join("\n");
  assert.ok(body.length <= 15_000, `${body.length} characters`);
  const shown = wide.split("\n").length - 2;
  assert.match(wide.split("\n").at(-1)!, new RegExp(`continue with start_line ${shown + 1}\\]$`));
});

test("2.13 read_code refuses what HEAD does not hold as a file, a binary or a file over 5 MB, and a range outside the file", async () => {
  const refusals: Array<[Record<string, unknown>, RegExp]> = [
    [{ path: "missing.txt" }, /not a file committed/],
    [{ path: "staged.txt" }, /not a file committed/],
    [{ path: "folder" }, /is a folder/],
    [{ path: "link.txt" }, /symbolic link/],
    [{ path: "binary.bin" }, /binary/],
    [{ path: "huge.txt" }, /too large/],
    [{ path: "big.txt", start_line: 401 }, /has only 400 lines/],
    [{ path: "big.txt", start_line: 10, end_line: 9 }, /end_line comes before start_line/],
  ];
  for (const [args, why] of refusals) {
    const result = await call("read_code", args);
    assert.equal(result.isError, true, JSON.stringify(args));
    assert.match(textOf(result), why);
  }
});

test("2.13 a symbolic link swapped in for a tracked file is never followed: read_code serves what HEAD holds", { skip: swapped ? false : "platform:posix: this account may not make symbolic links, which Linux and macOS always allow" }, async () => {
  const read = textOf(await call("read_code", { path: "swap.txt" }));
  assert.equal(read, "swap.txt, lines 1-1 of 1:\n1: the committed swap file");
});

test("2.14 a failed or refused read is a short plain tool error with no stack; a good one carries no next: commands or colour codes", async () => {
  const cases: Array<[Record<string, unknown>, RegExp]> = [
    [{ handle: "question_000000000000" }, /^storytree refused: no question "question_000000000000" in this project$/],
  ];
  for (const [args, said] of cases) {
    const result = await call("tell_me", args);
    assert.equal(result.isError, true);
    assert.match(textOf(result), said);
  }
  for (const [query, said] of [["unusable", /^storytree could not use that request: unknown flag --unusable$/], ["crash", /^storytree failed \(exit 3\): TypeError: Cannot read properties of undefined \(reading 'id'\)$/]] as const) {
    const result = await call("find", { query });
    assert.equal(result.isError, true);
    assert.match(textOf(result), said);
    assert.ok(!/fake-cli|node:internal|\n\s+at /.test(textOf(result)), textOf(result));
  }
  const good = textOf(await call("find", { query: "colour" }));
  assert.equal(good, "Bold and green answer");
});
