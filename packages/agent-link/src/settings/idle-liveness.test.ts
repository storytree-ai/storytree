/** Contract 10.10: the user's idle duration controls both liveness and claim takeover. */
import assert from "node:assert/strict";
import { copyFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { connect } from "@storytree/library";
import { ACTIVITY_DATABASE, openActivityLog, type ActivityLog, type LockedLog } from "../activity/index.js";
import { claim, claimRefusal, readClaims } from "../claims/index.js";
import { claimsFrom, sessionsFrom } from "../readings.js";
import { readSessions } from "../sessions/index.js";
import { claudeCode, withAgent } from "../testing/agent.js";
import { withTempDir } from "../testing/folders.js";
import { dropTestProjects, testServerDataDir, testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { setSetting } from "./settings.js";

test("10.10 after 15 quiet minutes, the default keeps sessions and claims live; 10m makes them idle and permits takeover", async () => {
  await withTempDir(async (home) => {
    const previous = process.env.STORYTREE_HOME;
    process.env.STORYTREE_HOME = home;
    const project = uniqueProjectName();
    const store = await connect({ url: testServerUrl() });
    const log = await openActivityLog(testServerUrl());
    try {
      const library = await store.openProject(project);
      const story = await library.addStory({ title: "Idle setting" });
      const capability = await library.addCapability({ story: story.id, title: "Claimed work" });
      const first = await claim({ log, library, project, session: "A" }, capability.id, "building");
      assert.ok(first.ok);
      const now = new Date(Date.parse(first.claim.since) + 15 * 60_000);
      // Move only the log's clock forward: no wall-clock sleep and no settings-derived override.
      const later = new Proxy(log, {
        get(target, key) {
          if (key === "locked") return (name: string, work: (locked: LockedLog) => Promise<unknown>) => log.locked(name, (locked) => work({ ...locked, now: async () => now }));
          const value = Reflect.get(target, key) as unknown;
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const claimant = { log: later, library, project, session: "B" };
      assert.equal((await readSessions(log, project, { now }))[0]?.state, "working");
      assert.equal((await readClaims(log, project, { now }))[0]?.holder, "live");
      assert.equal((await claim(claimant, capability.id, "taking over")).ok, false);

      setSetting("idle-after", "10m");
      assert.equal((await readSessions(log, project, { now }))[0]?.state, "waiting");
      assert.equal((await readClaims(log, project, { now }))[0]?.holder, "idle");
      const { lines } = await log.since(project, 0);
      assert.equal(sessionsFrom(lines, { now })[0]?.state, "working", "the browser default stays 30m");
      assert.equal(claimsFrom(lines, { now })[0]?.holder, "live");
      assert.equal(sessionsFrom(lines, { now, quietMs: 10 * 60_000 })[0]?.state, "waiting");
      assert.equal(claimsFrom(lines, { now, quietMs: 10 * 60_000 })[0]?.holder, "idle");
      const taken = await claim(claimant, capability.id, "taking over");
      assert.ok(taken.ok);
      assert.equal(taken.takenOverFrom?.session, "A");

      await log.append(project, { session: "B", source: "hook", kind: "command-started", command: "build", call: "running" });
      assert.equal((await readSessions(log, project, { now })).find((session) => session.session === "B")?.state, "working");
      assert.equal((await readClaims(log, project, { now }))[0]?.holder, "live");
      assert.equal((await claim({ ...claimant, session: "C" }, capability.id, "command still running")).ok, false);
    } finally {
      if (previous === undefined) delete process.env.STORYTREE_HOME;
      else process.env.STORYTREE_HOME = previous;
      await log.close();
      await store.close();
      await dropTestProjects([project]);
    }
  });
});

test("10.10 / 9.7 a running MCP server rereads idle-after without blocking independent context readings", async () => {
  await withTempDir(async (home) => {
    const previous = process.env.STORYTREE_HOME;
    process.env.STORYTREE_HOME = home;
    const project = uniqueProjectName();
    const store = await connect({ url: testServerUrl() });
    const log = await openActivityLog(testServerUrl());
    try {
      writeFileSync(path.join(home, ".storytree.json"), JSON.stringify({ project }));
      const library = await store.openProject(project);
      const story = await library.addStory({ title: "Idle setting" });
      const capability = await library.addCapability({ story: story.id, title: "Claimed work" });
      await claim({ log, library, project, session: "A" }, capability.id, "building");
      const activity = await store.ownDatabase(ACTIVITY_DATABASE);
      await activity.query("UPDATE activity SET at = now() - interval '15 minutes' WHERE project = $1", [project]);
      const dataDir = path.join(home, "pgdata");
      copyFileSync(`${testServerDataDir()}.owner.json`, `${dataDir}.owner.json`);
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
