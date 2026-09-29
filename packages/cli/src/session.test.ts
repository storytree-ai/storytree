/**
 * `storytree session close-out` (ADR-0758 D2): the real, built command, run from an agent's shell,
 * records the session's close-out for the agent link to read; a person's shell, or a --safe that is
 * neither yes nor no, is refused.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { openActivityLog, readSessions } from "@storytree/agent-link";

import { BuiltCommand, inWorld, testServerUrl } from "./testing/cli.js";

const command = new BuiltCommand();

before(() => command.build());
after(() => command.remove());

test("session close-out from an agent's shell records its yes or no and why; the list then reads it", async () => {
  await inWorld(command, async (world) => {
    assert.equal((await world.run(["session", "close-out", "--safe", "yes", "--why", "done"])).code, 1, "a person's shell has no session to close out");
    assert.equal((await world.run(["session", "close-out", "--safe", "maybe", "--why", "done"], { CLAUDE_CODE_SESSION_ID: "claude-9" })).code, 2);

    const ran = await world.run(["session", "close-out", "--safe", "no", "--why", "the look waits on the owner"], { CLAUDE_CODE_SESSION_ID: "claude-9" });
    assert.equal(ran.code, 0, ran.stderr);
    const log = await openActivityLog(testServerUrl());
    try {
      const [session] = await readSessions(log, world.project);
      assert.deepEqual({ session: session?.session, safe: session?.closeOut?.safe, needsYou: session?.closeOut?.needsYou }, { session: "claude-9", safe: false, needsYou: "the look waits on the owner" });
    } finally {
      await log.close();
    }
  });
});
