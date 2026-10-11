/**
 * Capability 6 · Make a folder a project: one test per contract 6.1-6.8 in the app setup story (ADR-0969 D3; until then
 * Session management's 1.3, 1.8-1.11, 1.13 and 1.14).
 *
 * The folders are throwaway directories. Setting one up opens its project in the library on the
 * real Postgres `pnpm test` provides; each such project is named with uniqueProjectName() and its
 * database is dropped afterwards, pass or fail.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { findProject, MARKER_FILE, requireApproval, type ProjectLookup } from "@storytree/session-management";
import { git, withTempDir } from "@storytree/session-management/testing/folders";
import { dropTestProjects, testServerUrl, uniqueProjectName } from "@storytree/session-management/testing/pg";
import { connect, ProjectNameError, type Storytree } from "@storytree/library";
import { openReviews } from "@storytree/quality-assurance";

import { setUpProject, suggestProjectName } from "./making.js";

/** The project a lookup found and the folder holding its marker, leaving aside the database identity the marker records. */
function named(lookup: ProjectLookup): { project: string; folder: string } | ProjectLookup {
  return lookup.project === undefined ? lookup : { project: lookup.project, folder: lookup.folder };
}

/** Run `body` with a connection to the test server; afterwards close it and drop `projects`' libraries. */
async function withStorytree(projects: readonly string[], body: (storytree: Storytree) => Promise<void>): Promise<void> {
  const storytree = await connect({ url: testServerUrl() });
  try {
    await body(storytree);
  } finally {
    try {
      await storytree.close();
    } finally {
      await dropTestProjects(projects);
    }
  }
}

/** Two storytree homes stand for two machines: each keeps its own machine identity. */
function machines(dir: string): { laptop: string; box: string } {
  return { laptop: path.join(dir, "laptop-home"), box: path.join(dir, "box-home") };
}

/** A refusal of a folder by the one setup check (ADR-0757 D3), with the words it must carry. */
function folderRefusal(...words: string[]): (error: unknown) => boolean {
  return (error: unknown) => error instanceof Error && error.name === "ProjectFolderError" && words.every((word) => error.message.includes(word));
}

test('6.8 setting a folder up as project "site" leaves a marker naming it and its database, and the project\'s library exists', async () => {
  const project = uniqueProjectName();
  await withTempDir(async (dir) => {
    const folder = path.join(dir, "site");
    mkdirSync(folder);
    await withStorytree([project], async (storytree) => {
      const setUp = await setUpProject({ folder, project, storytree, storytreeHome: path.join(dir, "app-home") });
      assert.equal(setUp.project, project);
      assert.deepEqual(JSON.parse(readFileSync(path.join(folder, MARKER_FILE), "utf8")), { project, identity: (await storytree.projectIdentities())[project] }, "the marker names the project and its database");
      assert.ok((await storytree.listProjects()).includes(project), "the project's library now exists");
      assert.deepEqual(named(findProject(folder)), { project, folder });
    });
  });
});

test("6.1 a project name the library would refuse is refused when setting a folder up, and nothing is written", async () => {
  const refused = ["Site", "my site", "-site", "site-", "si--te", "a".repeat(41), ""];
  await withTempDir(async (dir) => {
    await withStorytree([], async (storytree) => {
      for (const name of refused) {
        await assert.rejects(setUpProject({ folder: dir, project: name, storytree, storytreeHome: path.join(dir, "app-home") }), ProjectNameError, `${JSON.stringify(name)} is refused`);
      }
      assert.equal(existsSync(path.join(dir, MARKER_FILE)), false, "no marker was written");
      const projects = await storytree.listProjects();
      for (const name of refused) assert.equal(projects.includes(name), false, `no project ${JSON.stringify(name)}`);
    });
  });
});

test("6.2 a folder that is a project's trunk, inside one, a git worktree of one, or holding one is refused for another project, and nothing is written", async () => {
  const [site, other] = [uniqueProjectName(), uniqueProjectName()];
  await withTempDir(async (dir) => {
    const { laptop } = machines(dir);
    const trunk = path.join(dir, "code", "site");
    mkdirSync(trunk, { recursive: true });
    git(trunk, "init", "-q");
    git(trunk, "commit", "-q", "--allow-empty", "-m", "first");
    const worktree = path.join(dir, "site-feature");
    git(trunk, "worktree", "add", "-q", "-b", "feature", worktree);
    await withStorytree([site, other], async (storytree) => {
      await setUpProject({ folder: trunk, project: site, storytree, storytreeHome: laptop });
      // The marker is gone (never committed, say): the library's record of the trunk still refuses.
      rmSync(path.join(trunk, MARKER_FILE));
      const inside = path.join(trunk, "docs");
      mkdirSync(inside);
      for (const folder of [trunk, inside, worktree, path.dirname(trunk)]) {
        await assert.rejects(setUpProject({ folder, project: other, storytree, storytreeHome: laptop }), folderRefusal(site), `${folder} is refused`);
        assert.equal(existsSync(path.join(folder, MARKER_FILE)), false, `no marker in ${folder}`);
      }
      assert.equal((await storytree.listProjects()).includes(other), false, "no library was made for the refused project");
    });
  });
});

test("6.3 a second folder for a project already living on this machine is refused, joining or not; its trunk keeps routing", async () => {
  const project = uniqueProjectName();
  await withTempDir(async (dir) => {
    const { laptop } = machines(dir);
    const [first, second] = [path.join(dir, "first"), path.join(dir, "second")];
    mkdirSync(first);
    mkdirSync(second);
    await withStorytree([project], async (storytree) => {
      await setUpProject({ folder: first, project, storytree, storytreeHome: laptop });
      for (const join of [false, true]) {
        await assert.rejects(setUpProject({ folder: second, project, storytree, storytreeHome: laptop, join }), folderRefusal(first, "worktree"));
      }
      assert.equal(existsSync(path.join(second, MARKER_FILE)), false);
      assert.deepEqual(named(findProject(first)), { project, folder: first });
    });
  });
});

test("6.4 a new folder named like an existing project is refused unless it joins on purpose, and the refusal suggests the first free name", async () => {
  const project = uniqueProjectName();
  await withTempDir(async (dir) => {
    const { laptop, box } = machines(dir);
    const [trunk, other] = [path.join(dir, "a", project), path.join(dir, "b", project)];
    mkdirSync(trunk, { recursive: true });
    mkdirSync(other, { recursive: true });
    await withStorytree([project, `${project}-2`], async (storytree) => {
      await setUpProject({ folder: trunk, project, storytree, storytreeHome: laptop });
      assert.equal(await suggestProjectName(other, storytree), `${project}-2`, "the suggestion avoids every existing project");
      // On another machine too: a matching folder name is never taken as joining.
      await assert.rejects(setUpProject({ folder: other, project, storytree, storytreeHome: box }), folderRefusal(`${project}-2`));
      assert.equal(existsSync(path.join(other, MARKER_FILE)), false);
      await setUpProject({ folder: other, project: `${project}-2`, storytree, storytreeHome: box });
      assert.deepEqual(named(findProject(other)), { project: `${project}-2`, folder: other });
    });
  });
});

test("6.5 another machine adds its checkout to an existing project only on purpose, and a git worktree of it then routes there; joining a missing project is refused", async () => {
  const [project, missing] = [uniqueProjectName(), uniqueProjectName()];
  await withTempDir(async (dir) => {
    const { laptop, box } = machines(dir);
    const [onLaptop, onBox] = [path.join(dir, "laptop", "app"), path.join(dir, "box", "app")];
    mkdirSync(onLaptop, { recursive: true });
    mkdirSync(onBox, { recursive: true });
    git(onBox, "init", "-q");
    git(onBox, "commit", "-q", "--allow-empty", "-m", "first");
    await withStorytree([project, missing], async (storytree) => {
      await setUpProject({ folder: onLaptop, project, storytree, storytreeHome: laptop });
      await setUpProject({ folder: onBox, project, storytree, storytreeHome: box, join: true });
      const worktree = path.join(dir, "box", "app-feature");
      git(onBox, "worktree", "add", "-q", "-b", "feature", worktree);
      assert.deepEqual(named(findProject(worktree)), { project, folder: onBox });
      assert.deepEqual(await storytree.listProjects().then((names) => names.filter((name) => name === project)), [project], "one project, shared by both machines");
      const elsewhere = path.join(dir, "elsewhere");
      mkdirSync(elsewhere);
      await assert.rejects(setUpProject({ folder: elsewhere, project: missing, storytree, storytreeHome: box, join: true }), folderRefusal(missing));
      assert.equal((await storytree.listProjects()).includes(missing), false);
    });
  });
});

test("6.6 a moved trunk is never adopted on sight: it reaches its project only once joined on purpose, and a deleted one gives way to a new folder joining; a live trunk is still never moved", async () => {
  const project = uniqueProjectName();
  await withTempDir(async (dir) => {
    const { laptop } = machines(dir);
    const [old, moved] = [path.join(dir, "old", "app"), path.join(dir, "moved", "app")];
    mkdirSync(old, { recursive: true });
    mkdirSync(path.dirname(moved));
    await withStorytree([project], async (storytree) => {
      await setUpProject({ folder: old, project, storytree, storytreeHome: laptop });
      await requireApproval(storytree, project, old, laptop);
      renameSync(old, moved);
      assert.deepEqual(named(findProject(moved)), { project, folder: moved }, "its marker moved with it");
      await assert.rejects(requireApproval(storytree, project, moved, laptop), folderRefusal(project, "not approved"), "the moved folder is not adopted on sight");
      await setUpProject({ folder: moved, project, storytree, storytreeHome: laptop, join: true });
      await requireApproval(storytree, project, moved, laptop);
      const copy = path.join(dir, "copy");
      mkdirSync(copy);
      await assert.rejects(setUpProject({ folder: copy, project, storytree, storytreeHome: laptop, join: true }), folderRefusal(moved), "the trunk it moved to is live");

      rmSync(moved, { recursive: true });
      await setUpProject({ folder: copy, project, storytree, storytreeHome: laptop, join: true });
      assert.deepEqual(named(findProject(copy)), { project, folder: copy }, "a fresh folder joins in place of the deleted one");
      await requireApproval(storytree, project, copy, laptop);
    });
  });
});

/** The six test-quality checks the starter pack seeds, by title. */
const STARTER_CHECKS = ["Hidden skip", "Module mock", "Proxy assertion", "Tautological expected value", "Test title without a contract number", "Wall-clock duration"];

/** Every role the starter pack seeds, by title. */
const STARTER_ROLE_TITLES = ["blind-reviewer", "change-reviewer", "corpus-investigator", "explorer", "frontend-builder", "librarian", "orchestrator", "story-author"];

test("6.7 setting a new project up seeds its library with every starter role (orchestrator, librarian, change-reviewer, explorer, story-author, frontend-builder, blind-reviewer, corpus-investigator), the six test-quality checks a review's brief lists, and the notes they stand on; joining it from another machine adds no second copy", async () => {
  const project = uniqueProjectName();
  await withTempDir(async (dir) => {
    const { laptop, box } = machines(dir);
    const [onLaptop, onBox] = [path.join(dir, "laptop", "app"), path.join(dir, "box", "app")];
    mkdirSync(onLaptop, { recursive: true });
    mkdirSync(onBox, { recursive: true });
    await withStorytree([project], async (storytree) => {
      // The pack as the library holds it: each role and check by title, every note a role stands on, keeps as a rule or refuses, and every note a check enforces, live.
      const pack = async () => {
        const library = await storytree.openProject(project);
        try {
          const roles = await library.list("agent");
          const checks = await library.list("check");
          const linked = new Set([
            ...roles.flatMap((role) => [...role.fields.context, ...(role.fields.rules ?? []), ...(role.fields.antiPatterns ?? [])]),
            ...checks.flatMap((check) => check.fields.enforces),
          ]);
          for (const id of linked) {
            assert.ok(["principle", "guardrail", "pattern", "process"].includes((await library.get(id))?.type ?? "none"), `${id} is a live principle, guardrail, pattern or process`);
          }
          const kinds = ["principle", "guardrail", "pattern", "process"] as const;
          const notes = (await Promise.all(kinds.map(async (kind) => (await library.list(kind)).map((note) => `${kind}: ${note.fields.title}`)))).flat();
          return { roles: roles.map((role) => role.fields.title).sort(), checks: checks.map((check) => check.fields.title).sort(), notes: notes.sort() };
        } finally {
          await library.close();
        }
      };
      // What a role stands on, by title: the notes behind its required reading, its rules and what it refuses.
      const standsOn = async (title: string) => {
        const library = await storytree.openProject(project);
        try {
          const role = (await library.list("agent")).find((agent) => agent.fields.title === title)!;
          const titles = async (ids: readonly string[] = []) =>
            Promise.all(ids.map(async (id) => {
              const fields = (await library.get(id))?.fields;
              return fields !== undefined && "title" in fields ? fields.title : `${id} (not a live note)`;
            }));
          return { reading: await titles(role.fields.context), rules: await titles(role.fields.rules), refuse: await titles(role.fields.antiPatterns) };
        } finally {
          await library.close();
        }
      };
      // A first try that fails at its last step (the choice cannot be saved), then the retry.
      const choice = path.join(laptop, "project-choice.json");
      mkdirSync(choice, { recursive: true });
      await assert.rejects(setUpProject({ folder: onLaptop, project, storytree, storytreeHome: laptop }));
      rmSync(choice, { recursive: true });
      await setUpProject({ folder: onLaptop, project, storytree, storytreeHome: laptop });
      const seeded = await pack();
      assert.deepEqual({ roles: seeded.roles, checks: seeded.checks }, { roles: STARTER_ROLE_TITLES, checks: STARTER_CHECKS }, "the retry adds no second role or check");
      assert.equal(new Set(seeded.notes.map((note) => note.replace(/^[a-z]+: /, ""))).size, seeded.notes.length, "the retry adds no second copy of a note");
      assert.deepEqual(await standsOn("explorer"), {
        reading: ["Delegate exploration to digest-returning subagents", "Pull-based context architecture", "Reference, don't restate", "Plain language first"],
        rules: ["Delegate exploration to digest-returning subagents", "Reference, don't restate", "Plain language first", "No claim without evidence"],
        refuse: ["Escalate up when blocked or out of scope"],
      });
      assert.deepEqual((await standsOn("orchestrator")).reading, ["Merge ceremony", "Pre-merge librarian pass", "Library edit ceremony", "Pull-based context architecture", "Decompose by testability; delegate the glue", "Parallel build-lane fan-out", "Friction earns durable guidance by supporting evidence, not by being reported"]);
      await setUpProject({ folder: onBox, project, storytree, storytreeHome: box, join: true });
      assert.deepEqual(await pack(), seeded, "joining adds no second copy");

      // A review of a change in this project is briefed with the seeded checks.
      const library = await storytree.openProject(project);
      try {
        const story = await library.addStory({ title: "Visitor can sign up" });
        const capability = await library.addCapability({ title: "1 · Email form", story: story.id });
        const arc = await library.createArc({ title: "Launch sign-up", intent: "Ship sign-up", endState: "Visitors sign up", stories: [story.id] });
        const increment = await library.addIncrement({ arc: arc.id, title: "Email form", objective: "Build the email form", body: "Build the form.", capabilities: [capability.id] });
        const brief = await (await openReviews(storytree)).brief(library, increment.id, "diff --git a/src/form.ts b/src/form.ts\n+export const form = 1;\n");
        assert.deepEqual(brief.checks.map((check) => check.title).sort(), STARTER_CHECKS);
      } finally {
        await library.close();
      }
    });
  });
});
