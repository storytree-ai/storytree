/**
 * Capability 6 · Make a folder a project: contract 6.15, a user project's one standing small-fixes arc (ADR-1266 D2, D3).
 *
 * The folders are throwaway directories, and each project is named with uniqueProjectName() on the real Postgres
 * `pnpm test` provides, its database dropped afterwards, pass or fail.
 */
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { withTempDir } from "@storytree/project-and-caller/testing/folders";
import { dropTestProjects, testServerUrl, uniqueProjectName } from "@storytree/project-and-caller/testing/pg";
import { connect, type Library } from "@storytree/library";

import { setUpProject } from "./making.js";
import { SMALL_FIXES_ARC, smallFixesArc } from "./small-fixes.js";

test("6.15 a user project has exactly one standing small-fixes arc, made by storytree: setting up makes it, an older project gains it once, a retry, a join or two calls at once make no second, a retired one is never made again, and storytree's own project gets none", async () => {
  const [project, older, factory] = [uniqueProjectName(), uniqueProjectName(), uniqueProjectName()];
  await withTempDir(async (dir) => {
    const storytree = await connect({ url: testServerUrl() });
    try {
      const [folder, boxFolder] = [path.join(dir, "site"), path.join(dir, "box-site")];
      for (const each of [folder, boxFolder]) mkdirSync(each);
      await setUpProject({ folder, project, storytree, storytreeHome: path.join(dir, "laptop"), factory });
      // Another machine's checkout joins it, and the first folder is set up again on purpose.
      await setUpProject({ folder: boxFolder, project, storytree, storytreeHome: path.join(dir, "box"), join: true, factory });
      await setUpProject({ folder, project, storytree, storytreeHome: path.join(dir, "laptop"), join: true, factory });
      const library = await storytree.openProject(project, { create: false });
      try {
        const arcs = await library.list("arc");
        assert.deepEqual(arcs.map((arc) => arc.id), [SMALL_FIXES_ARC], "one arc, at the id an agent names without searching");
        const [arc] = arcs;
        assert.match(arc!.fields.intent, /adds or changes no contract/);
        assert.match(arc!.fields.endState, /never closes/);
        assert.match(arc!.fields.endState, /real arc/);
        assert.deepEqual(await smallFixesArc(library), { id: SMALL_FIXES_ARC, made: false });
      } finally {
        await library.close();
      }

      // A project set up before storytree made one gains it once, however many ask at once.
      const before = await storytree.openProject(older);
      try {
        const asked = await Promise.all([smallFixesArc(before), smallFixesArc(before), smallFixesArc(before)]);
        assert.deepEqual(asked.filter((one) => one?.made).length, 1, "only one call makes it");
        assert.deepEqual((await before.list("arc")).map((arc) => arc.id), [SMALL_FIXES_ARC]);
        await before.retire(SMALL_FIXES_ARC, "the user retired it");
        assert.equal(await smallFixesArc(before), undefined, "a retired one is never made again");
        assert.deepEqual(await before.list("arc"), []);
      } finally {
        await before.close();
      }
    } finally {
      await storytree.close();
      await dropTestProjects([project, older, factory]);
    }
  });

  // storytree's own development keeps ADR-0792: its project is asked for nothing and given nothing.
  const written: string[] = [];
  const own = { name: "storytree", get: async () => null, createArc: async () => (written.push("arc"), null as never) } as unknown as Library;
  assert.equal(await smallFixesArc(own), undefined);
  assert.deepEqual(written, []);
});
