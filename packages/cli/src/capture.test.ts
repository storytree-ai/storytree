/** Capability 9 · Friction and re-steers: the built command uses the agent link's evidence rules. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { recordFriction } from "@storytree/agent-link";
import { BuiltCommand, inWorld } from "./testing/cli.js";

const command = new BuiltCommand();
before(() => command.build());
after(() => command.remove());

const friction = ["friction", "new", "--title", "Slow mail", "--description", "Mail is delayed", "--statement", "Sending times out", "--impact", "Readers cannot join"];
const resteer = ["resteer", "new", "--title", "Simpler", "--description", "Less UI", "--doing", "Many fields", "--redirect", "Just email", "--disposition", "taste", "--judged-by", "owner"];

test("9.1 friction with vague evidence is refused; concrete evidence is captured with its writer", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const refused = await world.run([...friction, "--evidence", "It was slow and annoying"]);
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /evidence must be concrete/);
    assert.deepEqual(await library.history(), []);

    const evidence = "src/mail.ts: TimeoutError\nThe request took 30 seconds.";
    writeFileSync(path.join(world.folder, "evidence.md"), evidence);
    const accepted = await world.run([...friction, "--evidence", "@evidence.md"]);
    assert.equal(accepted.code, 0, accepted.stderr);
    const notes = await library.list("friction");
    assert.equal(notes.length, 1);
    assert.equal(notes[0]!.fields.evidence, evidence);
    assert.equal(notes[0]!.fields.route, undefined);
    const actor = `person:${userInfo().username}`;
    assert.equal((await library.history()).at(-1)?.actor, actor);
    assert.ok(accepted.stdout.includes(`Writer: ${actor}`), accepted.stdout);
  });
});

test("9.2 a re-steer whose evidence is a paraphrase is refused; the quote and self-report stay apart", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const refused = await world.run([...resteer, "--evidence", "The owner wanted fewer fields"]);
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /quote what the owner actually said/);
    assert.deepEqual(await library.history(), []);

    const evidence = '"Use just email"';
    const accepted = await world.run([...resteer, "--evidence", evidence, "--self-report", "I made the form too long"], { CODEX_THREAD_ID: "capture-session" });
    assert.equal(accepted.code, 0, accepted.stderr);
    const notes = await library.list("resteer");
    assert.equal(notes.length, 1);
    assert.equal(notes[0]!.fields.evidence, evidence);
    assert.equal(notes[0]!.fields.selfReport, "I made the form too long");
    assert.equal(notes[0]!.fields.dispositionBy, "owner");
    assert.equal((await library.history()).at(-1)?.actor, "session:capture-session");
    assert.match(accepted.stdout, /Writer: session:capture-session/);
  });
});

test("9.3 `reinforce` appends a dated recurrence to the existing friction, keeping its route", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const note = await recordFriction(library, { title: "Slow mail", description: "Delay", statement: "Timeout", evidence: "src/mail.ts: TimeoutError", impact: "Readers cannot join" });
    await library.editNote(note.id, { route: "nothing", routeReason: "Upstream outage" });
    execFileSync("git", ["init", "-b", "fix/mail", world.folder], { stdio: "ignore" });
    const before = new Date().toISOString().slice(0, 10);
    for (const evidence of ["#81: timed out again", "src/mail.ts: another TimeoutError"]) {
      const ran = await world.run(["friction", "reinforce", note.id, "--evidence", evidence]);
      assert.equal(ran.code, 0, ran.stderr);
      assert.ok(ran.stdout.includes(note.id), ran.stdout);
    }
    const saved = (await library.list("friction"))[0]!;
    assert.equal((await library.list("friction")).length, 1);
    assert.equal(saved.id, note.id);
    assert.equal(saved.fields.route, "nothing");
    assert.equal(saved.fields.routeReason, "Upstream outage");
    assert.deepEqual(saved.fields.reinforcedBy?.map(({ branch, evidence }) => ({ branch, evidence })), [
      { branch: "fix/mail", evidence: "#81: timed out again" },
      { branch: "fix/mail", evidence: "src/mail.ts: another TimeoutError" },
    ]);
    for (const recurrence of saved.fields.reinforcedBy!) assert.ok([before, new Date().toISOString().slice(0, 10)].includes(recurrence.date));
    assert.equal((await library.history({ id: note.id })).at(-1)?.actor, `person:${userInfo().username}`);
    const history = await library.history();
    const vague = await world.run(["friction", "reinforce", note.id, "--evidence", "It happened again"]);
    assert.equal(vague.code, 1);
    assert.match(vague.stderr, /concrete/);
    assert.deepEqual(await library.history(), history);
  });
});
