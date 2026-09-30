/** Removing a project from a terminal: a thin front door onto the app setup's own removal. */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { projectsOnThisComputer } from "@storytree/app-setup";

import { BuiltCommand, inWorld } from "./testing/cli.js";

const command = new BuiltCommand();
before(() => command.build());
after(() => command.remove());

test("project remove takes a project off this computer's list and keeps its records; an unknown name is refused", async () => {
  await inWorld(command, async ({ project, home, run, library }) => {
    await library();
    const removed = await run(["project", "remove", project]);
    assert.equal(removed.code, 0, removed.stderr);
    assert.match(removed.stdout, /records stay/);
    assert.deepEqual(projectsOnThisComputer([project], home), []);

    const unknown = await run(["project", "remove", `${project}-none`]);
    assert.notEqual(unknown.code, 0);
    assert.match(unknown.stderr + unknown.stdout, /no project called/);
  });
});
