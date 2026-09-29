import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { randomBytes } from "node:crypto";
import { connect } from "@storytree/library";
import pg from "pg";
import { setupHelpActions } from "./actions.js";

test("3.4 Add project: the picked folder becomes a project under its own name (kept apart from an existing one of that name) and is shown; a folder already a project is simply selected; cancelling does nothing", async (t) => {
  const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), "storytree-app-add-project-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const home = path.join(dir, "home");
  const token = randomBytes(4).toString("hex");
  const [blog, site] = [`blog-posts-${token}`, `site-${token}`];
  const url = process.env.STORYTREE_TEST_PG_URL;
  if (url === undefined) throw new Error("run the tests via `pnpm test`, which starts a local Postgres");
  // The app's own open library: used, never closed by adding a project.
  const library = await connect({ url });
  t.after(async () => {
    await library.close();
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      for (const name of [blog, site, `${site}-2`]) await client.query(`DROP DATABASE IF EXISTS "storytree_${name}" WITH (FORCE)`);
    } finally {
      await client.end();
    }
  });
  await (await library.openProject(site)).close();
  let picked: string | undefined;
  const actions = setupHelpActions({
    licenseFile: "", storytreeHome: home, chooseFolder: async () => picked,
    openExternal: async () => {}, copyText: async () => {}, library: () => library,
  });

  assert.equal(await actions.addProject(), null, "cancelling the picker adds nothing");

  picked = path.join(dir, `Blog Posts ${token}`);
  mkdirSync(picked);
  assert.deepEqual(await actions.addProject(), { status: "set up", project: blog, folder: picked });
  assert.deepEqual(JSON.parse(readFileSync(path.join(picked, ".storytree.json"), "utf8")), { project: blog });
  assert.equal(JSON.parse(readFileSync(path.join(home, "project-choice.json"), "utf8")).current, blog, "the new project is the one shown");

  picked = path.join(dir, "other", site);
  mkdirSync(picked, { recursive: true });
  assert.deepEqual(await actions.addProject(), { status: "set up", project: `${site}-2`, folder: picked }, "a second folder named like an existing project gets its own project");

  writeFileSync(path.join(home, "project-choice.json"), JSON.stringify({ current: `${site}-2` }));
  picked = path.join(dir, `Blog Posts ${token}`);
  assert.deepEqual(await actions.addProject(), { status: "already a project", project: blog, folder: picked });
  const projects = await library.listProjects();
  assert.deepEqual([blog, site, `${site}-2`].filter((name) => projects.includes(name)).length, 3, "an existing project creates nothing");
  assert.deepEqual(await library.listProjects(), projects, "the app's library stays open");
});
