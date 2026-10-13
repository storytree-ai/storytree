/**
 * What Session management promises of a call that comes through the MCP server: the wrapper ends merged
 * claims before the tool runs (session-management 5.10), and a running server rereads the idle-after setting
 * for claim takeover (session-management 5.43). The rules are Session management's; these tests prove the server calls them.
 */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";

import { ACTIVITY_DATABASE, claim, claimRefusal, openActivityLog, readClaims, type MergeWatch } from "@storytree/session-management";
import { setSetting } from "@storytree/project-and-caller";
import { withTempDir } from "@storytree/project-and-caller/testing/folders";
import { approveCheckout, dropTestProjects, placeTestServer, testServerUrl, uniqueProjectName } from "@storytree/project-and-caller/testing/pg";
import { connect } from "@storytree/library";

import { claudeCode, withAgent } from "../testing/agent.js";
import { withProject } from "../testing/tool-world.js";

test("session-management 5.10 a tool call ends a claim whose branch merged after the claim was taken, before the tool runs; one still open ends nothing", async () => {
  await withProject(async ({ folder, project, library, log }) => {
    const story = await library.addStory({ title: "Sign up" });
    const capability = await library.addCapability({ story: story.id, title: "Email form" });
    const pulls = new Map<string, { number: number; mergedAt: string }[]>();
    const merges: MergeWatch = { mergedPulls: async (_folder, branch) => pulls.get(branch) ?? [], everyMs: 0 };
    assert.equal((await claim({ log, library, project, session: "A", branch: "feature/signup" }, capability.id, "building the email form")).ok, true);
    await sleep(20);
    await withAgent(folder, { ...claudeCode("C"), merges }, async (agent) => {
      await agent.call("show_plan");
      assert.deepEqual((await readClaims(log, project)).map(({ session }) => session), ["A"], "an open pull request ends nothing");
      pulls.set("feature/signup", [{ number: 7, mergedAt: new Date().toISOString() }]);
      const plan = await agent.call("show_plan");
      assert.ok(!plan.text.includes("building the email form"), "the tool saw the claim already ended");
    });
    assert.deepEqual(await readClaims(log, project), []);
    const merged = (await log.since(project, 0)).lines.filter((line) => line.kind === "merged");
    assert.deepEqual(merged.map((line) => line.kind === "merged" && { holder: line.holder, pr: line.pr, session: line.session }), [{ holder: "A", pr: 7, session: "C" }]);
  });
});

test("session-management 5.43 / 9.7 a running MCP server rereads idle-after without blocking independent context readings", async () => {
  await withTempDir(async (home) => {
    const previous = process.env.STORYTREE_HOME;
    process.env.STORYTREE_HOME = home;
    const project = uniqueProjectName();
    const store = await connect({ url: testServerUrl() });
    const log = await openActivityLog(testServerUrl());
    try {
      writeFileSync(path.join(home, ".storytree.json"), JSON.stringify({ project }));
      await approveCheckout(home, project, home);
      const library = await store.openProject(project);
      const story = await library.addStory({ title: "Idle setting" });
      const capability = await library.addCapability({ story: story.id, title: "Claimed work" });
      await claim({ log, library, project, session: "A" }, capability.id, "building");
      const activity = await store.ownDatabase(ACTIVITY_DATABASE);
      await activity.query("UPDATE activity SET at = now() - interval '15 minutes' WHERE project = $1", [project]);
      const dataDir = path.join(home, "pgdata");
      placeTestServer(dataDir);
      await withAgent(home, claudeCode("B", { dataDir }), async (agent) => {
        const before = await agent.call("show_plan");
        assert.equal(before.isError, false, before.text);
        assert.match(before.text, /A, working/);
        assert.equal((await agent.call("claim", { capability: capability.id, reason: "taking over" })).isError, true);
        setSetting("idle-after", "10m");
        assert.equal(await claimRefusal({ log, library, project, session: "B" }, capability.id), undefined);
        const after = await agent.call("show_plan");
        assert.equal(after.isError, false, after.text);
        assert.match(after.text, /A, waiting/);
        assert.match(after.text, /A \(idle\)/);
        const taken = await agent.call("claim", { capability: capability.id, reason: "taking over" });
        assert.equal(taken.isError, false, taken.text);
        assert.equal((await readClaims(log, project))[0]?.session, "B");

        const transcript = path.join(home, "B.jsonl");
        writeFileSync(transcript, JSON.stringify({ type: "assistant", requestId: "req_1", message: { usage: { input_tokens: 123, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }) + "\n");
        await log.append(project, { session: "B", harness: "claude-code", source: "hook", kind: "session-started", transcript });
        for (const damaged of [{ "context-guidance": null, "idle-after": "10m" }, { "idle-after": "soon" }]) {
          writeFileSync(path.join(home, "settings.json"), JSON.stringify(damaged));
          const context = await agent.call("read_context");
          assert.equal(context.isError, false, context.text);
          assert.equal(context.data.tokens, 123, "a settings error cannot hide the transcript reading");
          assert.match((context.data.guidance as { absent: string }).absent, /Invalid settings file/);
        }
        const invalidIdle = await agent.call("show_plan");
        assert.equal(invalidIdle.isError, true, invalidIdle.text);
        assert.match(invalidIdle.text, /idle-after.*positive duration/);
      });
    } finally {
      if (previous === undefined) delete process.env.STORYTREE_HOME;
      else process.env.STORYTREE_HOME = previous;
      await log.close();
      await store.close();
      await dropTestProjects([project]);
    }
  });
});

test("6.65 a client that names no session keeps one session id for the tool server's life, or the one STORYTREE_SESSION_ID names in its environment, so its claims and its shell's commands are one session", async () => {
  await withProject(async ({ folder, project, log }) => {
    const sessionsOf = async () => [...new Set((await log.lines(project, { kinds: ["tool-called"] })).map((line) => `${line.session} ${line.harness}`))];
    await withAgent(folder, { client: "zed" }, async (agent) => {
      await agent.call("show_plan");
      await agent.call("show_plan");
    });
    const own = await sessionsOf();
    assert.equal(own.length, 1, `one session for both calls: ${own.join(", ")}`);
    assert.match(own[0]!, /^storytree-mcp-\S+ zed$/);

    await withAgent(folder, { client: "zed", env: { STORYTREE_SESSION_ID: "zed-chat-7" } }, async (agent) => {
      await agent.call("show_plan");
    });
    assert.ok((await sessionsOf()).includes("zed-chat-7 zed"), "the named session is the caller");
  });
});

test("6.66 a tool call from Cursor, which sends the tool server neither a session nor a call id, is recorded on the session Cursor's hook named just before it; a call no hook announced keeps the server's own session", async () => {
  await withProject(async ({ folder, project, log }) => {
    const calledBy = async (tool: string) => (await log.lines(project, { kinds: ["tool-called"], where: { tool } })).map((line) => `${line.session} ${line.harness}`);
    // Cursor's MCP client names itself "Cursor"; its hook before the call names the conversation.
    await withAgent(folder, { client: "Cursor" }, async (agent) => {
      await log.append(project, { session: "cursor-conversation-1", harness: "cursor", source: "hook", folder, kind: "tool-requested", tool: "show_plan", call: "gen-1:show_plan", agent: "orchestrator" });
      await agent.call("show_plan");
      await agent.call("stale_claims");
    });
    assert.deepEqual(await calledBy("show_plan"), ["cursor-conversation-1 cursor"]);
    const [unannounced] = await calledBy("stale_claims");
    assert.match(unannounced ?? "", /^storytree-mcp-\S+ cursor$/, "no hook announced this tool's call");
  });
});

test("6.68 a tool call from Pi, which sends the tool server neither a session nor a call id, is recorded on the session Pi's extension named just before it, never on another harness's announcement", async () => {
  await withProject(async ({ folder, project, log }) => {
    const calledBy = async (tool: string) => (await log.lines(project, { kinds: ["tool-called"], where: { tool } })).map((line) => `${line.session} ${line.harness}`);
    // Pi's MCP client names itself "pi" (measured, Pi 1.1.0); its extension's tool_call names the session and Pi's own call id.
    await withAgent(folder, { client: "pi" }, async (agent) => {
      await log.append(project, { session: "cursor-conversation-2", harness: "cursor", source: "hook", folder, kind: "tool-requested", tool: "stale_claims", call: "gen-2:stale_claims", agent: "orchestrator" });
      await log.append(project, { session: "pi-session-1", harness: "pi", source: "hook", folder, kind: "tool-requested", tool: "show_plan", call: "call_mcp_1", agent: "orchestrator" });
      await agent.call("show_plan");
      await agent.call("stale_claims");
    });
    assert.deepEqual(await calledBy("show_plan"), ["pi-session-1 pi"]);
    const [unannounced] = await calledBy("stale_claims");
    assert.match(unannounced ?? "", /^storytree-mcp-\S+ pi$/, "Cursor's announcement of the same tool is not Pi's");
  });
});
