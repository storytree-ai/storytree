/** The MCP server 6.96: friction_drain runs the drain step its mounter injects, the doors learner the command line runs on its own drain. */
import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { test } from "node:test";

import { withTempDir } from "@storytree/project-and-caller/testing/folders";

import { claudeCode, withAgent } from "../testing/agent.js";
import { withProject } from "../testing/tool-world.js";
import { commandStep } from "./drain-step.js";

test("6.96 · friction_drain answers, then the drain step's lines on the calling session, or why the doors learner did not run; the step spawns `doors learn` with no session in its environment", async () => {
  await withProject(async ({ folder }) => {
    const steps: unknown[] = [];
    const drain = async (caller: { session: string; harness?: string }, where: string) => {
      steps.push({ caller, where });
      return ["The doors learner read 0 door-answered lines from 0 sessions over 28 days (ADR-1045 D4 to D6)."];
    };
    await withAgent(folder, claudeCode("drainer", { drain }), async (agent) => {
      const answer = await agent.call("friction_drain", {});
      assert.equal(answer.isError, false);
      assert.match(answer.text, /\nThe doors learner read 0 door-answered lines/);
    });
    assert.deepEqual(steps, [{ caller: { session: "drainer", harness: "claude-code" }, where: folder }]);

    const failing = async (): Promise<never> => { throw new Error("storytree.mjs is not there"); };
    await withAgent(folder, claudeCode("drainer", { drain: failing }), async (agent) => {
      const answer = await agent.call("friction_drain", {});
      assert.equal(answer.isError, false);
      assert.match(answer.text, /\nThe doors learner did not run: storytree\.mjs is not there$/);
    });
  });

  await withTempDir(async (dir) => {
    const echo = `process.stdout.write(JSON.stringify({ args: process.argv.slice(1), cwd: process.cwd(), env: [process.env.CLAUDE_CODE_SESSION_ID, process.env.STORYTREE_SESSION_ID, process.env.KEPT] }) + "\\n\\n")`;
    const env = { ...process.env, CLAUDE_CODE_SESSION_ID: "drainer", STORYTREE_SESSION_ID: "drainer", KEPT: "yes" };
    const [line] = await commandStep([process.execPath, "-e", echo], env)({ session: "drainer", harness: "codex" }, dir);
    assert.deepEqual(JSON.parse(line!), { args: ["doors", "learn", "--session", "drainer", "--harness", "codex"], cwd: realpathSync(dir), env: [null, null, "yes"] });

    await assert.rejects(commandStep([process.execPath, "-e", `process.stderr.write("no library here\\n"); process.exit(1)`], env)({ session: "drainer" }, dir), /no library here/);
  });
});
