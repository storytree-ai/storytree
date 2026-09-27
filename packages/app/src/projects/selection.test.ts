import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { projectSelection } from "./selection.js";

test("2.2, 2.4 a newly set-up first project appears on the next read, and another new project counts as a choice", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "app-projects-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let projects: string[] = [];
  let queries = 0;
  const listProjects = async () => { queries++; return [...projects]; };
  const file = path.join(dir, "project-choice.json");
  const app = projectSelection({ listProjects, file });
  assert.deepEqual(await app.read(), { projects: [], current: undefined });
  projects = ["my-site"];
  writeFileSync(file, JSON.stringify({ current: "my-site" }));
  assert.deepEqual(await app.read(), { projects, current: "my-site" });
  projects = ["another-site", "my-site"];
  writeFileSync(file, JSON.stringify({ current: "another-site" }));
  assert.deepEqual(await app.read(), { projects, current: "another-site" });
  assert.equal(queries, 3, "one list query per refresh");
  assert.equal((await projectSelection({ listProjects, file }).read()).current, "another-site");
});

test("2.3, 2.4 the last setup yes wins across a batch or closed window; a later picker or launch choice wins in turn", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "app-projects-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "project-choice.json");
  let projects = ["a-existing", "old-site"];
  const options = { file, listProjects: async () => [...projects] };
  // Preferences written by the previous app version still work.
  writeFileSync(file, JSON.stringify({ projects, current: "old-site" }));
  const app = projectSelection(options);
  assert.equal((await app.read()).current, "old-site");
  const yes = (current: string) => {
    projects = [...projects, current].sort();
    writeFileSync(file, JSON.stringify({ current }));
  };
  yes("a-site");
  yes("z-site");
  assert.equal((await app.read()).current, "z-site", "two yeses between polls are ordered");
  await app.choose("old-site");
  assert.equal((await projectSelection(options).read()).current, "old-site", "later picker wins on reopening");
  yes("b-site");
  yes("y-site");
  assert.equal((await projectSelection(options).read()).current, "y-site", "last yes while closed wins");
  assert.equal((await projectSelection(options).read("a-site")).current, "a-site", "explicit launch wins");
  assert.equal((await app.read()).current, "a-site", "already-running selection sees the newer choice too");
  projects.push("unselected-project");
  assert.equal((await app.read()).current, "a-site", "discovering a project is not itself a choice");
});

test("2.4 a setup completed during a list query is not overwritten by that stale read", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "app-projects-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "project-choice.json");
  let projects = ["old-site"];
  let duringQuery = () => {};
  const app = projectSelection({ file, listProjects: async () => {
    const snapshot = [...projects];
    duringQuery();
    return snapshot;
  } });
  await app.choose("old-site");
  duringQuery = () => {
    projects = ["new-site", "old-site"];
    writeFileSync(file, JSON.stringify({ current: "new-site" }));
  };
  assert.equal((await app.read()).current, "old-site", "the first list snapshot predates setup");
  assert.equal(JSON.parse(readFileSync(file, "utf8")).current, "new-site", "polling cannot undo setup");
  duringQuery = () => {};
  assert.equal((await app.read()).current, "new-site");
});

test("2.3 reopening follows the last picker choice, --project wins, and a missing remembered project falls back to the first", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "app-projects-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "project-choice.json");
  let projects = ["a-site", "storytree", "z-site"];
  const options = { file, listProjects: async () => [...projects] };
  const app = projectSelection(options);
  assert.equal((await app.read()).current, "a-site", "no special storytree default");
  await app.choose("z-site");
  assert.equal((await projectSelection(options).read()).current, "z-site");
  assert.equal((await projectSelection(options).read("storytree")).current, "storytree");
  assert.equal((await projectSelection(options).read()).current, "storytree");
  projects = ["a-site", "z-site"];
  assert.equal((await projectSelection(options).read()).current, "a-site");
  const explicit = projectSelection(options);
  assert.equal((await explicit.read("missing")).current, "missing", "an unknown --project can be reported honestly");
  assert.equal((await explicit.read()).current, "missing");
  await assert.rejects(explicit.choose("missing"), /no project/);
  assert.equal((await explicit.choose("z-site")).current, "z-site");
});
