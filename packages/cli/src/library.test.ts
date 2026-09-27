/**
 * Capability 3 · Library: one test per contract in stories/cli.md, each running the real, built
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
    const note = await library.writeMemory({ text: body });
    const ran = await world.run(["library", "read", note.id]);
    assert.equal(ran.code, 0, ran.stderr);
    assert.ok(ran.stdout.includes(body), ran.stdout);
    assert.ok(ran.stdout.includes(note.id));
    const missing = await world.run(["library", "read", "memory_missing"]);
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /no record/);
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
    const memory = await library.writeMemory({ text: "Before", links: [decision.id] });
    const body = "A whole new body.\n\nKept as written.";
    writeFileSync(path.join(world.folder, "body.md"), body);
    const ran = await world.run(["library", "edit", memory.id, "--text", "@body.md"]);
    assert.equal(ran.code, 0, ran.stderr);
    assert.deepEqual((await library.get(memory.id))?.fields, { ...memory.fields, text: body });
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
    const note = await library.writeMemory({ text: "First" });
    await library.editNote(note.id, { text: "Second" }, { actor: "person:Sam" });
    await library.retire(note.id, "Kept in a decision", { actor: "session:scribe" });
    const unrelated = await library.writeMemory({ text: "Unrelated" }, { actor: "person:Elsewhere" });
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
    const memory = await library.writeMemory({ text: "Another kind" });
    const all = await world.run(["library", "list", "decision"]);
    assert.equal(all.code, 0, all.stderr);
    for (const id of [accepted.id, proposed.id]) assert.ok(all.stdout.includes(id), all.stdout);
    for (const id of [retired.id, memory.id]) assert.ok(!all.stdout.includes(id), all.stdout);
    const filtered = await world.run(["library", "list", "decision", "--where", "status=accepted", "--where", "loadBearing=true"]);
    assert.equal(filtered.code, 0, filtered.stderr);
    assert.ok(filtered.stdout.includes(accepted.id), filtered.stdout);
    assert.ok(!filtered.stdout.includes(proposed.id), filtered.stdout);
    const unknown = await world.run(["library", "list", "unknown-kind"]);
    assert.equal(unknown.code, 1);
    assert.match(unknown.stderr, /unknown/i);
  });
});
