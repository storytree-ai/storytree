import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { randomBytes } from "node:crypto";
import { setUpProject } from "@storytree/agent-link";
import { connect } from "@storytree/library";
import { dropTestDatabases } from "@storytree/local-postgres/testing";
import { projectsOnThisComputer } from "../project/index.js";
import { setupHelpActions } from "./actions.js";

test("3.3 a project added from the app and one set up in its folder (by the terminal or the agent) both appear in the running app's list, and either one opens", async (t) => {
  const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), "storytree-app-three-ways-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const home = path.join(dir, "home");
  const token = `t-${randomBytes(4).toString("hex")}`;
  const [fromApp, inFolder] = [`from-app-${token}`, `in-folder-${token}`];
  const url = process.env.STORYTREE_TEST_PG_URL;
  if (url === undefined) throw new Error("run the tests via `pnpm test`, which starts a local Postgres");
  const library = await connect({ url });
  t.after(async () => {
    await library.close();
    await dropTestDatabases([fromApp, inFolder].map((name) => `storytree_${name}`));
  });
  const picked = path.join(dir, fromApp);
  mkdirSync(picked);
  const actions = setupHelpActions({ licenseFile: "", storytreeHome: home, chooseFolder: async () => picked, openExternal: async () => {}, copyText: async () => {}, library: () => library });

  assert.equal((await actions.addProject())?.project, fromApp);
  // `storytree doctor --set-up <name>` and the agent's set_up_project both set the folder up this way.
  const folder = path.join(dir, "elsewhere");
  mkdirSync(folder);
  await setUpProject({ folder, project: inFolder, storytree: library, storytreeHome: home });

  const listed = projectsOnThisComputer(await library.projectIdentities(), home);
  assert.deepEqual([fromApp, inFolder].filter((name) => listed.includes(name)), [fromApp, inFolder], "both appear in the app, which keeps its library open");
  for (const name of [fromApp, inFolder]) await (await library.openProject(name)).close();
});
