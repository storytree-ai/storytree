import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
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
  assert.deepEqual(await app.read(), { projects, current: "my-site" });
  projects = ["another-site", "my-site"];
  assert.deepEqual(await app.read(), { projects, current: "another-site" });
  assert.equal(queries, 3, "one list query per refresh");
  assert.equal((await projectSelection({ listProjects, file }).read()).current, "another-site");
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
