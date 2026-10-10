import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { connect, type Storytree } from "@storytree/library";
import { dropTestDatabases } from "@storytree/local-postgres/testing";
import { openActivityLog, requireApproval } from "@storytree/agent-link";

import { setUpProject } from "./making.js";
import { addProject, deleteProject, projectFolder, projectsOnThisComputer, removeProject } from "./index.js";

/** The test Postgres `pnpm test` starts; each project made here is dropped afterwards. */
async function testLibrary(t: { after(fn: () => Promise<void>): void }, projects: string[]): Promise<Storytree> {
  const url = process.env.STORYTREE_TEST_PG_URL;
  if (url === undefined) throw new Error("run the tests via `pnpm test`, which starts a local Postgres");
  const storytree = await connect({ url });
  t.after(async () => {
    await storytree.close();
    await dropTestDatabases(projects.map((name) => `storytree_${name}`));
  });
  return storytree;
}

test("1.7 / 3.4: a chosen folder becomes a project (created if missing, suggested its own name); one already a project is said and nothing is created; a refused name or folder leaves nothing", async (t) => {
  const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), "storytree-add-project-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const token = `t-${randomBytes(4).toString("hex")}`;
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
  assert.equal(JSON.parse(readFileSync(path.join(folder, ".storytree.json"), "utf8")).project, name);
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

test("removing a project takes it off this computer's list, keeps its records and frees its folder here: set up afresh, or joined on purpose, which brings it back; an unknown name is refused", async (t) => {
  const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), "storytree-remove-project-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const token = `t-${randomBytes(4).toString("hex")}`;
  const name = `downloads-${token}`;
  const library = await testLibrary(t, [name, `site-${token}`]);
  const home = path.join(dir, "home");
  const folder = path.join(dir, name);
  assert.equal((await addProject(folder, name, { home, library })).status, "set up");
  assert.ok(projectsOnThisComputer(await library.projectIdentities(), home).includes(name));

  assert.deepEqual(await removeProject(name, { home, library }), { status: "removed", project: name, freed: folder });
  assert.ok((await library.listProjects()).includes(name), "its records stay in the library");
  assert.equal(projectsOnThisComputer(await library.projectIdentities(), home).includes(name), false, "it leaves this computer's list");
  assert.equal(existsSync(path.join(folder, ".storytree.json")), false, "its folder is no longer the project's");

  const elsewhere = path.join(dir, "elsewhere");
  mkdirSync(elsewhere);
  await setUpProject({ folder: elsewhere, project: name, storytree: library, storytreeHome: home, join: true });
  assert.ok(projectsOnThisComputer(await library.projectIdentities(), home).includes(name), "joining it on purpose brings it back to this computer's list");
  assert.deepEqual(await addProject(folder, `site-${token}`, { home, library }), { status: "set up", folder, project: `site-${token}` }, "the freed folder can be set up afresh");

  const unknown = await removeProject(`nothing-${token}`, { home, library });
  assert.equal(unknown.status, "no such project");
});

test("removing a project whose marker git tracks leaves the folder as it is and says so; adding it again brings the project back", async (t) => {
  const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), "storytree-remove-tracked-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const token = `t-${randomBytes(4).toString("hex")}`;
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
  assert.equal(projectsOnThisComputer(await library.projectIdentities(), home).includes(name), false);
  assert.deepEqual(await addProject(folder, "anything", { home, library }), { status: "already a project", folder, project: name });
  assert.ok(projectsOnThisComputer(await library.projectIdentities(), home).includes(name), "adding its folder again brings it back");
});

test("3.7 / 3.6 removing or deleting a project drops the approval its own storytree home remembers, so its folder is refused afterwards", async (t) => {
  const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), "storytree-forget-approval-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const token = `t-${randomBytes(4).toString("hex")}`;
  const removed = `removed-${token}`, deleted = `deleted-${token}`;
  const library = await testLibrary(t, [removed, deleted]);
  const home = path.join(dir, "home");
  for (const [name, gone] of [[removed, () => removeProject(removed, { home, library })], [deleted, () => deleteProject(deleted, { home, library, snapshot: false, confirm: deleted })]] as const) {
    const folder = path.join(dir, name);
    assert.equal((await addProject(folder, name, { home, library })).status, "set up");
    writeFileSync(path.join(home, "project-choice.json"), JSON.stringify({ current: "elsewhere" }));
    await requireApproval(library, name, folder, home);
    await gone();
    await assert.rejects(requireApproval(library, name, folder, home), `${name}'s folder is refused once it is gone from this computer`);
  }
});

test("3.6 deleting a project drops its records for every machine once its name is typed, after a snapshot into this machine's backups that restores it; refused for a wrong name, the project in use, or one a live session holds a claim in", async (t) => {
  const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), "storytree-delete-project-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const token = `t-${randomBytes(4).toString("hex")}`;
  const name = `downloads-${token}`;
  const library = await testLibrary(t, [name]);
  const home = path.join(dir, "home");
  const folder = path.join(dir, name);
  assert.equal((await addProject(folder, name, { home, library })).status, "set up");
  const log = await openActivityLog(library);
  t.after(() => log.close());
  const session = `other-${token}`;
  await log.append(name, { session, source: "tool", kind: "claimed", capability: `capability_${token}`, reason: "building" });

  const still = async () => (await library.listProjects()).includes(name);
  const refused = async (options: { confirm: string; inUse?: string }, why: RegExp) => {
    const answer = await deleteProject(name, { home, library, snapshot: true, ...options });
    assert.equal(answer.status, "refused");
    assert.match("message" in answer ? answer.message : "", why);
    assert.ok(await still(), "a refusal deletes nothing");
  };
  await refused({ confirm: "downloads" }, /type/i);
  await refused({ confirm: name }, /in use/i); // the app on this computer shows it
  writeFileSync(path.join(home, "project-choice.json"), JSON.stringify({ current: "elsewhere" }));
  await refused({ confirm: name, inUse: name }, /in use/i); // the folder a command runs in is its
  await refused({ confirm: name }, new RegExp(`${session}.*building|building.*${session}`));
  await log.append(name, { session, source: "tool", kind: "released", capability: `capability_${token}` });

  const deleted = await deleteProject(name, { home, library, snapshot: true, confirm: name });
  assert.equal(deleted.status, "deleted");
  assert.equal(await still(), false, "its database is gone from the library");
  assert.equal(existsSync(path.join(folder, ".storytree.json")), false, "its folder here is no longer a project");
  const backups = path.join(home, "backups", name);
  const [file] = readdirSync(backups);
  assert.equal("snapshot" in deleted ? deleted.snapshot : undefined, path.join(backups, file!));
  await library.restore(name, JSON.parse(readFileSync(path.join(backups, file!), "utf8")));
  assert.ok(await still(), "the snapshot brings the project back");

  assert.equal((await deleteProject(name, { home, library, snapshot: false, confirm: name })).status, "deleted");
  assert.deepEqual(readdirSync(backups), [file], "a skipped snapshot writes none");
  assert.equal((await deleteProject(name, { home, library, snapshot: false, confirm: name })).status, "no such project");
});

test("3.6 a deleted project leaves no activity behind and leaves every computer's hidden list: a new project of its name starts with no old claims, and is shown", async (t) => {
  const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), "storytree-delete-traces-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const token = `t-${randomBytes(4).toString("hex")}`;
  const name = `scratch-${token}`;
  const library = await testLibrary(t, [name]);
  const [home, other] = [path.join(dir, "home"), path.join(dir, "other")];
  assert.equal((await addProject(path.join(dir, "first"), name, { home, library })).status, "set up");
  const log = await openActivityLog(library);
  t.after(() => log.close());
  await log.append(name, { session: `old-${token}`, source: "tool", kind: "claimed", capability: `capability_${token}`, reason: "left behind" });
  await log.append(name, { session: `old-${token}`, source: "tool", kind: "released", capability: `capability_${token}` });
  await log.transcripts.store(name, `old-${token}`, [{ part: "", start: 0, finish: 3, record: "{}\n" }]);
  assert.equal((await removeProject(name, { home: other, library })).status, "removed", "another computer hid it");
  writeFileSync(path.join(home, "project-choice.json"), JSON.stringify({ current: "elsewhere" }));

  assert.equal((await deleteProject(name, { home, library, snapshot: false, confirm: name })).status, "deleted");
  assert.deepEqual((await log.since(name, 0)).lines, [], "its lines go with it");
  assert.equal(await log.transcripts.text(name, `old-${token}`), undefined, "and its transcripts");
  projectsOnThisComputer(await library.projectIdentities(), other); // the other computer's app lists its projects

  assert.equal((await addProject(path.join(dir, "second"), name, { home, library })).status, "set up");
  assert.ok(projectsOnThisComputer(await library.projectIdentities(), other).includes(name), "the new project of that name is shown there");
});

test("3.6 a new project of a deleted one's name inherits nothing: not the lines an older computer's hooks wrote under the name since, nor a hidden list on a computer that has not listed its projects since", async (t) => {
  const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), "storytree-delete-again-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const token = `t-${randomBytes(4).toString("hex")}`;
  const name = `scratch-${token}`;
  const library = await testLibrary(t, [name]);
  const [home, other] = [path.join(dir, "home"), path.join(dir, "other")];
  assert.equal((await addProject(path.join(dir, "first"), name, { home, library })).status, "set up");
  assert.equal((await removeProject(name, { home: other, library })).status, "removed", "another computer hid it");
  writeFileSync(path.join(home, "project-choice.json"), JSON.stringify({ current: "elsewhere" }));
  assert.equal((await deleteProject(name, { home, library, snapshot: false, confirm: name })).status, "deleted");
  const log = await openActivityLog(library);
  t.after(() => log.close());
  await log.append(name, { session: `stale-${token}`, source: "hook", kind: "session-started" }); // an older install's hook, in a folder still naming it

  assert.equal((await addProject(path.join(dir, "second"), name, { home, library })).status, "set up");
  assert.deepEqual((await log.since(name, 0)).lines, [], "the new project starts with no lines");
  assert.ok(projectsOnThisComputer(await library.projectIdentities(), other).includes(name), "and is shown on the computer that hid the old one");
});
