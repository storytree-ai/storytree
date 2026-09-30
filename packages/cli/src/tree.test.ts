/**
 * Capability 10 · Plan view: one test per contract 10.1-10.4 in the command line story, each running the
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

test("10.3 `capability built` switches a capability's proposed flag off, `capability proposed` back on, each with its writer; an unknown capability says so", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const story = await library.addStory({ title: "Visitor can sign up" });
    const capability = await library.addCapability({ title: "Email form", story: story.id });

    const built = await world.run(["capability", "built", capability.id]);
    assert.equal(built.code, 0, built.stderr);
    assert.match(built.stdout, /no longer proposed/);
    assert.equal(((await library.get(capability.id))?.fields as { proposed?: boolean } | undefined)?.proposed, false);
    assert.match((await library.history({ id: capability.id })).at(-1)?.actor ?? "", /^person:/, "the switch carries its writer");

    const again = await world.run(["capability", "proposed", capability.id]);
    assert.equal(again.code, 0, again.stderr);
    assert.equal(((await library.get(capability.id))?.fields as { proposed?: boolean } | undefined)?.proposed, true);

    const unknown = await world.run(["capability", "built", "capability_000000000000"]);
    assert.equal(unknown.code, 1);
    assert.match(unknown.stderr, /no capability "capability_000000000000"/);
  });
});

test("10.4 each capability's line gives its word, and for one not healthy its reason, who moves it and the contracts carrying it", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const story = await library.addStory({ title: "Visitor can sign up" });
    const proposed = await library.addCapability({ title: "Password rules", story: story.id });
    const form = await library.addCapability({ title: "Email form", story: story.id });
    const good = await library.addContract({ title: "1.1 · Rejects an email with no @", capability: form.id });
    await library.addContract({ title: "1.2 · Accepts a plus address", capability: form.id });
    const owner = await library.addContract({ title: "1.3 · Sends through the real mail service", capability: form.id });
    const done = await library.addCapability({ title: "Thank-you page", story: story.id });
    const shown = await library.addContract({ title: "2.1 · Says thank you", capability: done.id });
    for (const built of [form, done]) await library.setProposed(built.id, false);
    await library.recordVerified(good.id, "passing");
    await library.recordVerified(owner.id, "not-checked", { skip: "owner" });
    await library.recordVerified(shown.id, "passing");

    const ran = await world.run(["tree"]);

    assert.equal(ran.code, 0, ran.stderr);
    const line = (text: string): string => ran.stdout.split(/\r?\n/).find((each) => each.includes(`[`) && each.includes(text) && !each.trimStart().startsWith("-")) ?? "";
    assert.match(line("Password rules"), /proposed — not built, the agent's to move/);
    assert.match(line("Email form"), /untested — no test names it, the agent's to move: 1\.2$/);
    assert.match(line("Thank-you page"), /healthy$/);
  });
});
