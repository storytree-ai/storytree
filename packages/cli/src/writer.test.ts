/** Capability 2 · Who wrote it: each contract runs the built command against the real library. */
import assert from "node:assert/strict";
import { userInfo } from "node:os";
import { after, before, test } from "node:test";

import { BuiltCommand, inWorld } from "./testing/cli.js";

const command = new BuiltCommand();
before(() => command.build());
after(() => command.remove());

test("2.1 an edit through the command shows in history as the person", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const arc = await library.createArc({ title: "Email", intent: "Reach readers", endState: "Mail delivered" });
    const ran = await world.run(["arc", "edit", arc.id, "--title", "Reliable email"]);

    assert.equal(ran.code, 0, ran.stderr);
    const actor = `person:${userInfo().username}`;
    assert.equal((await library.history({ id: arc.id })).at(-1)?.actor, actor);
    assert.ok(ran.stdout.includes(`Writer: ${actor}`), ran.stdout);
  });
});

test("2.2 the same edit with a harness session id shows as that session", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const arc = await library.createArc({ title: "Email", intent: "Reach readers", endState: "Mail delivered" });
    for (const [variable, session] of [["CLAUDE_CODE_SESSION_ID", "claude-edit"], ["CODEX_THREAD_ID", "codex-edit"]]) {
      const ran = await world.run(["arc", "edit", arc.id, "--title", session!], { [variable!]: session! });

      assert.equal(ran.code, 0, ran.stderr);
      assert.equal((await library.history({ id: arc.id })).at(-1)?.actor, `session:${session}`);
      assert.ok(ran.stdout.includes(`Writer: session:${session}`), ran.stdout);
    }
  });
});
