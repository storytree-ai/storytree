/**
 * Capability 3 · Library: one test per contract in the command line story, each running the real, built
 * `storytree` command against a throwaway project.
 */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { BuiltCommand, inWorld } from "./testing/cli.js";

const command = new BuiltCommand();

before(() => command.build());
after(() => command.remove());

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
    const note = await library.defineTerm({ term: "History", meaning: "First" });
    await library.editNote(note.id, { meaning: "Second" }, { actor: "person:Sam" });
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

test("3.9 `search` gives the artifacts ranked by the library (capability 14), at most --limit; with no model, the word matches and why", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    for (const n of [1, 2, 3]) await library.defineTerm({ term: `Mailer ${n}`, meaning: "The mailer needs a verified sender domain." });
    await library.defineTerm({ term: "Deploys", meaning: "Deploys go out on Tuesdays" });

    const ran = await world.run(["library", "search", "mailer", "--limit", "2"]);

    assert.equal(ran.code, 0, ran.stderr);
    assert.match(ran.stdout, /ranked by words: the embedding model is switched off/);
    assert.match(ran.stdout, /Mailer 1[\s\S]*Mailer 2/);
    assert.doesNotMatch(ran.stdout, /Mailer 3|Tuesdays/);

    const story = await library.addStory({ title: "Sign up" });
    const capability = await library.addCapability({ story: story.id, title: "Email" });
    const contract = await library.addContract({ capability: capability.id, title: "Confirmation goes out by courier pigeon" });
    const found = await world.run(["library", "search", "courier", "pigeon"]);
    assert.equal(found.code, 0, found.stderr);
    assert.ok(found.stdout.includes(`${contract.id}  [contract]  Confirmation goes out by courier pigeon`), found.stdout);
  });
});
