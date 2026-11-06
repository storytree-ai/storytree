/**
 * Capability 2 · Agent activity log, contract 2.14 (ADR-1264 D1): the cloud sessions' own account, granted exactly what
 * infra/library-host/cloud-session-activity-grants.sql grants, opens the log as itself and writes its project's lines,
 * beats and transcripts through the log's own writes, and is refused every other project's rows, any change or removal,
 * and any change to the tables. The log's database is the test server's one `storytree-activity`, shared by every test
 * there, so this test writes only under its own project names and takes its rows and its role's grants away after.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { connect, type Storytree } from "@storytree/library";
import { createTestRole, dropTestRoles, testRoleUrl, withTestClient, withTestClientAs } from "@storytree/library/testing/pg";

import { testServerUrl, uniqueProjectName } from "@storytree/project-and-caller/testing/pg";
import { ACTIVITY_DATABASE, forgetProjectActivity, openActivityLog } from "./index.js";
import { despiteDeadlocks } from "../testing/shared-tables.js";

test("2.14 · The cloud sessions' account adds and reads back its project's lines, beats and transcripts through the log's own writes, and is refused another project's rows, any change or removal, and any change to the tables", async () => {
  const [project, other] = [uniqueProjectName(), uniqueProjectName()];
  const cloud = `${project}-cloud`;
  const onBox = await connect({ url: testServerUrl() });
  let inCloud: Storytree | undefined;
  try {
    await createTestRole(cloud, { createdb: false });
    // The owner sets the log up and writes another project's line before the account is granted anything.
    const ownerLog = await openActivityLog(onBox, { machine: "mint" });
    await ownerLog.append(other, { session: "box-lane", harness: "codex", source: "hook", kind: "session-named", title: "On the box" });
    const grants = readFileSync(new URL("../../../../infra/library-host/cloud-session-activity-grants.sql", import.meta.url), "utf8")
      .replaceAll(':"cloud_role"', `"${cloud}"`).replaceAll(":'cloud_role'", `'${cloud}'`).replaceAll(":'cloud_project'", `'${project}'`);
    await despiteDeadlocks(() => withTestClient((client) => client.query(grants), ACTIVITY_DATABASE));

    inCloud = await connect({ url: testRoleUrl(cloud) });
    const log = await openActivityLog(inCloud, { machine: "cloud" });

    // What a lane writes: its claims and releases, its session's name and close-out, and queued hook lines.
    const lane = { session: "lane", harness: "claude-code", source: "tool" } as const;
    await log.append(project, { ...lane, kind: "claimed", increment: "increment-overflow", reason: "build it" });
    await log.append(project, { ...lane, kind: "session-named", title: "Overflow" });
    await log.appendMany(project, [{ line: { ...lane, source: "hook", kind: "prompt-submitted" }, at: new Date().toISOString() }]);
    assert.equal((await log.locked(project, (locked) => locked.standing())).length, 1, "claim admission reads who holds what under the lock");
    await log.append(project, { ...lane, kind: "released", increment: "increment-overflow" });
    await log.append(project, { ...lane, kind: "closed-out", safe: true, why: "handed to the watcher" });
    // Its beats and transcript readings are upserts: written twice, kept once.
    await log.beats.beat(project, "lane");
    await log.beats.beat(project, "lane", { ended: true });
    const record = { part: "", start: 0, finish: 12, record: '{"turn": 1}' };
    await log.transcripts.store(project, "lane", [record]);
    await log.transcripts.store(project, "lane", [record]);
    await log.transcripts.keep(project, "lane", { turns: 1 });
    await log.transcripts.keep(project, "lane", { turns: 2 });

    assert.deepEqual((await log.since(project, 0)).lines.map((line) => line.kind), ["claimed", "session-named", "prompt-submitted", "released", "closed-out"]);
    assert.equal((await log.beats.of(project, ["lane"])).size, 1);
    assert.equal(await log.transcripts.text(project, "lane"), '{"turn": 1}');
    assert.deepEqual(await log.transcripts.kept(project, "lane"), { turns: 2 });
    assert.deepEqual((await ownerLog.since(project, 0)).lines.map((line) => [line.session, line.machine])[0], ["lane", "cloud"], "the owner reads what the cloud wrote");

    // Another project's rows: not there for it to read, and refused to write.
    assert.deepEqual((await log.since(other, 0)).lines, []);
    await assert.rejects(log.append(other, { ...lane, kind: "session-named", title: "Elsewhere?" }), /row-level security/);
    await assert.rejects(log.beats.beat(other, "lane"), /row-level security/);
    await assert.rejects(log.transcripts.store(other, "lane", [record]), /row-level security/);
    await assert.rejects(log.transcripts.keep(other, "lane", {}), /row-level security/);

    // No line is changed or removed, nor any transcript or beat, and no project's activity forgotten.
    await assert.rejects(log.transcripts.deleteBefore(new Date(Date.now() + 60_000)), /permission denied/);
    await assert.rejects(forgetProjectActivity(inCloud, project), /permission denied/);
    const sql = (statement: string) => withTestClientAs(cloud, (client) => client.query(statement), ACTIVITY_DATABASE);
    for (const change of [
      "UPDATE activity SET detail = '{}'", "DELETE FROM activity", "UPDATE transcript_records SET record = ''",
      "DELETE FROM session_beats", "DELETE FROM transcript_readings", "TRUNCATE activity",
    ]) {
      await assert.rejects(sql(change), /permission denied/, change);
    }
    // No change to the tables, and no way out of the rules.
    for (const ddl of [
      "CREATE TABLE cloud_own (n int)",
      "ALTER TABLE activity DISABLE ROW LEVEL SECURITY",
      "DROP POLICY cloud_session_project ON activity",
      "DROP TABLE session_beats",
      "CREATE INDEX IF NOT EXISTS activity_project_seq_idx ON activity (project, seq)",
    ]) {
      await assert.rejects(sql(ddl), /must be owner|permission denied/, ddl);
    }
    assert.deepEqual((await ownerLog.since(other, 0)).lines.map((line) => line.session), ["box-lane"], "the other project's line is as the owner wrote it");
  } finally {
    await despiteDeadlocks(() => withTestClient(async (client) => {
      // The shared log is left as it was: these rows gone, the account's grants and policies with it, the rules off.
      await client.query(`DROP OWNED BY "${cloud}"`);
      for (const table of ["activity", "transcript_records", "transcript_readings", "session_beats"]) {
        await client.query(`DELETE FROM ${table} WHERE project = ANY ($1)`, [[project, other]]);
        await client.query(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
      }
    }, ACTIVITY_DATABASE));
    await Promise.allSettled([onBox.close(), inCloud?.close()]);
    await dropTestRoles([cloud]);
  }
});
