/**
 * Capability 10 · Plan view: one test per contract 10.1-10.2 in the command line story, each running the
 * real, built `storytree` command.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { BuiltCommand, inWorld } from "./testing/cli.js";

const command = new BuiltCommand();

before(() => command.build());
after(() => command.remove());

test("10.1 a story with a capability and a contract prints in order with \"agent says passing\"", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const story = await library.addStory({ title: "Visitor can sign up" });
    const capability = await library.addCapability({ title: "Email form", story: story.id });
    const contract = await library.addContract({ title: "Rejects an email with no @", capability: capability.id });
    await library.reportHealth(contract.id, "passing", { by: "agent" });

    const ran = await world.run(["tree"]);

    assert.equal(ran.code, 0, ran.stderr);
    const lines = ran.stdout.split(/\r?\n/);
    const at = (text: string): number => lines.findIndex((line) => line.includes(text));
    assert.ok(at("Visitor can sign up") >= 0, ran.stdout);
    assert.ok(at("Visitor can sign up") < at("Email form"), ran.stdout);
    assert.ok(at("Email form") < at("Rejects an email with no @"), ran.stdout);
    assert.match(lines[at("Rejects an email with no @")]!, /agent says passing/);
  });
});

test("10.2 an unknown story says so", async () => {
  await inWorld(command, async (world) => {
    await (await world.library()).addStory({ title: "Visitor can sign up" });

    const ran = await world.run(["tree", "story_nosuchstory"]);

    assert.equal(ran.code, 1);
    assert.match(ran.stderr, /no story "story_nosuchstory"/);
  });
});
