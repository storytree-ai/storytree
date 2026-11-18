// Capability 2 · Agent activity log
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { connect, type Storytree } from "@storytree/library";
import { createTestRole, dropTestRoles, testRoleUrl, withTestClientAs } from "@storytree/library/testing/pg";

import { testServerUrl, uniqueProjectName } from "@storytree/project-and-caller/testing/pg";
import { ACTIVITY_DATABASE, forgetProjectActivity, openActivityLog } from "./index.js";
import { changeSharedTables } from "../testing/shared-tables.js";

test("2.14 · The cloud sessions' account adds and reads back its project's lines, beats and transcripts through the log's own writes, and is refused another project's rows, any change or removal, and any change to the tables", async () => {
  const [project, other] = [uniqueProjectName(), uniqueProjectName()];
  const cloud = `${project}-cloud`;
  const onBox = await connect({ url: testServerUrl() });
  let inCloud: Storytree | undefined;
  try {
    await createTestRole(cloud, { createdb: false });
    const ownerLog = await openActivityLog(onBox, { machine: "mint" });
    await ownerLog.append(other, { session: "box-lane", harness: "codex", source: "hook", kind: "session-named", title: "On the box" });
    const grants = readFileSync(new URL("../../../../infra/library-host/cloud-session-activity-grants.sql", import.meta.url), "utf8")
      .replaceAll(':"cloud_role"', `"${cloud}"`).replaceAll(":'cloud_role'", `'${cloud}'`).replaceAll(":'cloud_project'", `'${project}'`);
    await changeSharedTables(ACTIVITY_DATABASE, (client) => client.query(grants));

    inCloud = await connect({ url: testRoleUrl(cloud) });
    const log = await openActivityLog(inCloud, { machine: "cloud" });

    const lane = { session: "lane", harness: "claude-code", source: "tool" } as const;
    await log.append(project, { ...lane, kind: "claimed", increment: "increment-overflow", reason: "build it" });
    await log.append(project, { ...lane, kind: "session-named", title: "Overflow" });
    await log.appendMany(project, [{ line: { ...lane, source: "hook", kind: "prompt-submitted" }, at: new Date().toISOString() }]);
    assert.equal((await log.locked(project, (locked) => locked.standing())).length, 1, "claim admission reads who holds what under the lock");
    await log.append(project, { ...lane, kind: "released", increment: "increment-overflow" });
    await log.append(project, { ...lane, kind: "closed-out", safe: true, why: "handed to the watcher" });
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

    assert.deepEqual((await log.since(other, 0)).lines, []);
    await assert.rejects(log.append(other, { ...lane, kind: "session-named", title: "Elsewhere?" }), /row-level security/);
    await assert.rejects(log.beats.beat(other, "lane"), /row-level security/);
    await assert.rejects(log.transcripts.store(other, "lane", [record]), /row-level security/);
    await assert.rejects(log.transcripts.keep(other, "lane", {}), /row-level security/);

    await assert.rejects(log.transcripts.deleteBefore(new Date(Date.now() + 60_000)), /permission denied/);
    await assert.rejects(forgetProjectActivity(inCloud, project), /permission denied/);
    const sql = (statement: string) => withTestClientAs(cloud, (client) => client.query(statement), ACTIVITY_DATABASE);
    for (const change of [
      "UPDATE activity SET detail = '{}'", "DELETE FROM activity", "UPDATE transcript_records SET record = ''",
      "DELETE FROM session_beats", "DELETE FROM transcript_readings", "TRUNCATE activity",
    ]) {
      await assert.rejects(sql(change), /permission denied/, change);
    }
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
    await changeSharedTables(ACTIVITY_DATABASE, async (client) => {
      await client.query(`DROP OWNED BY "${cloud}"`);
      for (const table of ["activity", "transcript_records", "transcript_readings", "session_beats"]) {
        await client.query(`DELETE FROM ${table} WHERE project = ANY ($1)`, [[project, other]]);
        await client.query(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
      }
    });
    await Promise.allSettled([onBox.close(), inCloud?.close()]);
    await dropTestRoles([cloud]);
  }
});
