import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { addProject, projectFolder } from "./index.js";

/** A stand-in library: it records the projects opened, as the real one creates them. */
function library(opened: string[]) {
  return async () => ({
    openProject: async (name: string) => {
      if (!/^[a-z0-9](?:[a-z0-9]|-(?!-)){0,39}$/.test(name)) throw Object.assign(new Error(`project name ${JSON.stringify(name)} is not allowed`), { name: "ProjectNameError" });
      opened.push(name);
      return { close: async () => {} };
    },
    close: async () => {},
  }) as never;
}

test("1.7 / 3.4: a chosen folder becomes a project (created if missing, suggested its own name); one already a project is said and nothing is created; a refused name leaves nothing", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "storytree-add-project-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const home = path.join(dir, "home");
  const opened: string[] = [];
  const folder = path.join(dir, "My Site");
  assert.deepEqual(projectFolder(folder), { folder, suggestion: "my-site" });

  const refused = await addProject(folder, "Bad Name", { home, open: library(opened) });
  assert.equal(refused.status, "name refused");
  assert.equal(existsSync(path.join(folder, ".storytree.json")), false, "a refused name sets nothing up");

  const added = await addProject(folder, "my-site", { home, open: library(opened) });
  assert.deepEqual(added, { status: "set up", folder, project: "my-site" });
  assert.deepEqual(JSON.parse(readFileSync(path.join(folder, ".storytree.json"), "utf8")), { project: "my-site" });
  assert.deepEqual(opened, ["my-site"]);
  assert.equal(JSON.parse(readFileSync(path.join(home, "project-choice.json"), "utf8")).current, "my-site", "the new project is the one shown");
  assert.deepEqual(projectFolder(folder), { folder, project: "my-site" });

  writeFileSync(path.join(home, "project-choice.json"), JSON.stringify({ current: "other" }));
  const again = await addProject(folder, "another", { home, open: library(opened) });
  assert.deepEqual(again, { status: "already a project", folder, project: "my-site" });
  assert.deepEqual(opened, ["my-site"], "a repeat creates nothing");
  assert.equal(JSON.parse(readFileSync(path.join(folder, ".storytree.json"), "utf8")).project, "my-site");

  const inside = path.join(folder, "src");
  mkdirSync(inside);
  assert.deepEqual(projectFolder(inside), { folder: inside, project: "my-site" }, "a folder inside a project belongs to it");
});
