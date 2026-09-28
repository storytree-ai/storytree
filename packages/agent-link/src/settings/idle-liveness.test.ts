/** Contract 10.10: the user's idle duration controls both liveness and claim takeover. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { connect } from "@storytree/library";
import { openActivityLog, type ActivityLog } from "../activity/index.js";
import { claim, readClaims } from "../claims/index.js";
import { readSessions } from "../sessions/index.js";
import { withTempDir } from "../testing/folders.js";
import { dropTestProjects, testServerUrl, uniqueProjectName } from "../testing/pg.js";
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
      const later: ActivityLog = {
        append: (...args) => log.append(...args),
        since: (...args) => log.since(...args),
        close: () => log.close(),
        locked: (name, work) => log.locked(name, (locked) => work({ ...locked, now: async () => now })),
      };
      const claimant = { log: later, library, project, session: "B" };
      assert.equal((await readSessions(log, project, { now }))[0]?.state, "live");
      assert.equal((await readClaims(log, project, { now }))[0]?.holder, "live");
      assert.equal((await claim(claimant, capability.id, "taking over")).ok, false);

      setSetting("idle-after", "10m");
      assert.equal((await readSessions(log, project, { now }))[0]?.state, "idle");
      assert.equal((await readClaims(log, project, { now }))[0]?.holder, "idle");
      const taken = await claim(claimant, capability.id, "taking over");
      assert.ok(taken.ok);
      assert.equal(taken.takenOverFrom?.session, "A");

      await log.append(project, { session: "B", source: "hook", kind: "command-started", command: "build", call: "running" });
      assert.equal((await readSessions(log, project, { now })).find((session) => session.session === "B")?.state, "live");
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
