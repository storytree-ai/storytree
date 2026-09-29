import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setupHelpActions } from "./actions.js";

test("3.4 Add project: the picked folder becomes a project under its own name (kept apart from an existing one of that name) and is shown; a folder already a project is simply selected; cancelling does nothing", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "storytree-app-add-project-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const home = path.join(dir, "home");
  const projects = ["site"];
  let closed = 0;
  // The app's own open library: used, never closed by adding a project.
  const library = {
    listProjects: async () => [...projects].sort(),
    openProject: async (name: string) => { if (!projects.includes(name)) projects.push(name); return { close: async () => {} }; },
    close: async () => { closed++; },
  };
  let picked: string | undefined;
  const actions = setupHelpActions({
    licenseFile: "", storytreeHome: home, chooseFolder: async () => picked,
    openExternal: async () => {}, copyText: async () => {}, library: () => library as never,
  });

  assert.equal(await actions.addProject(), null, "cancelling the picker adds nothing");

  picked = path.join(dir, "Blog Posts");
  mkdirSync(picked);
  assert.deepEqual(await actions.addProject(), { status: "set up", project: "blog-posts", folder: picked });
  assert.deepEqual(JSON.parse(readFileSync(path.join(picked, ".storytree.json"), "utf8")), { project: "blog-posts" });
  assert.equal(JSON.parse(readFileSync(path.join(home, "project-choice.json"), "utf8")).current, "blog-posts", "the new project is the one shown");

  picked = path.join(dir, "other", "site");
  mkdirSync(picked, { recursive: true });
  assert.deepEqual(await actions.addProject(), { status: "set up", project: "site-2", folder: picked }, "a second folder named like an existing project gets its own project");

  writeFileSync(path.join(home, "project-choice.json"), JSON.stringify({ current: "site-2" }));
  picked = path.join(dir, "Blog Posts");
  assert.deepEqual(await actions.addProject(), { status: "already a project", project: "blog-posts", folder: picked });
  assert.deepEqual(projects.sort(), ["blog-posts", "site", "site-2"], "an existing project creates nothing");
  assert.equal(closed, 0, "the app's library stays open");
});
