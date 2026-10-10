/**
 * Capability 3 · Library: contract tests running the real, built `storytree` command against a
 * throwaway project, plus a focused check of how the command presents the library's ranked answer.
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { claim, openActivityLog } from "@storytree/agent-link";

import { parseArgs } from "./args.js";
import type { Context } from "./door.js";
import { library as libraryFamily } from "./families/library.js";
import { BuiltCommand, inWorld, testServerUrl } from "./testing/cli.js";

const command = new BuiltCommand();

before(() => command.build());
after(() => command.remove());

test("3.12 · phrase returns complete JSON records, selections and a continuation without trimming the phrase", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const phrase = "  Exact phrase  ";
    const first = await library.defineTerm({ term: "First", meaning: phrase });
    const second = await library.defineTerm({ term: "Second", meaning: phrase });
    await library.defineTerm({ term: phrase, meaning: "Wrong field" });
    await library.addStory({ title: phrase });
    await library.defineTerm({ term: "Wrong spacing", meaning: phrase.trim() });
    const args = ["library", "phrase", phrase, "--kind", "definition", "--kind", "decision", "--field", "meaning", "--field", "text", "--limit", "1"];
    const ran = await world.run(args);
    assert.equal(ran.code, 0, ran.stderr);
    const page = JSON.parse(ran.stdout);
    const expected = [first, second].sort((a, b) => a.id.localeCompare(b.id));
    assert.deepEqual(page, { records: [expected[0]], next: expected[0]!.id });
    const continued = await world.run([...args, "--after", page.next]);
    assert.equal(continued.code, 0, continued.stderr);
    assert.deepEqual(JSON.parse(continued.stdout), { records: [expected[1]] });
    const absent = await world.run(["library", "phrase", "no such phrase"]);
    assert.equal(absent.code, 0, absent.stderr);
    assert.deepEqual(JSON.parse(absent.stdout), { records: [] });
    for (const options of [["--limit", "101"], ["--limit", "1.5"], ["--kind", "bogus"]]) {
      const refused = await world.run(["library", "phrase", phrase, ...options]);
      assert.notEqual(refused.code, 0);
      assert.match(refused.stderr, /limit|kind/);
    }
  });
});

test("3.1 `read` returns the whole body", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const body = "First paragraph.\n\n" + "A long record keeps all of its words. ".repeat(80) + "\nLast paragraph.";
    const note = await library.defineTerm({ term: "Long record", meaning: body });
    const ran = await world.run(["library", "read", note.id]);
    assert.equal(ran.code, 0, ran.stderr);
    assert.ok(ran.stdout.includes(body), ran.stdout);
    assert.ok(ran.stdout.includes(note.id));
    const missing = await world.run(["library", "read", "definition_missing"]);
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /no record/);
  });
});

test("3.10 `read --field` prints one field exactly as stored, and refuses a field the record does not have", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const meaning = "  Indented first line.\n\nA trailing blank line and spaces follow.  \n\n";
    const target = await library.defineTerm({ term: "Target", meaning: "Linked" });
    const note = await library.defineTerm({ term: "Raw", meaning, links: [target.id] });
    const text = await world.run(["library", "read", note.id, "--field", "meaning"]);
    assert.equal(text.code, 0, text.stderr);
    assert.equal(text.stdout, meaning);
    const json = await world.run(["library", "read", note.id, "--field", "links"]);
    assert.equal(json.code, 0, json.stderr);
    assert.deepEqual(JSON.parse(json.stdout), [target.id]);
    const missing = await world.run(["library", "read", note.id, "--field", "answer"]);
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /\banswer\b/);
    for (const field of Object.keys(note.fields)) assert.ok(missing.stderr.includes(field), missing.stderr);
  });
});

test("3.2 `edit` changes only the named fields", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const story = await library.addStory({ title: "Sign up", description: "Visitors join" });
    const capability = await library.addCapability({ story: story.id, title: "Email" });
    const contract = await library.addContract({ capability: capability.id, title: "Sends mail" });
    const arc = await library.createArc({ title: "Launch", intent: "Ship sign-up", endState: "Visitors join" });
    const increment = await library.addIncrement({ arc: arc.id, title: "Form", objective: "Build it", body: "Email form" });
    const decision = await library.recordDecision({ title: "Mailer", text: "Mailgun", status: "accepted" });
    for (const record of [story, capability, contract, arc, increment, decision]) {
      const ran = await world.run(["library", "edit", record.id, "--title", "New title"]);
      assert.equal(ran.code, 0, ran.stderr);
      assert.deepEqual((await library.get(record.id))?.fields, { ...record.fields, title: "New title" });
      assert.equal((await library.history({ id: record.id })).at(-1)?.actor, `person:${userInfo().username}`);
    }
    const definition = await library.defineTerm({ term: "Mailer", meaning: "Before", links: [decision.id] });
    const body = "A whole new body.\n\nKept as written.";
    writeFileSync(path.join(world.folder, "body.md"), body);
    const ran = await world.run(["library", "edit", definition.id, "--meaning", "@body.md"]);
    assert.equal(ran.code, 0, ran.stderr);
    assert.deepEqual((await library.get(definition.id))?.fields, { ...definition.fields, meaning: body });
    writeFileSync(path.join(world.folder, "title.txt"), "\uFEFFSaved by PowerShell");
    const marked = await world.run(["library", "edit", definition.id, "--term", "@title.txt"]);
    assert.equal(marked.code, 0, marked.stderr);
    assert.deepEqual((await library.get(definition.id))?.fields, { ...definition.fields, meaning: body, term: "Saved by PowerShell" });
  });
});

test("3.3 `new` without a required field is refused, naming it", async () => {
  await inWorld(command, async (world) => {
    const ran = await world.run(["library", "new", "story", "--description", "Visitors can sign up"]);

    assert.equal(ran.code, 1);
    assert.match(ran.stderr, /\btitle\b/);
    assert.deepEqual((await (await world.library()).changesSince(0)).changes, []);
  });
});

test("3.4 `history` lists every write with its writer, including retirement", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const note = await library.defineTerm({ term: "History", meaning: "First\nparagraph", links: [] });
    await library.editNote(note.id, { meaning: 'Second: "quoted"' }, { actor: "person:Sam" });
    await library.retire(note.id, "Kept in a decision", { actor: "session:scribe" });
    const unrelated = await library.defineTerm({ term: "Unrelated", meaning: "Another record" }, { actor: "person:Elsewhere" });
    const ran = await world.run(["library", "history", note.id]);
    assert.equal(ran.code, 0, ran.stderr);
    assert.match(ran.stdout, /created.*writer not recorded/s);
    assert.match(ran.stdout, /updated.*person:Sam/s);
    assert.match(ran.stdout, /retired.*session:scribe.*Kept in a decision/s);
    const positions = (await library.history({ id: note.id })).map((entry) => {
      const at = ran.stdout.indexOf(entry.at);
      assert.ok(at >= 0, ran.stdout);
      return at;
    });
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
    assert.ok(!ran.stdout.includes(unrelated.id));
    assert.ok(!ran.stdout.includes("person:Elsewhere"));
    assert.doesNotMatch(ran.stdout, /fields:/);

    const detailed = await world.run(["library", "history", note.id, "--fields"]);
    assert.equal(detailed.code, 0, detailed.stderr);
    const snapshots = detailed.stdout.split("\n").filter((line) => line.startsWith("    fields: "))
      .map((line) => JSON.parse(line.slice("    fields: ".length)));
    assert.deepEqual(snapshots, [
      note.fields,
      { ...note.fields, meaning: 'Second: "quoted"' },
      { ...note.fields, meaning: 'Second: "quoted"' },
    ]);
    assert.equal(detailed.stdout.split("\n").filter((line) => !line.startsWith("    fields: ")).join("\n"), ran.stdout);
    const missing = await world.run(["library", "history", "definition_missing", "--fields"]);
    assert.equal(missing.code, 0, missing.stderr);
    assert.match(missing.stdout, /No history/);
  });
});

test("3.4 `history --fields` shows a contract's reported red then green after both writes", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const story = await library.addStory({ title: "First build" });
    const capability = await library.addCapability({ story: story.id, title: "Build" });
    const contract = await library.addContract({ capability: capability.id, title: "It works" });
    await library.reportHealth(contract.id, "failing", { by: "session:builder", note: "Test went red" });
    await library.reportHealth(contract.id, "passing", { by: "session:builder", note: "Test went green" });

    const ran = await world.run(["library", "history", `health_${contract.id}_reported`, "--fields"]);
    assert.equal(ran.code, 0, ran.stderr);
    const snapshots = ran.stdout.split("\n").filter((line) => line.startsWith("    fields: "))
      .map((line) => JSON.parse(line.slice("    fields: ".length)));
    assert.deepEqual(snapshots.map(({ state, note }) => ({ state, note })), [
      { state: "failing", note: "Test went red" },
      { state: "passing", note: "Test went green" },
    ]);
    assert.ok(snapshots.every(({ column }) => column === "reported"));
  });
});

test("3.5 `list` shows only live records of the kind and filters by a field", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const accepted = await library.recordDecision({ title: "Mailer", text: "Mailgun", status: "accepted", loadBearing: true });
    const proposed = await library.recordDecision({ title: "Alternative", text: "SES", status: "proposed" });
    const retired = await library.recordDecision({ title: "Old", text: "SMTP", status: "accepted" });
    await library.retire(retired.id, "Not needed");
    const definition = await library.defineTerm({ term: "Another kind", meaning: "A definition" });
    const all = await world.run(["library", "list", "decision"]);
    assert.equal(all.code, 0, all.stderr);
    for (const id of [accepted.id, proposed.id]) assert.ok(all.stdout.includes(id), all.stdout);
    for (const id of [retired.id, definition.id]) assert.ok(!all.stdout.includes(id), all.stdout);
    const filtered = await world.run(["library", "list", "decision", "--where", "status=accepted", "--where", "loadBearing=true"]);
    assert.equal(filtered.code, 0, filtered.stderr);
    assert.ok(filtered.stdout.includes(accepted.id), filtered.stdout);
    assert.ok(!filtered.stdout.includes(proposed.id), filtered.stdout);
    const unknown = await world.run(["library", "list", "unknown-kind"]);
    assert.equal(unknown.code, 1);
    assert.match(unknown.stderr, /unknown/i);
  });
});

// ADR-0650: a terminal cannot create a harness memory in the library.
test("3.6 saving a memory is refused with its reason and writes nothing", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const { cursor } = await library.changesSince(0);
    const ran = await world.run(["library", "new", "memory", "--text", "Keep this"]);
    assert.notEqual(ran.code, 0);
    assert.match(ran.stderr, /memor.*harness/i);
    assert.deepEqual((await library.changesSince(cursor)).changes, []);
  });
});

test("3.7 `related <artifact> --unlinked` lists the artifacts most like it that no link reaches", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const source = await library.defineTerm({ term: "Bounced confirmation", meaning: "Mailgun bounces the sign-up confirmation email from an unverified domain" });
    const linked = await library.defineTerm({ term: "Verified domain", meaning: "A mailgun domain whose confirmation email does not bounce", links: [source.id] });
    const unlinked = await library.defineTerm({ term: "Mailgun bounces", meaning: "Unverified domains bounce every confirmation email" });
    const stranger = await library.defineTerm({ term: "Planet", meaning: "The forest drawn as a globe" });

    const all = await world.run(["library", "related", source.id]);
    assert.equal(all.code, 0, all.stderr);
    for (const id of [linked.id, unlinked.id]) assert.ok(all.stdout.includes(id), all.stdout);
    assert.ok(!all.stdout.includes(stranger.id), all.stdout);
    assert.match(all.stdout, /linked via links → this/);

    const only = await world.run(["library", "related", source.id, "--unlinked"]);
    assert.equal(only.code, 0, only.stderr);
    assert.ok(only.stdout.includes(unlinked.id), only.stdout);
    assert.ok(!only.stdout.includes(linked.id), only.stdout);
    assert.match(only.stdout, /3 ranked, 1 already linked/);

    const missing = await world.run(["library", "related", "definition_000000000000"]);
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /no artifact/);
  });
});

test("3.8 `library retire` retires records with a reason and their writer", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const story = await library.addStory({ title: "Sign up" });
    const capability = await library.addCapability({ story: story.id, title: "Email" });
    const contract = await library.addContract({ capability: capability.id, title: "Sends mail" });
    const note = await library.defineTerm({ term: "Mailer", meaning: "Sends mail" });
    const { cursor } = await library.changesSince(0);
    const bare = await world.run(["library", "retire", contract.id]);
    assert.equal(bare.code, 2);
    assert.match(bare.stderr, /needs --reason/);
    assert.deepEqual((await library.changesSince(cursor)).changes, []);

    for (const record of [contract, note]) {
      const env = record === note ? { CODEX_THREAD_ID: "retire-record" } : undefined;
      const actor = record === note ? "session:retire-record" : `person:${userInfo().username}`;
      const ran = await world.run(["library", "retire", record.id, "--reason", "Covered elsewhere"], env);
      assert.equal(ran.code, 0, ran.stderr);
      assert.ok(ran.stdout.includes(`Retired ${record.id}`), ran.stdout);
      assert.equal(await library.get(record.id), null);
      const retired = (await library.history({ id: record.id })).at(-1);
      assert.equal(retired?.action, "retired");
      assert.equal(retired?.reason, "Covered elsewhere");
      assert.equal(retired?.actor, actor);
    }
  });
});

test("3.9 `search` keeps the library's best-first order and scores, passing on the query and limit", async (t) => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const lesser = await library.defineTerm({ term: "Mailer 1", meaning: "Sends mail." });
    const best = await library.defineTerm({ term: "Mailer 2", meaning: "Needs a verified sender domain." });
    t.mock.method(library, "rankAll", async (query: string, options: { limit: number }) => {
      assert.equal(query, "verified sender");
      assert.deepEqual(options, { limit: 2 });
      return { by: "meaning", hits: [{ note: best, score: 0.987 }, { note: lesser, score: 0.123 }] };
    });

    const search = libraryFamily.verbs.find((verb) => verb.name === "search")!;
    const answer = await search.act(parseArgs(["verified", "sender", "--limit", "2"], [], world.folder), { library: async () => library } as Context);

    assert.equal(answer.text, `closest in meaning to "verified sender":\n  0.99  ${best.id}  [definition]  Mailer 2\n  0.12  ${lesser.id}  [definition]  Mailer 1`);
  });
});

test("3.9 `search` with no model gives at most --limit word matches and says why", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const mailers = new Map<string, string>();
    for (const n of [3, 2, 1]) {
      const note = await library.defineTerm({ term: `Mailer ${n}`, meaning: "The mailer needs a verified sender domain." });
      mailers.set(note.id, note.fields.term);
    }
    await library.defineTerm({ term: "Deploys", meaning: "Deploys go out on Tuesdays" });

    const ran = await world.run(["library", "search", "mailer", "--limit", "2"]);

    assert.equal(ran.code, 0, ran.stderr);
    assert.match(ran.stdout, /ranked by words: the embedding model is switched off/);
    // Word matches have no scores; records created in one millisecond tie by random id.
    const hits = [...ran.stdout.matchAll(/^  (definition_\w+)  \[definition\]  (.+)$/gm)];
    assert.equal(hits.length, 2, ran.stdout);
    assert.equal(new Set(hits.map((hit) => hit[1])).size, 2, ran.stdout);
    for (const hit of hits) assert.equal(mailers.get(hit[1]!), hit[2], ran.stdout);
    assert.doesNotMatch(ran.stdout, /Deploys|Tuesdays/);

    const story = await library.addStory({ title: "Sign up" });
    const capability = await library.addCapability({ story: story.id, title: "Email" });
    const contract = await library.addContract({ capability: capability.id, title: "Confirmation goes out by courier pigeon" });
    const found = await world.run(["library", "search", "courier", "pigeon"]);
    assert.equal(found.code, 0, found.stderr);
    assert.ok(found.stdout.includes(`${contract.id}  [contract]  1.1 · Confirmation goes out by courier pigeon`), found.stdout);
  });
});

test("3.11 a list field given to `new` or `edit` as comma-separated ids is written as a list, from any shell", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const decisions = await Promise.all(["Mailer", "Hosting"].map((title) => library.recordDecision({ title, text: "Use the service", status: "proposed" })));
    const ids = decisions.map(({ id }) => id);

    // Windows PowerShell 5.1 strips a JSON list's inner quotes; the comma word reaches the command intact.
    const written = await world.run(["library", "new", "definition", "--term", "Stack", "--meaning", "What runs it", "--links", `${ids[0]}, ${ids[1]}`]);
    assert.equal(written.code, 0, written.stderr);
    const definition = (await library.list("definition")).find(({ id }) => written.stdout.includes(id));
    assert.deepEqual((definition?.fields as Record<string, unknown> | undefined)?.links, ids);

    const edited = await world.run(["library", "edit", definition!.id, "--links", ids[1]!]);
    assert.equal(edited.code, 0, edited.stderr);
    assert.deepEqual(((await library.get(definition!.id))?.fields as Record<string, unknown> | undefined)?.links, [ids[1]]);

    // An unquoted comma list PowerShell joined with a space is refused before writing, with the quoted retry.
    const before = (await library.changesSince(0)).cursor;
    const joined = await world.run(["library", "new", "definition", "--term", "Joined", "--meaning", "Shell-joined", "--links", ids.join(" ")]);
    assert.notEqual(joined.code, 0, joined.stdout);
    assert.ok(joined.stderr.includes(`--links "id1,id2"`), joined.stderr);
    assert.deepEqual((await library.changesSince(before)).changes, []);

    // A text field keeps its commas.
    const prose = await world.run(["library", "new", "definition", "--term", "Prose", "--meaning", "First, second"]);
    assert.equal(prose.code, 0, prose.stderr);
    assert.equal(((await library.list("definition")).find(({ id }) => prose.stdout.includes(id))?.fields as Record<string, unknown> | undefined)?.meaning, "First, second");
  });
});

test("3.13 `new check` writes a quality control check enforcing a principle, and `read` returns it whole", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const rule = await library.writeKnowledge("principle", { title: "Test creation", description: "How tests are written", statement: "A test can disagree with the code", why: "Else it proves nothing", howToApply: "Work the expected value by hand" });
    const question = "Is any expected value computed the way the code computes it?";

    const written = await world.run(["library", "new", "check", "--title", "Tautological expected value", "--description", "Expected values worked by hand", "--question", question, "--howToAnswer", "Yes when the expected side repeats the formula", "--enforces", rule.id]);
    assert.equal(written.code, 0, written.stderr);
    const check = (await library.list("check")).find(({ id }) => written.stdout.includes(id));
    assert.deepEqual((check?.fields as Record<string, unknown> | undefined)?.enforces, [rule.id]);

    const read = await world.run(["library", "read", check!.id]);
    assert.equal(read.code, 0, read.stderr);
    assert.ok(read.stdout.includes(`[check]`) && read.stdout.includes(question), read.stdout);
  });
});

test("3.15 `new contract` numbers past the capability's contracts and the numbers its story package's tests carry, as plan_contract does", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const story = await library.addStory({ title: "The shop" });
    const capability = await library.addCapability({ title: "1 · Cart", story: story.id });
    await library.addContract({ title: "1.1 · Holds an item", capability: capability.id });
    const src = path.join(world.folder, "packages/shop/src");
    mkdirSync(src, { recursive: true });
    writeFileSync(path.join(src, "cart.ts"), "export const cart = 1;\n");
    writeFileSync(path.join(src, "cart.test.ts"), 'import { cart } from "./cart.js";\ntest("1.2 an item is counted", () => cart);\ntest("1.3 a cart empties", () => cart);\n');

    const written = await world.run(["library", "new", "contract", "--capability", capability.id, "--title", "Totals its items"]);
    assert.equal(written.code, 0, written.stderr);
    const contract = (await library.list("contract")).find(({ id }) => written.stdout.includes(id));
    assert.equal((contract?.fields as Record<string, unknown> | undefined)?.title, "1.4 · Totals its items");
  });
});

test("3.14 `library edit` and `retire`, run by a session holding an increment, hold a change to a record planned before it as a pending change on the increment, the live record left alone; `library read` of the increment lists each as before and after, or its retirement (ADR-0966)", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const arc = await library.createArc({ title: "Launch", intent: "Ship sign-up", endState: "Visitors sign up" });
    const story = await library.addStory({ title: "Sign up" });
    const form = await library.addCapability({ story: story.id, title: "Form" });
    const promise = await library.addContract({ capability: form.id, title: "Accepts an address" });
    const increment = await library.addIncrement({ arc: arc.id, title: "Address form", objective: "Rename it", body: "Red then green" });
    const log = await openActivityLog(testServerUrl());
    try {
      const as = { CLAUDE_CODE_SESSION_ID: "caller" };
      assert.equal((await claim({ log, library, project: world.project, session: "caller", harness: "claude-code" }, increment.id, "driving the address form")).ok, true);
      const live = await library.get(form.id);
      const edited = await world.run(["library", "edit", form.id, "--description", "Where they type it"], as);
      assert.equal(edited.code, 0, edited.stderr);
      assert.match(edited.stdout, new RegExp(`pending on increment ${increment.id}`));
      const retired = await world.run(["library", "retire", promise.id, "--reason", "overtaken"], as);
      assert.equal(retired.code, 0, retired.stderr);
      assert.deepEqual(await library.get(form.id), live, "the live record is left alone");
      assert.notEqual(await library.get(promise.id), null, "the contract is still live");

      const read = await world.run(["library", "read", increment.id]);
      assert.equal(read.code, 0, read.stderr);
      assert.match(read.stdout, /Pending changes \(2\)/);
      assert.match(read.stdout, new RegExp(`${form.id}.*\\n.*description: \\(none\\) -> Where they type it`));
      assert.match(read.stdout, new RegExp(`${promise.id}.*\\n.*retire: overtaken`));
    } finally {
      await log.close();
    }
  });
});
