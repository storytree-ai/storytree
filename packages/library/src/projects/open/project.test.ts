import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import { dropTestDatabases, testServerUrl, uniqueProjectName } from "../../testing/pg.js";
import { connect, ConnectionError } from "./index.js";

test("34.1 · through the project entry, two projects on one server each read only their own records, and a project's snapshot restored into an empty project reads the same", async () => {
  const names = [uniqueProjectName(), uniqueProjectName(), uniqueProjectName()];
  const [mine, theirs, copy] = names as [string, string, string];
  const storytree = await connect({ url: testServerUrl() });
  try {
    const own = await storytree.openProject(mine);
    const other = await storytree.openProject(theirs);
    const ours = await own.records.create("story", { title: "Mine" });
    const not = await other.records.create("story", { title: "Theirs" });

    assert.deepEqual((await own.records.list("story")).map(({ id }) => id), [ours.id]);
    assert.deepEqual((await other.records.list("story")).map(({ id }) => id), [not.id]);

    await storytree.restore(copy, await storytree.snapshot(mine));
    const restored = await storytree.openProject(copy);
    assert.deepEqual(await restored.records.list("story"), await own.records.list("story"));
  } finally {
    await storytree.close();
    await dropTestDatabases(names.map((name) => `storytree_${name}`));
  }
});

test("34.1 · through the project entry, an unreachable server is refused as a connection error saying it is unreachable, never showing the password", async () => {
  const secret = "hush-34-1-password";
  const home = mkdtempSync(path.join(tmpdir(), "storytree-project-"));
  const before = { home: process.env.STORYTREE_HOME, password: process.env.PGPASSWORD };
  process.env.STORYTREE_HOME = home;
  process.env.PGPASSWORD = secret;
  try {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const { port } = closed.address() as { port: number };
    await new Promise((resolve) => closed.close(resolve));

    const away = await connect({ address: `postgres://someone@127.0.0.1:${port}/` });
    try {
      await assert.rejects(away.listProjects(), (error: unknown) => {
        assert.ok(error instanceof ConnectionError, String(error));
        assert.equal(error.problem, "unreachable");
        assert.match(error.message, /could not reach the library/);
        assert.ok(!error.message.includes(secret), error.message);
        return true;
      });
    } finally {
      await away.close();
    }
  } finally {
    for (const [key, value] of [["STORYTREE_HOME", before.home], ["PGPASSWORD", before.password]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await removeTemp(home);
  }
});
