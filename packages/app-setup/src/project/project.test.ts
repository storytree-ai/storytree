import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { connect, type Storytree } from "@storytree/library";
import pg from "pg";
import { setUpProject } from "@storytree/agent-link";
import { addProject, projectFolder, projectsOnThisComputer, removeProject } from "./index.js";

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
  const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), "storytree-add-project-")));
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

test("removing a project takes it off this computer's list, keeps its records and frees its folder here: set up afresh, or joined on purpose; an unknown name is refused", async (t) => {
  const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), "storytree-remove-project-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const token = randomBytes(4).toString("hex");
  const name = `downloads-${token}`;
  const library = await testLibrary(t, [name, `site-${token}`]);
  const home = path.join(dir, "home");
  const folder = path.join(dir, name);
  assert.equal((await addProject(folder, name, { home, library })).status, "set up");
  assert.ok(projectsOnThisComputer(await library.listProjects(), home).includes(name));

  assert.deepEqual(await removeProject(name, { home, library }), { status: "removed", project: name, freed: folder });
  assert.ok((await library.listProjects()).includes(name), "its records stay in the library");
  assert.equal(projectsOnThisComputer(await library.listProjects(), home).includes(name), false, "it leaves this computer's list");
  assert.equal(existsSync(path.join(folder, ".storytree.json")), false, "its folder is no longer the project's");

  const elsewhere = path.join(dir, "elsewhere");
  mkdirSync(elsewhere);
  await setUpProject({ folder: elsewhere, project: name, storytree: library, storytreeHome: home, join: true });
  assert.deepEqual(await addProject(folder, `site-${token}`, { home, library }), { status: "set up", folder, project: `site-${token}` }, "the freed folder can be set up afresh");

  const unknown = await removeProject(`nothing-${token}`, { home, library });
  assert.equal(unknown.status, "no such project");
});

test("removing a project whose marker git tracks leaves the folder as it is and says so; adding it again brings the project back", async (t) => {
  const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), "storytree-remove-tracked-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const token = randomBytes(4).toString("hex");
  const name = `tracked-${token}`;
  const library = await testLibrary(t, [name]);
  const home = path.join(dir, "home");
  const folder = path.join(dir, name);
  assert.equal((await addProject(folder, name, { home, library })).status, "set up");
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: folder, stdio: "ignore" });
  git("init", "-q");
  git("add", ".storytree.json");
  git("commit", "-qm", "marker");

  assert.deepEqual(await removeProject(name, { home, library }), { status: "removed", project: name, kept: folder });
  assert.equal(JSON.parse(readFileSync(path.join(folder, ".storytree.json"), "utf8")).project, name, "a marker in git is not deleted");
  assert.equal(projectsOnThisComputer(await library.listProjects(), home).includes(name), false);
  assert.deepEqual(await addProject(folder, "anything", { home, library }), { status: "already a project", folder, project: name });
  assert.ok(projectsOnThisComputer(await library.listProjects(), home).includes(name), "adding its folder again brings it back");
});
