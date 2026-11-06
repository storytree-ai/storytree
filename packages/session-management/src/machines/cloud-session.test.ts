/**
 * Capability 11 · Machines, contract 11.8 (ADR-1264 D1): the cloud sessions' own account, granted exactly what
 * infra/library-host/cloud-session-trunks-grants.sql grants, joins its project as a cloud container does: a fresh,
 * unnamed machine that reads every trunk and machine name, and records and approves its own trunk through storytree's
 * own writes (`doctor --join`'s registerTrunk and approveTrunk). It is refused a named machine's trunks, another
 * project's, naming a machine, recording an import, any removal, and any change to the tables. The trunks database is
 * the test server's one `storytree-trunks`, shared by every test there, so this test writes only under its own names and
 * takes its rows and its role's grants away after.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { connect, type Storytree } from "@storytree/library";
import { createTestRole, dropTestRoles, testRoleUrl, withTestClient, withTestClientAs } from "@storytree/library/testing/pg";

import { approveTrunk, forgetTrunk, machineOf, recordImport, registerTrunk, TRUNKS_DATABASE, trunksOn } from "@storytree/project-and-caller";
import { removeTempDir } from "@storytree/project-and-caller/testing/folders";
import { testServerUrl, uniqueProjectName } from "@storytree/project-and-caller/testing/pg";
import { machineNames, nameThisMachine, thisComputer } from "./machines.js";

test("11.8 · The cloud sessions' account joins as an unnamed machine: it reads every trunk and machine name and records and approves its own trunk, and is refused a named machine's trunks, another project's, naming a machine, an import, any removal, and any change to the tables", async () => {
  const [project, other] = [uniqueProjectName(), uniqueProjectName()];
  const cloud = `${project}-cloud`;
  const homes = await Promise.all(["box", "laptop", "container"].map((name) => mkdtemp(path.join(tmpdir(), `st-${name}-`))));
  const machine = (home: string) => ({ home, ...machineOf(home) });
  const [box, laptop, container] = [machine(homes[0]!), machine(homes[1]!), machine(homes[2]!)];
  const [boxName, laptopName] = [`m-${randomBytes(4).toString("hex")}`, `m-${randomBytes(4).toString("hex")}`];
  const onBox = await connect({ url: testServerUrl() });
  let inCloud: Storytree | undefined;
  try {
    await createTestRole(cloud, { createdb: false });
    // The owner names the box and the laptop, and records the box's trunk, before the account is granted anything.
    await nameThisMachine(onBox, boxName, { home: box.home, host: `${boxName}-host` });
    await nameThisMachine(onBox, laptopName, { home: laptop.home, host: `${laptopName}-host` });
    assert.ok(await registerTrunk(onBox, { project, machine: box.id, machineName: box.name, folder: `/srv/${project}` }, "setup"));
    const grants = readFileSync(new URL("../../../../infra/library-host/cloud-session-trunks-grants.sql", import.meta.url), "utf8")
      .replaceAll(':"cloud_role"', `"${cloud}"`).replaceAll(":'cloud_role'", `'${cloud}'`).replaceAll(":'cloud_project'", `'${project}'`);
    await withTestClient((client) => client.query(grants), TRUNKS_DATABASE);

    inCloud = await connect({ url: testRoleUrl(cloud) });
    // A join: it looks for its machine's trunks, records its checkout's, and approves it.
    assert.deepEqual(await trunksOn(inCloud, container.id), []);
    const folder = `/home/user/${project}`;
    assert.ok(await registerTrunk(inCloud, { project, machine: container.id, machineName: container.name, folder }));
    assert.ok(await approveTrunk(inCloud, { project, machine: container.id, folder }, "join"));
    assert.deepEqual((await trunksOn(inCloud, container.id)).map((trunk) => [trunk.project, trunk.folder, trunk.approvedBy]), [[project, folder, "join"]]);
    // It reads the box's trunk and every machine's name, and knows itself unnamed.
    assert.deepEqual((await trunksOn(inCloud, box.id)).map((trunk) => trunk.folder), [`/srv/${project}`]);
    assert.equal((await machineNames(inCloud)).get(`${laptopName}-host`), laptopName);
    assert.equal((await thisComputer(inCloud, { home: container.home })).name, undefined);

    // A named machine's trunks are out of its reach: none recorded on one, and the box's left as the owner wrote it.
    await assert.rejects(registerTrunk(inCloud, { project, machine: laptop.id, machineName: laptop.name, folder: "/elsewhere" }), /row-level security/);
    assert.equal(await approveTrunk(inCloud, { project, machine: box.id, folder: `/srv/${project}` }, "join"), false);
    const sql = (statement: string, params: unknown[] = []) => withTestClientAs(cloud, (client) => client.query(statement, params), TRUNKS_DATABASE);
    assert.equal((await sql("UPDATE trunks SET folder = '/moved', machine = $2 WHERE machine = $1", [box.id, container.id])).rowCount, 0);
    // Nor another project's, nor its own trunk moved onto a named machine.
    await assert.rejects(registerTrunk(inCloud, { project: other, machine: container.id, machineName: container.name, folder: "/other" }), /row-level security/);
    await assert.rejects(sql("UPDATE trunks SET machine = $1 WHERE machine = $2", [laptop.id, container.id]), /row-level security/);

    // It names no machine, records no import, and removes nothing.
    await assert.rejects(nameThisMachine(inCloud, `m-${randomBytes(4).toString("hex")}`, { home: container.home }), /permission denied/);
    await assert.rejects(recordImport(inCloud, { project, machine: container.id, machineName: container.name, folder: "/imported" }), /permission denied/);
    await assert.rejects(forgetTrunk(inCloud, { project, machine: container.id }, container.home), /permission denied/);
    for (const change of ["DELETE FROM machines", "DELETE FROM imports", "TRUNCATE trunks"]) {
      await assert.rejects(sql(change), /permission denied/, change);
    }
    // No change to the tables, and no way out of the rules.
    for (const ddl of [
      "CREATE TABLE cloud_own (n int)",
      "ALTER TABLE trunks DISABLE ROW LEVEL SECURITY",
      "DROP POLICY cloud_session_insert ON trunks",
      "DROP TABLE machines",
    ]) {
      await assert.rejects(sql(ddl), /must be owner|permission denied/, ddl);
    }
    assert.deepEqual((await trunksOn(onBox, box.id)).filter((trunk) => trunk.project === project).map((trunk) => [trunk.folder, trunk.approvedBy]), [[`/srv/${project}`, "setup"]]);
  } finally {
    await withTestClient(async (client) => {
      // The shared database is left as it was: these rows gone, the account's grants and policies with it, the rules off.
      await client.query(`DROP OWNED BY "${cloud}"`);
      await client.query("DELETE FROM trunks WHERE project = ANY ($1)", [[project, other]]);
      await client.query("DELETE FROM imports WHERE project = ANY ($1)", [[project, other]]);
      await client.query("DELETE FROM machines WHERE id = ANY ($1)", [[box.id, laptop.id, container.id]]);
      await client.query("ALTER TABLE trunks DISABLE ROW LEVEL SECURITY");
    }, TRUNKS_DATABASE).catch(() => undefined);
    await Promise.allSettled([onBox.close(), inCloud?.close()]);
    await dropTestRoles([cloud]);
    await Promise.all(homes.map((home) => removeTempDir(home)));
  }
});
