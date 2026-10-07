/**
 * `storytree session close-out` (ADR-0758 D2): the real, built command, run from an agent's shell,
 * records the session's close-out for the agent link to read; a person's shell, or a --safe that is
 * neither yes nor no, is refused.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { claim, openActivityLog, readSessions } from "@storytree/agent-link";

import { BuiltCommand, inWorld, testServerUrl } from "./testing/cli.js";

const command = new BuiltCommand();

before(() => command.build());
after(() => command.remove());

test("11.7 session close-out records its yes or no and why, lists released claims, and says when there are none", async () => {
  await inWorld(command, async (world) => {
    assert.equal((await world.run(["session", "close-out", "--safe", "yes", "--why", "done"])).code, 1, "a person's shell has no session to close out");
    assert.equal((await world.run(["session", "close-out", "--safe", "maybe", "--why", "done"], { CLAUDE_CODE_SESSION_ID: "claude-9" })).code, 2);

    const log = await openActivityLog(testServerUrl());
    try {
      const library = await world.library();
      const story = await library.addStory({ title: "Sign-up" });
      const capability = await library.addCapability({ story: story.id, title: "Email form" });
      const arc = await library.createArc({ title: "Launch", intent: "Ship sign-up", endState: "Visitors sign up" });
      const increment = await library.addIncrement({ arc: arc.id, title: "Email form", objective: "Build it", body: "…" });
      const caller = { log, library, project: world.project, session: "claude-9", harness: "claude-code" };
      for (const id of [capability.id, increment.id]) assert.equal((await claim(caller, id, "building the form")).ok, true);

      const ran = await world.run(["session", "close-out", "--safe", "no", "--why", "the look waits on the owner"], { CLAUDE_CODE_SESSION_ID: "claude-9" });
      assert.equal(ran.code, 0, ran.stderr);
      assert.ok(ran.stdout.includes(`Released claims: ${capability.id}, ${increment.id}.`), ran.stdout);
      const [session] = await readSessions(log, world.project);
      assert.deepEqual({ session: session?.session, safe: session?.closeOut?.safe, needsYou: session?.closeOut?.needsYou }, { session: "claude-9", safe: false, needsYou: "the look waits on the owner" });

      const again = await world.run(["session", "close-out", "--safe", "yes", "--why", "done"], { CLAUDE_CODE_SESSION_ID: "claude-9" });
      assert.equal(again.code, 0, again.stderr);
      assert.match(again.stdout, /No claims to release\./);
    } finally {
      await log.close();
    }
  });
});
