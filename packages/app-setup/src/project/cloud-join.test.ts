// Capability 6 · Make a folder a project.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { connect, type Storytree } from "@storytree/library";
import { createTestRole, dropTestRoles, testRoleUrl, withTestClient } from "@storytree/library/testing/pg";
import { ACTIVITY_DATABASE, forgetProjectActivity } from "@storytree/session-management";
import { machineNames } from "@storytree/session-management/machines";
import { changeSharedTables } from "@storytree/session-management/testing/shared-tables";
import { findProject, machineOf, PROJECT_FILE, TRUNKS_DATABASE, trunksOn } from "@storytree/project-and-caller";
import { withTempDir } from "@storytree/project-and-caller/testing/folders";
import { dropTestProjects, projectDatabase, testServerUrl, uniqueProjectName } from "@storytree/project-and-caller/testing/pg";

import { setUpProject } from "./making.js";

function grantsFile(name: string, names: { database: string; cloud: string; project: string }): string {
  return readFileSync(new URL(`../../../../infra/library-host/${name}`, import.meta.url), "utf8")
    .replaceAll("storytree_storytree", names.database)
    .replaceAll(':"cloud_role"', `"${names.cloud}"`)
    .replaceAll(":'cloud_role'", `'${names.cloud}'`)
    .replaceAll(":'cloud_project'", `'${names.project}'`);
}

test("6.18 · Joining a project signed in as the cloud sessions' role, under infra/library-host's three cloud grants files as written, resolves with the marker's path, records the container's own trunk approved by join, and leaves a marker naming the project and its database", async () => {
  const project = uniqueProjectName();
  const cloud = `${project}-cloud`;
  const database = projectDatabase(project);
  const onBox = await connect({ url: testServerUrl() });
  let inCloud: Storytree | undefined;
  try {
    await withTempDir(async (dir) => {
      await (await onBox.openProject(project)).close();
      await forgetProjectActivity(onBox, project);
      await machineNames(onBox);
      await createTestRole(cloud, { createdb: false });
      const names = { database, cloud, project };
      await withTestClient((client) => client.query(grantsFile("cloud-session-grants.sql", names)), database);
      await changeSharedTables(TRUNKS_DATABASE, (client) => client.query(grantsFile("cloud-session-trunks-grants.sql", names)));
      await changeSharedTables(ACTIVITY_DATABASE, (client) => client.query(grantsFile("cloud-session-activity-grants.sql", names)));

      const [containerHome, folder] = [path.join(dir, "container-home"), path.join(dir, "home", "user", "app")];
      mkdirSync(folder, { recursive: true });
      inCloud = await connect({ url: testRoleUrl(cloud) });
      const joined = await setUpProject({ folder, project, storytree: inCloud, storytreeHome: containerHome, join: true });

      const at = realpathSync.native(folder);
      assert.deepEqual(joined, { project, marker: path.join(at, PROJECT_FILE) });
      const container = machineOf(containerHome);
      assert.deepEqual(await trunksOn(onBox, container.id), [{ project, machine: container.id, machineName: container.name, folder: at, approvedBy: "join" }]);
      assert.deepEqual(JSON.parse(readFileSync(path.join(at, PROJECT_FILE), "utf8")), { project, identity: (await onBox.projectIdentities())[project] });
      assert.equal(findProject(at).project, project);
    });
  } finally {
    await Promise.allSettled([onBox.close(), inCloud?.close()]);
    await changeSharedTables(TRUNKS_DATABASE, async (client) => {
      await client.query(`DROP OWNED BY "${cloud}"`);
      await client.query("DELETE FROM trunks WHERE project = $1", [project]);
      await client.query("ALTER TABLE trunks DISABLE ROW LEVEL SECURITY");
    });
    await changeSharedTables(ACTIVITY_DATABASE, async (client) => {
      await client.query(`DROP OWNED BY "${cloud}"`);
      for (const table of ["activity", "transcript_records", "transcript_readings", "session_beats"]) {
        await client.query(`DELETE FROM ${table} WHERE project = $1`, [project]);
        await client.query(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
      }
    });
    await dropTestProjects([project]);
    await dropTestRoles([cloud]);
  }
});
