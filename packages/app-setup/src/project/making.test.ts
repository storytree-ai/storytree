/**
 * Capability 6 · Make a folder a project: one test per contract 6.1-6.8 in the app setup story (ADR-0969 D3; until then
 * Session management's 1.3, 1.8-1.11, 1.13 and 1.14).
 *
 * The folders are throwaway directories. Setting one up opens its project in the library on the
 * real Postgres `pnpm test` provides; each such project is named with uniqueProjectName() and its
 * database is dropped afterwards, pass or fail.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { findProject, forgetTrunk, machineOf, PROJECT_FILE, registerTrunk, requireApproval, ROOT_MARKER_FILE, type ProjectLookup } from "@storytree/project-and-caller";
import { git, withTempDir, writeMarker } from "@storytree/project-and-caller/testing/folders";
import { dropTestProjects, testServerUrl, uniqueProjectName } from "@storytree/project-and-caller/testing/pg";
import { connect, ProjectNameError, type Storytree } from "@storytree/library";
import { openReviews } from "@storytree/quality-assurance";

import { firstCommit, makeRepository, setUpProject, suggestProjectName, userFactory } from "./making.js";
import { takeStarterPack } from "./starter-pack.js";
import { ROLES } from "./starter-roles.js";

/** What a project's first commit holds: its .storytree folder, with no machine-local file of it. */
const STORYTREE_FILES = [".storytree/.gitignore", PROJECT_FILE];

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
      assert.deepEqual(JSON.parse(readFileSync(path.join(folder, PROJECT_FILE), "utf8")), { project, identity: (await storytree.projectIdentities())[project] }, "the marker names the project and its database");
      assert.ok((await storytree.listProjects()).includes(project), "the project's library now exists");
      assert.deepEqual(named(findProject(folder)), { project, folder });
    });
  });
});

test("6.13 setting a folder up keeps its storytree files in a .storytree folder: the marker at .storytree/project.json and a .gitignore keeping *.local.json out of git, added to one the folder already has and never doubled", async () => {
  const [fresh, kept] = [uniqueProjectName(), uniqueProjectName()];
  await withTempDir(async (dir) => {
    const home = path.join(dir, "app-home");
    const [first, second] = [path.join(dir, "first"), path.join(dir, "second")];
    mkdirSync(first);
    mkdirSync(path.join(second, ".storytree"), { recursive: true });
    writeFileSync(path.join(second, ".storytree", ".gitignore"), "scratch/");
    await withStorytree([fresh, kept], async (storytree) => {
      const made = await setUpProject({ folder: first, project: fresh, storytree, storytreeHome: home });
      assert.equal(made.marker, path.join(first, PROJECT_FILE));
      assert.equal(JSON.parse(readFileSync(path.join(first, PROJECT_FILE), "utf8")).project, fresh);
      assert.equal(existsSync(path.join(first, ROOT_MARKER_FILE)), false, "no marker at the root");
      assert.equal(readFileSync(path.join(first, ".storytree", ".gitignore"), "utf8"), "*.local.json\n");
      await setUpProject({ folder: second, project: kept, storytree, storytreeHome: home });
      assert.equal(readFileSync(path.join(second, ".storytree", ".gitignore"), "utf8"), "scratch/\n*.local.json\n", "the folder's own .gitignore kept, the line added");
      await setUpProject({ folder: second, project: kept, storytree, storytreeHome: home, join: true });
      assert.equal(readFileSync(path.join(second, ".storytree", ".gitignore"), "utf8"), "scratch/\n*.local.json\n", "a line it has is not added again");
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
      assert.equal(existsSync(path.join(dir, PROJECT_FILE)), false, "no marker was written");
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
      rmSync(path.join(trunk, PROJECT_FILE));
      const inside = path.join(trunk, "docs");
      mkdirSync(inside);
      for (const folder of [trunk, inside, worktree, path.dirname(trunk)]) {
        await assert.rejects(setUpProject({ folder, project: other, storytree, storytreeHome: laptop }), folderRefusal(site), `${folder} is refused`);
        assert.equal(existsSync(path.join(folder, PROJECT_FILE)), false, `no marker in ${folder}`);
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
      assert.equal(existsSync(path.join(second, PROJECT_FILE)), false);
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
      assert.equal(existsSync(path.join(other, PROJECT_FILE)), false);
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

/** The six test-quality checks the starter pack leaves out for a user to take in, by title. */
const STARTER_CHECKS = ["Hidden skip", "Module mock", "Proxy assertion", "Tautological expected value", "Test title without a contract number", "Wall-clock duration"];

/** Every role the starter pack leaves out for a user to take in, by title. */
const STARTER_ROLE_TITLES = ["blind-reviewer", "change-reviewer", "corpus-investigator", "explorer", "frontend-builder", "librarian", "orchestrator", "story-author"];

test("6.7 setting a new project up gives its factory the bare bones, no role, check or note (ADR-1094 D1), and joining or a retry adds none; each part left out is taken in by its title with the notes it links, and taking every one gives the library, read through its factory, every starter role, the six test-quality checks a review's brief lists, and the notes they stand on", async () => {
  const [project, factory] = [uniqueProjectName(), uniqueProjectName()];
  await withTempDir(async (dir) => {
    const { laptop, box } = machines(dir);
    const [onLaptop, onBox] = [path.join(dir, "laptop", "app"), path.join(dir, "box", "app")];
    mkdirSync(onLaptop, { recursive: true });
    mkdirSync(onBox, { recursive: true });
    await withStorytree([project, factory], async (storytree) => {
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
      await assert.rejects(setUpProject({ folder: onLaptop, project, storytree, storytreeHome: laptop, factory }));
      rmSync(choice, { recursive: true });
      await setUpProject({ folder: onLaptop, project, storytree, storytreeHome: laptop, factory });
      const bare = { roles: [], checks: [], notes: [] };
      assert.deepEqual(await pack(), bare, "the bare bones are the record and the map: the retry seeds nothing");
      await setUpProject({ folder: onBox, project, storytree, storytreeHome: box, join: true, factory });
      assert.deepEqual(await pack(), bare, "nor does joining");

      // A guardrail comes back one part at a time (ADR-1094 D2): the explorer and one check, with what they link.
      const take = async (include: readonly string[]) => {
        const library = await storytree.openProject(project);
        try {
          await takeStarterPack(library, storytree, include);
        } finally {
          await library.close();
        }
      };
      await take(["explorer", "Proxy assertion"]);
      assert.deepEqual(await pack(), {
        roles: ["explorer"],
        checks: ["Proxy assertion"],
        notes: [
          "guardrail: Escalate up when blocked or out of scope",
          "pattern: Pull-based context architecture",
          "principle: Delegate exploration to digest-returning subagents",
          "principle: No claim without evidence",
          "principle: Plain language first",
          "principle: Reference, don't restate",
          "principle: Test creation principles",
        ],
      });
      assert.deepEqual(await standsOn("explorer"), {
        reading: ["Delegate exploration to digest-returning subagents", "Pull-based context architecture", "Reference, don't restate", "Plain language first"],
        rules: ["Delegate exploration to digest-returning subagents", "Reference, don't restate", "Plain language first", "No claim without evidence"],
        refuse: ["Escalate up when blocked or out of scope"],
      });
      // The notes no role of storytree's links, which its factory's contents mark in (ADR-1040), each taken by its title.
      const factoryNotes = [
        "principle: Price the deferral",
        "principle: Durable notes carry intent, not implementation surface",
        "principle: Tightening a shared contract needs a full sweep",
        "principle: A story's proof proves the goal, not the surface",
        "principle: Cold rebuild",
        "principle: Stateless graduates, stateful stays",
        "principle: An escape sequence in a tool argument becomes a real byte",
        "principle: The same file in another tree is a different file",
        "principle: A human's words are stored verbatim, or not at all",
        "principle: A user-approved reference is repo-resident",
        "principle: De-noising promotes a signal, never drops it",
        "guardrail: Types stay honest",
        "pattern: A measured claim carries the method that produced it",
        "process: Grill me: walk the user through their open questions",
        "process: Stage the user's look",
        "process: Attempt privileged actions, approve inline",
        "process: Justify a new check",
        "process: Migrate a schema: expand, migrate, contract",
      ];
      await take([...STARTER_ROLE_TITLES, ...STARTER_CHECKS, ...factoryNotes.map((note) => note.replace(/^[a-z]+: /, ""))]);
      const seeded = await pack();
      assert.deepEqual({ roles: seeded.roles, checks: seeded.checks }, { roles: STARTER_ROLE_TITLES, checks: STARTER_CHECKS }, "every part is reachable, with no second copy of what was taken before");
      assert.equal(new Set(seeded.notes.map((note) => note.replace(/^[a-z]+: /, ""))).size, seeded.notes.length, "no second copy of a note");
      assert.deepEqual((await standsOn("orchestrator")).reading, ["Merge ceremony", "Pre-merge librarian pass", "Library edit ceremony", "Pull-based context architecture", "Decompose by testability; delegate the glue", "Parallel build-lane fan-out", "Friction earns durable guidance by supporting evidence, not by being reported"]);
      assert.deepEqual(factoryNotes.filter((note) => !seeded.notes.includes(note)), [], "every note the factory's contents mark in is taken");
      assert.deepEqual((await standsOn("corpus-investigator")).rules.slice(-2), ["The same file in another tree is a different file", "A measured claim carries the method that produced it"]);

      // A review of a change in this project is briefed with the checks taken.
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

test("6.7 the starter orchestrator role may call storytree's run_tests and lands on the final suite run through it with the project's exact command, so it reads the green agent's verified run", () => {
  const orchestrator = ROLES.find((role) => role.title === "orchestrator")!;
  assert.match(orchestrator.tools ?? "", /\brun_tests\b/, "its tools name run_tests");
  const landing = orchestrator.workflow?.split("\n").find((step) => step.startsWith("7. ")) ?? "";
  assert.match(landing, /run_tests/, `its landing step runs the final suite through run_tests: ${landing}`);
});

test("6.10 a folder in no git repository gets one, whose first commit holds the project's marker; a folder already in one is left as it is; with no git nothing is made, and with no git identity the repository waits, its marker staged, for the first commit once git has one; the setup goes on", async () => {
  await withTempDir(async (dir) => {
    // Git reads no config of this machine's: the test chooses the identity, or none.
    const noConfig = path.join(dir, "no-gitconfig");
    writeFileSync(noConfig, "");
    const bare: NodeJS.ProcessEnv = { ...process.env, GIT_CONFIG_GLOBAL: noConfig, GIT_CONFIG_NOSYSTEM: "1" };
    for (const name of ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL", "EMAIL"]) delete bare[name];
    const signed = { ...bare, GIT_AUTHOR_NAME: "A User", GIT_AUTHOR_EMAIL: "user@example.invalid", GIT_COMMITTER_NAME: "A User", GIT_COMMITTER_EMAIL: "user@example.invalid" };
    const project = (name: string) => {
      const folder = path.join(dir, name);
      mkdirSync(folder);
      writeMarker(folder, "{}\n");
      writeFileSync(path.join(folder, ".storytree", ".gitignore"), "*.local.json\n");
      writeFileSync(path.join(folder, ".storytree", "worktree.local.json"), "{}\n");
      writeFileSync(path.join(folder, "notes.txt"), "the user's own\n");
      return folder;
    };

    const empty = project("empty");
    assert.deepEqual(makeRepository(empty, { env: signed }), { state: "made" });
    assert.equal(path.resolve(git(empty, "rev-parse", "--show-toplevel").trim()), empty, "git prints / on Windows too");
    assert.equal(git(empty, "log", "--format=%an <%ae>").trim(), "A User <user@example.invalid>", "one commit, under the user's identity");
    assert.deepEqual(git(empty, "show", "--name-only", "--format=", "HEAD").trim().split("\n"), STORYTREE_FILES, "the first commit holds the .storytree folder alone");

    const inside = path.join(empty, "sub");
    mkdirSync(inside);
    assert.deepEqual(makeRepository(inside, { env: signed }), { state: "already", root: empty });
    assert.equal(existsSync(path.join(inside, ".git")), false, "a folder inside a repository gets no second one");
    assert.equal(git(empty, "rev-list", "--count", "HEAD").trim(), "1");

    const anonymous = project("anonymous");
    const nobody = { ...bare, HOME: dir, USERPROFILE: dir };
    const unnamed = makeRepository(anonymous, { env: nobody });
    assert.equal(unnamed.state, "no identity");
    assert.match(unnamed.state === "no identity" ? unnamed.reason : "", /identity|user\.name|user\.email/i);
    assert.equal(path.resolve(git(anonymous, "rev-parse", "--show-toplevel").trim()), anonymous, "with no identity the repository is kept");
    assert.deepEqual(git(anonymous, "ls-files").trim().split("\n"), STORYTREE_FILES, "its .storytree folder staged, alone, for the first commit");
    assert.deepEqual(firstCommit(anonymous, { env: nobody })?.state, "no identity", "still no identity: still no commit");
    assert.deepEqual(firstCommit(anonymous, { env: signed }), { state: "made" }, "once git has an identity the first commit is made");
    assert.equal(git(anonymous, "log", "--format=%an <%ae>").trim(), "A User <user@example.invalid>");
    assert.deepEqual(git(anonymous, "show", "--name-only", "--format=", "HEAD").trim().split("\n"), STORYTREE_FILES);
    assert.equal(firstCommit(anonymous, { env: signed }), undefined, "a repository with a commit is no longer waiting for its first");
    assert.equal(firstCommit(empty, { env: signed }), undefined);

    // A repository an older setup began, its root marker staged alone, still gets its first commit (ADR-1191 D4).
    const older = path.join(dir, "older");
    mkdirSync(older);
    writeFileSync(path.join(older, ROOT_MARKER_FILE), "{}\n");
    writeFileSync(path.join(older, "notes.txt"), "the user's own\n");
    git(older, "init", "-q");
    git(older, "add", "--", ROOT_MARKER_FILE);
    assert.deepEqual(firstCommit(older, { env: signed }), { state: "made" });
    assert.deepEqual(git(older, "show", "--name-only", "--format=", "HEAD").trim().split("\n"), [ROOT_MARKER_FILE]);

    // A repository the user began, with nothing or something else staged, is theirs: storytree commits nothing in it.
    const theirs = project("theirs");
    git(theirs, "init", "-q");
    assert.equal(firstCommit(theirs, { env: signed }), undefined);
    git(theirs, "add", "--", ".storytree", "notes.txt");
    assert.equal(firstCommit(theirs, { env: signed }), undefined);
    assert.equal(firstCommit(path.join(dir, "no-such-folder"), { env: signed }), undefined);

    const gitless = project("gitless");
    const missing = makeRepository(gitless, { env: { ...signed, PATH: path.join(dir, "no-bin"), Path: path.join(dir, "no-bin") } });
    assert.equal(missing.state, "could not");
    assert.match(missing.state === "could not" ? missing.reason : "", /git is not installed/);
    assert.equal(existsSync(path.join(gitless, ".git")), false);
  });
});

test("6.11 the user's factory is found by its mark: with none of storytree's names, a factory the user brought, marked and with a folder of its own, is found, the first by name of several; one of storytree's names comes first, and a marked project with no folder is not found (ADR-1086 D4)", async () => {
  const [shipped, early, late, stray, plain] = [uniqueProjectName(), uniqueProjectName(), uniqueProjectName(), uniqueProjectName(), uniqueProjectName()];
  const [first, second] = [early, late].sort();
  await withTempDir(async (dir) => {
    const machine = machineOf(machines(dir).laptop);
    await withStorytree([shipped, early, late, stray, plain], async (storytree) => {
      for (const name of [early, late, stray]) await (await storytree.openProject(name)).markFactory();
      await storytree.openProject(plain);
      const trunked = [first!, second!, plain];
      for (const project of trunked) await registerTrunk(storytree, { project, machine: machine.id, machineName: machine.name, folder: path.join(dir, project) }, "setup");
      try {
        // Only these projects are looked at, so no other test's factory is found.
        assert.equal(await userFactory(storytree, shipped, [plain, stray, second!]), second, "found by its mark and its folder, under none of storytree's names");
        assert.equal(await userFactory(storytree, shipped, [second!, first!, plain, stray]), first, "of several, the first by name");
        assert.equal((await storytree.listProjects()).includes(shipped), false, "and no factory is made");
        assert.equal(await userFactory(storytree, shipped, [plain, stray]), shipped, "a marked project with no folder is not found: storytree's own is made");
        assert.equal(await userFactory(storytree, shipped, [first!, shipped, plain]), shipped, "one of storytree's names comes first");
      } finally {
        for (const project of trunked) await forgetTrunk(storytree, { project });
      }
    });
  });
});

test("6.11 a factory the user brought that another computer deletes while it is being looked at is not found, and storytree's own is made (ADR-1086 D4)", async () => {
  const shipped = uniqueProjectName();
  const brought = Array.from({ length: 40 }, () => uniqueProjectName());
  await withTempDir(async (dir) => {
    const machine = machineOf(machines(dir).laptop);
    await withStorytree([shipped, ...brought], async (storytree) => {
      for (const project of brought) {
        await (await storytree.openProject(project)).markFactory();
        await registerTrunk(storytree, { project, machine: machine.id, machineName: machine.name, folder: path.join(dir, project) }, "setup");
        try {
          const [found] = await Promise.all([userFactory(storytree, shipped, [project]), dropTestProjects([project])]);
          assert.ok(found === project || found === shipped, `found ${found}`);
        } finally {
          await forgetTrunk(storytree, { project });
        }
      }
    });
  });
});

test("6.11 setting the first project up makes the user's factory, a project with no folder holding the starter pack, and every new project names it, holding no copy of the pack; a later project finds it, a join makes none, and a product project already holding its name leaves it the next free one (ADR-1040)", async () => {
  const [factory, first, second, before] = [uniqueProjectName(), uniqueProjectName(), uniqueProjectName(), uniqueProjectName()];
  await withTempDir(async (dir) => {
    const { laptop, box } = machines(dir);
    const folders = [path.join(dir, "first"), path.join(dir, "second"), path.join(dir, "box-first"), path.join(dir, "before")];
    for (const folder of folders) mkdirSync(folder);
    await withStorytree([factory, first, second, before, `${factory}-2`, `${second}-2`], async (storytree) => {
      const linkOf = async (project: string) => {
        const library = await storytree.openProject(project, { create: false });
        try {
          return { link: await library.factory(), roles: (await library.list("agent")).map((role) => role.id).sort() };
        } finally {
          await library.close();
        }
      };

      await setUpProject({ folder: folders[0]!, project: first, storytree, storytreeHome: laptop, factory });
      const made = await linkOf(factory);
      assert.deepEqual(made.link, { kind: "factory" });
      assert.equal(findProject(dir).project, undefined, "the factory has no folder of its own");
      assert.deepEqual(await linkOf(first), { link: { kind: "product", factory }, roles: made.roles }, "the product holds no copy: its roles are the factory's own");

      await setUpProject({ folder: folders[1]!, project: second, storytree, storytreeHome: laptop, factory });
      assert.deepEqual((await linkOf(second)).link, { kind: "product", factory }, "a later project finds the same factory");
      await setUpProject({ folder: folders[2]!, project: first, storytree, storytreeHome: box, join: true, factory });
      assert.deepEqual(await linkOf(factory), made, "neither seeds the factory again");
      assert.equal((await storytree.listProjects()).includes(`${factory}-2`), false, "no second factory is made");

      // A product project holding the name the factory would take leaves it the next free one.
      await setUpProject({ folder: folders[3]!, project: before, storytree, storytreeHome: laptop, factory: second });
      assert.deepEqual((await linkOf(before)).link, { kind: "product", factory: `${second}-2` });
      const next = await linkOf(`${second}-2`);
      assert.deepEqual(next.link, { kind: "factory" });
      assert.deepEqual((await linkOf(second)).link, { kind: "product", factory }, "the product project keeps its own factory");
    });
  });
});
