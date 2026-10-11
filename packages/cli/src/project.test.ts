/** Removing a project from a terminal: a thin front door onto the app setup's own removal. */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";

import { connect } from "@storytree/library";

import { projectsOnThisComputer } from "@storytree/app-setup";

import { BuiltCommand, inWorld, storytree, testServerUrl } from "./testing/cli.js";

const command = new BuiltCommand();
before(() => command.build());
after(() => command.remove());

test("project remove takes a project off this computer's list and keeps its records; an unknown name is refused", async () => {
  await inWorld(command, async ({ project, home, run, library }) => {
    const { identity } = await library();
    const removed = await run(["project", "remove", project]);
    assert.equal(removed.code, 0, removed.stderr);
    assert.match(removed.stdout, /records stay/);
    assert.deepEqual(projectsOnThisComputer({ [project]: identity }, home), []);

    const unknown = await run(["project", "remove", `${project}-none`]);
    assert.notEqual(unknown.code, 0);
    assert.match(unknown.stderr + unknown.stdout, /no project called/);
  });
});

test("3.6: project delete says who loses the records and needs the name typed; refused in the project's own folder; from elsewhere it snapshots, then deletes", async () => {
  await inWorld(command, async ({ project, elsewhere, home, run }) => {
    const server = await connect({ url: testServerUrl() });
    try {
      await server.openProject(project);
    } finally {
      await server.close();
    }

    const unconfirmed = await run(["project", "delete", project]);
    assert.notEqual(unconfirmed.code, 0);
    assert.match(unconfirmed.stderr, /whole history/);
    assert.match(unconfirmed.stderr, new RegExp(`--confirm ${project}`));

    const inUse = await run(["project", "delete", project, "--confirm", project]);
    assert.notEqual(inUse.code, 0);
    assert.match(inUse.stderr, /in use/);

    const deleted = await storytree(command.script, ["project", "delete", project, "--confirm", project], { cwd: elsewhere, home });
    assert.equal(deleted.code, 0, deleted.stderr);
    const snapshot = /snapshot (?:is )?(?:in|at) (\S+\.json)/.exec(deleted.stdout)?.[1];
    assert.ok(snapshot !== undefined && existsSync(snapshot), deleted.stdout);
    const after = await connect({ url: testServerUrl() });
    try {
      assert.equal((await after.listProjects()).includes(project), false);
    } finally {
      await after.close();
    }
  });
});

test("a folder whose project was deleted (from another computer) is refused by a command run there, saying so, and the project is not made again", async () => {
  await inWorld(command, async ({ project, folder, elsewhere, home, run }) => {
    const server = await connect({ url: testServerUrl() });
    try {
      await server.openProject(project);
    } finally {
      await server.close();
    }
    const deleted = await storytree(command.script, ["project", "delete", project, "--confirm", project, "--no-snapshot"], { cwd: elsewhere, home });
    assert.equal(deleted.code, 0, deleted.stderr);
    writeFileSync(path.join(folder, ".storytree.json"), `${JSON.stringify({ project })}\n`); // the other computer's folder still names it

    const listed = await run(["arc", "list"]);
    assert.notEqual(listed.code, 0);
    assert.match(listed.stderr, /deleted/);
    assert.match(listed.stderr, /\.storytree\.json/);
    const after = await connect({ url: testServerUrl() });
    try {
      assert.equal((await after.listProjects()).includes(project), false, "nothing made again");
    } finally {
      await after.close();
    }
  });
});

test("3.17 storytree import <folder> imports it into the folder's project, saying the mapped stories it added; a refused folder is said with why", async () => {
  await inWorld(command, async ({ elsewhere, run, library }) => {
    const shop = path.join(elsewhere, "shop");
    mkdirSync(shop);
    writeFileSync(path.join(shop, "package.json"), JSON.stringify({ name: "shop" }));
    const imported = await run(["import", shop]);
    assert.equal(imported.code, 0, imported.stderr);
    assert.match(imported.stdout, /1 mapped story added/);
    const stories = (await (await library()).list("story")).filter((story) => story.fields.mapped !== undefined);
    assert.deepEqual(stories.map((story) => story.fields), [{ title: "shop", mapped: { from: shop, package: ".", folders: ["."] } }]);
    assert.match(imported.stdout, new RegExp(stories[0]!.id));

    const refused = await run(["import", path.join(elsewhere, "missing")]);
    assert.notEqual(refused.code, 0);
    assert.match(refused.stderr, /does not exist/);
  });
});
