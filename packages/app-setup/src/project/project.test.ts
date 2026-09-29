import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { connect, type Storytree } from "@storytree/library";
import pg from "pg";
import { addProject, projectFolder } from "./index.js";

/** The test Postgres `pnpm test` starts; each project made here is dropped afterwards. */
async function testLibrary(t: { after(fn: () => Promise<void>): void }, projects: string[]): Promise<Storytree> {
  const url = process.env.STORYTREE_TEST_PG_URL;
  if (url === undefined) throw new Error("run the tests via `pnpm test`, which starts a local Postgres");
  const storytree = await connect({ url });
  t.after(async () => {
    await storytree.close();
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      for (const name of projects) await client.query(`DROP DATABASE IF EXISTS "storytree_${name}" WITH (FORCE)`);
    } finally {
      await client.end();
    }
  });
  return storytree;
}

test("1.7 / 3.4: a chosen folder becomes a project (created if missing, suggested its own name); one already a project is said and nothing is created; a refused name or folder leaves nothing", async (t) => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "storytree-add-project-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const token = randomBytes(4).toString("hex");
  const name = `my-site-${token}`;
  const library = await testLibrary(t, [name, `other-${token}`]);
  const home = path.join(dir, "home");
  const folder = path.join(dir, `My Site ${token}`);
  assert.deepEqual(await projectFolder(folder, { library }), { folder, suggestion: name });

  const refused = await addProject(folder, "Bad Name", { home, library });
  assert.equal(refused.status, "name refused");
  assert.equal(existsSync(path.join(folder, ".storytree.json")), false, "a refused name sets nothing up");

  const added = await addProject(folder, name, { home, library });
  assert.deepEqual(added, { status: "set up", folder, project: name });
  assert.deepEqual(JSON.parse(readFileSync(path.join(folder, ".storytree.json"), "utf8")), { project: name });
  assert.ok((await library.listProjects()).includes(name));
  assert.equal(JSON.parse(readFileSync(path.join(home, "project-choice.json"), "utf8")).current, name, "the new project is the one shown");
  assert.deepEqual(await projectFolder(folder, { library }), { folder, project: name });

  writeFileSync(path.join(home, "project-choice.json"), JSON.stringify({ current: "other" }));
  const again = await addProject(folder, "another", { home, library });
  assert.deepEqual(again, { status: "already a project", folder, project: name });
  assert.equal(JSON.parse(readFileSync(path.join(folder, ".storytree.json"), "utf8")).project, name);

  const inside = path.join(folder, "src");
  mkdirSync(inside);
  assert.deepEqual(await projectFolder(inside, { library }), { folder: inside, project: name }, "a folder inside a project belongs to it");

  const holding = await addProject(dir, `other-${token}`, { home, library });
  assert.equal(holding.status, "folder refused", "a folder holding another project's folder is no project of its own");
  assert.equal(existsSync(path.join(dir, ".storytree.json")), false);
});
