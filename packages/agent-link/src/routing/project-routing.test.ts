/**
 * Capability 1 · Project routing: one test per contract 1.1-1.6 in the agent link story.
 *
 * The folders are throwaway directories. Setting one up opens its project in the library on the
 * real Postgres `pnpm test` provides; each such project is named with uniqueProjectName() and its
 * database is dropped afterwards, pass or fail.
 *
 * "Is storytree running, and where?" is read from the owner record @storytree/local-postgres keeps
 * beside the app's data directory (`<dataDir>.owner.json`) while the app's Postgres runs. The test
 * server was started the same way, so its own record is the real thing; a crashed app's record is
 * written here in the same shape.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import path from "node:path";
import { test } from "node:test";

import { connect, ProjectNameError, type Storytree } from "@storytree/library";
import pg from "pg";

import { setLibrary } from "../settings/settings.js";
import { git, withTempDir } from "../testing/folders.js";
import { dropTestProjects, testServerDataDir, testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { setUpTrunks } from "./trunks.js";
import { findProject, locateStorytree, MARKER_FILE, NOT_A_PROJECT, NOT_RUNNING, recordTrunkOnSight, route, setUpProject, suggestProjectName, type ProjectLookup } from "./index.js";

/** "Well under a second", as the tests hold it. */
const QUICK_MS = 500;

/** Run `body` with a connection to the test server; afterwards close it and drop `projects`' libraries. */
/** The project a lookup found and the folder holding its marker, leaving aside the database identity the marker records. */
function named(lookup: ProjectLookup): { project: string; folder: string } | ProjectLookup {
  return lookup.project === undefined ? lookup : { project: lookup.project, folder: lookup.folder };
}

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

/** A folder under `dir` that is already set up as `project`: the marker, as the spec shapes it. */
function markedFolder(dir: string, project: string): string {
  const folder = path.join(dir, project);
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, MARKER_FILE), `${JSON.stringify({ project })}\n`);
  return folder;
}

/** The owner record local-postgres keeps beside a data directory while a process holds it. */
function writeOwnerRecord(dataDir: string, record: { pid: number; port: number }): void {
  mkdirSync(path.dirname(dataDir), { recursive: true });
  const owner = { ...record, token: "a crashed app's", owner: "the storytree 0.3 desktop app", startedAt: new Date().toISOString() };
  writeFileSync(`${dataDir}.owner.json`, JSON.stringify(owner));
}

/** `fn`'s result and how long it took, in milliseconds. */
function timed<T>(fn: () => T): { result: T; ms: number } {
  const started = performance.now();
  const result = fn();
  return { result, ms: performance.now() - started };
}

test('1.1 setting a folder up as project "site" leaves a marker naming it, and asking from the folder, a sub-folder and a git worktree of it all give "site"', async () => {
  const project = uniqueProjectName(); // "site", unique on the shared test server
  await withTempDir(async (dir) => {
    const folder = path.join(dir, "site");
    mkdirSync(path.join(folder, "src", "components"), { recursive: true });
    git(folder, "init", "-q");
    git(folder, "commit", "-q", "--allow-empty", "-m", "first");

    await withStorytree([project], async (storytree) => {
      const setUp = await setUpProject({ folder, project, storytree, storytreeHome: path.join(dir, "app-home") });
      assert.equal(setUp.project, project);
      assert.deepEqual(JSON.parse(readFileSync(path.join(folder, MARKER_FILE), "utf8")), { project, identity: (await storytree.projectIdentities())[project] }, "the marker names the project and its database");
      assert.ok((await storytree.listProjects()).includes(project), "the project's library now exists");
    });

    // A worktree of the folder, beside it. The marker was never committed, so the worktree has no
    // copy of its own: the answer has to come from the folder it is a worktree of.
    const worktree = path.join(dir, "site-feature");
    git(folder, "worktree", "add", "-q", "-b", "feature", worktree);
    mkdirSync(path.join(worktree, "src"), { recursive: true });
    assert.equal(existsSync(path.join(worktree, MARKER_FILE)), false, "the worktree holds no marker");

    for (const from of [folder, path.join(folder, "src", "components"), worktree, path.join(worktree, "src")]) {
      assert.deepEqual(named(findProject(from)), { project, folder }, `asked from ${from}`);
    }
  });
});

test('1.2 a folder with no marker, in it or above it, gives "not a storytree project"', async () => {
  // test-removed: the message's exact wording (ADR-0623): the answer is checked by its status below.
  await withTempDir((dir) => {
    const plain = path.join(dir, "plain", "src");
    mkdirSync(plain, { recursive: true });
    assert.deepEqual(findProject(plain), { project: undefined, message: NOT_A_PROJECT });

    // A git repository with no marker, and a worktree of it, are no different.
    const repo = path.join(dir, "repo");
    mkdirSync(repo);
    git(repo, "init", "-q");
    git(repo, "commit", "-q", "--allow-empty", "-m", "first");
    const worktree = path.join(dir, "repo-feature");
    git(repo, "worktree", "add", "-q", "-b", "feature", worktree);
    assert.deepEqual(findProject(repo), { project: undefined, message: NOT_A_PROJECT });
    assert.deepEqual(findProject(worktree), { project: undefined, message: NOT_A_PROJECT });

    // So routing sends nothing anywhere, whatever the state of storytree.
    assert.deepEqual(route(plain, { dataDir: testServerDataDir() }), { status: "not-a-project", message: NOT_A_PROJECT });
  });
});

test("1.3 a project name the library would refuse is refused when setting a folder up, and nothing is written", async () => {
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

test("1.4 with the app's database stopped, asking where to send activity answers \"storytree isn't running\" in well under a second", async () => {
  // test-removed: the message's exact wording (ADR-0623): the answer is checked by its status below.
  await withTempDir(async (dir) => {
    const folder = markedFolder(dir, "site");

    // Running: the test server's own owner record says where it listens.
    const running = { dataDir: testServerDataDir() };
    const discovered = locateStorytree(running);
    assert.deepEqual(discovered, { running: true, url: testServerUrl() });
    assert.deepEqual(route(path.join(folder, "src"), running), { status: "routed", project: "site", folder, library: { url: testServerUrl() } });
    assert.ok(discovered.running);
    const client = new pg.Client({ connectionString: discovered.url, connectionTimeoutMillis: 3000 });
    try {
      await client.connect();
      assert.deepEqual((await client.query("SELECT 42 AS synthetic")).rows, [{ synthetic: 42 }]);
    } finally { await client.end(); }

    // Explicit staging: today's legacy launcher has neither auth marker. Once either
    // marker exists, discovery must use producer credentials; no fixture replaces them.
    const owner = JSON.parse(readFileSync(`${running.dataDir}.owner.json`, "utf8"));
    const url = new URL(discovered.url);
    if (Object.hasOwn(owner, "auth") || existsSync(`${running.dataDir}.auth`)) {
      assert.ok(url.password, "an authenticated launcher must supply its password through discovery");
      for (const bad of ["", "incorrect-synthetic-password"]) {
        const rejectedUrl = new URL(discovered.url);
        rejectedUrl.password = bad;
        const rejected = new pg.Client({ connectionString: rejectedUrl.href, password: () => bad, connectionTimeoutMillis: 3000 });
        try { await assert.rejects(rejected.connect()); } finally { await rejected.end(); }
      }
    } else {
      assert.equal(url.password, "", "only a legacy installation has a passwordless URL");
    }

    // Stopped: a stopped server leaves no owner record.
    const stopped = { dataDir: path.join(dir, "home", "pgdata") };
    const { result, ms } = timed(() => route(folder, stopped));
    assert.deepEqual(result, { status: "not-running", project: "site", message: NOT_RUNNING });
    assert.deepEqual(locateStorytree(stopped), { running: false, message: NOT_RUNNING });
    assert.ok(ms < QUICK_MS, `answered in ${ms.toFixed(0)} ms`);
  });
});

test("1.5 a leftover address from a crashed app counts as not running: it answers in well under a second and never hangs", async () => {
  // The pid of a process that has ended, as a crashed app leaves it in its owner record.
  const gone = spawnSync(process.execPath, ["-e", "0"]).pid;
  // Something on the leftover port that accepts a connection and never answers: were routing to
  // try the address, it would hang there.
  const silent = createServer(() => {});
  await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
  const { port } = silent.address() as AddressInfo;
  try {
    await withTempDir((dir) => {
      const folder = markedFolder(dir, "site");
      const dataDir = path.join(dir, "home", "pgdata");
      writeOwnerRecord(dataDir, { pid: gone, port });
      const { result, ms } = timed(() => route(folder, { dataDir }));
      assert.deepEqual(result, { status: "not-running", project: "site", message: NOT_RUNNING });
      assert.ok(ms < QUICK_MS, `answered in ${ms.toFixed(0)} ms`);

      // A record that cannot be read counts the same.
      writeFileSync(`${dataDir}.owner.json`, "{ half a rec");
      assert.deepEqual(locateStorytree({ dataDir }), { running: false, message: NOT_RUNNING });
    });
  } finally {
    silent.close();
  }
});

test("1.6 with the library set to Cloud SQL, a project routes to that instance whether or not the app's database runs, and no local address is tried", async () => {
  const cloudSql = { instance: "my-project:australia-southeast1:my-instance", user: "you@example.com" };
  // A live process's record pointing at a port that accepts and never answers: trying it would hang.
  const silent = createServer(() => {});
  await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
  const { port } = silent.address() as AddressInfo;
  try {
    await withTempDir((dir) => {
      const folder = markedFolder(dir, "site");
      const home = path.join(dir, "home");
      const dataDir = path.join(home, "pgdata");
      setLibrary(["cloudsql", cloudSql.instance, cloudSql.user], home);

      const stopped = timed(() => route(folder, { dataDir }));
      assert.deepEqual(stopped.result, { status: "routed", project: "site", folder, library: { cloudSql } });
      assert.ok(stopped.ms < QUICK_MS, `answered in ${stopped.ms.toFixed(0)} ms`);
      writeOwnerRecord(dataDir, { pid: process.pid, port });
      assert.deepEqual(route(folder, { dataDir }), { status: "routed", project: "site", folder, library: { cloudSql } });

      // Set back to local, routing follows the app's owner record again.
      setLibrary(["local"], home);
      assert.deepEqual(route(folder, { dataDir }), { status: "routed", project: "site", folder, library: { url: `postgres://postgres@127.0.0.1:${port}/postgres` } });
    });
  } finally {
    silent.close();
  }
});

test("10.13 with the library set to a Postgres address, a project routes to that address and no local address is tried", async () => {
  await withTempDir((dir) => {
    const folder = markedFolder(dir, "site");
    const home = path.join(dir, "home");
    const address = "postgres://me@db.example.com:5432/postgres?sslmode=require";
    setLibrary(["postgres", address], home);
    assert.deepEqual(route(folder, { dataDir: path.join(home, "pgdata") }), { status: "routed", project: "site", folder, library: { address } });
  });
});

test("1.7 routing reads only the library setting: damage elsewhere in settings.json does not stop it, and a damaged library setting refuses naming the file", async () => {
  await withTempDir((dir) => {
    const folder = markedFolder(dir, "site");
    const home = path.join(dir, "home");
    mkdirSync(home, { recursive: true });
    const file = path.join(home, "settings.json");
    const cloudSql = { instance: "my-project:australia-southeast1:my-instance", user: "you@example.com" };
    writeFileSync(file, JSON.stringify({ "context-guidance": "four hundred", library: { location: "cloudsql", ...cloudSql } }));
    assert.deepEqual(route(folder, { home }), { status: "routed", project: "site", folder, library: { cloudSql } });
    for (const damaged of ['{"library":{"location":"cloudsql","instance":"bad"}}', "{ half a file"]) {
      writeFileSync(file, damaged);
      assert.throws(() => route(folder, { home }), (error: unknown) => error instanceof Error && error.message.includes(file));
      assert.equal(readFileSync(file, "utf8"), damaged, "a damaged file is never rewritten");
    }
  });
});

/** Two storytree homes stand for two machines: each keeps its own machine identity. */
function machines(dir: string): { laptop: string; box: string } {
  return { laptop: path.join(dir, "laptop-home"), box: path.join(dir, "box-home") };
}

/** A refusal of a folder by the one setup check (ADR-0757 D3), with the words it must carry. */
function folderRefusal(...words: string[]): (error: unknown) => boolean {
  return (error: unknown) => error instanceof Error && error.name === "ProjectFolderError" && words.every((word) => error.message.includes(word));
}

test("1.8 a folder that is a project's trunk, inside one, a git worktree of one, or holding one is refused for another project, and nothing is written", async () => {
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

test("1.9 a second folder for a project already living on this machine is refused, joining or not; its trunk keeps routing", async () => {
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

test("1.10 a new folder named like an existing project is refused unless it joins on purpose, and the refusal suggests the first free name", async () => {
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

test("1.11 another machine adds its checkout to an existing project only on purpose, and a git worktree of it then routes there; joining a missing project is refused", async () => {
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

test("1.12 a project set up before trunks were recorded keeps routing, and the first sight of it from a git worktree records its trunk on this machine, so a second trunk is then refused", async () => {
  const project = uniqueProjectName();
  await withTempDir(async (dir) => {
    const { laptop } = machines(dir);
    const trunk = markedFolder(dir, "app");
    writeFileSync(path.join(trunk, MARKER_FILE), `${JSON.stringify({ project })}\n`);
    git(trunk, "init", "-q");
    git(trunk, "add", MARKER_FILE);
    git(trunk, "commit", "-q", "-m", "first");
    const worktree = path.join(dir, "app-feature");
    git(trunk, "worktree", "add", "-q", "-b", "feature", worktree);
    await withStorytree([project], async (storytree) => {
      await (await storytree.openProject(project)).close();
      assert.deepEqual(named(findProject(worktree)), { project, folder: worktree }, "the committed marker routes the worktree as before");
      assert.equal(await recordTrunkOnSight(storytree, project, worktree, laptop), true);
      assert.equal(await recordTrunkOnSight(storytree, project, trunk, laptop), false, "seen again, nothing changes");
      const second = path.join(dir, "copy");
      mkdirSync(second);
      await assert.rejects(setUpProject({ folder: second, project, storytree, storytreeHome: laptop, join: true }), folderRefusal(trunk));
    });
  });
});

test("1.13 a trunk whose folder moved follows it on first sight, and one whose folder is gone gives way to a new folder joining; a live trunk is still never moved", async () => {
  const project = uniqueProjectName();
  await withTempDir(async (dir) => {
    const { laptop } = machines(dir);
    const [old, moved] = [path.join(dir, "old", "app"), path.join(dir, "moved", "app")];
    mkdirSync(old, { recursive: true });
    mkdirSync(path.dirname(moved));
    await withStorytree([project], async (storytree) => {
      await setUpProject({ folder: old, project, storytree, storytreeHome: laptop });
      renameSync(old, moved);
      assert.equal(await recordTrunkOnSight(storytree, project, moved, laptop), true, "the moved folder, seen, becomes the trunk");
      const copy = path.join(dir, "copy");
      mkdirSync(copy);
      await assert.rejects(setUpProject({ folder: copy, project, storytree, storytreeHome: laptop, join: true }), folderRefusal(moved), "the trunk it moved to is live");

      rmSync(moved, { recursive: true });
      await setUpProject({ folder: copy, project, storytree, storytreeHome: laptop, join: true });
      assert.deepEqual(named(findProject(copy)), { project, folder: copy }, "a fresh folder joins in place of the deleted one");
    });
  });
});

test("1.1 first setups that race on a new server all find the trunks table, none refused by the other's CREATE", async () => {
  const database = `storytree-trunks-${uniqueProjectName()}`;
  const storytree = await connect({ url: testServerUrl() });
  try {
    const pool = await storytree.ownDatabase(database);
    for (let round = 0; round < 5; round++) {
      await pool.query("DROP TABLE IF EXISTS trunks");
      await Promise.all(Array.from({ length: 8 }, () => setUpTrunks(pool)));
    }
  } finally {
    await storytree.close();
    const client = new pg.Client({ connectionString: testServerUrl() });
    await client.connect();
    await client.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`).finally(() => client.end());
  }
});

test("1.14 setting a new project up seeds its library with the starter roles, an orchestrator and a librarian, and the principles they stand on; joining it from another machine adds no second copy", async () => {
  const project = uniqueProjectName();
  await withTempDir(async (dir) => {
    const { laptop, box } = machines(dir);
    const [onLaptop, onBox] = [path.join(dir, "laptop", "app"), path.join(dir, "box", "app")];
    mkdirSync(onLaptop, { recursive: true });
    mkdirSync(onBox, { recursive: true });
    await withStorytree([project], async (storytree) => {
      const roles = async () => {
        const library = await storytree.openProject(project);
        try {
          const found = [];
          for (const title of ["orchestrator", "librarian"]) {
            const agents = (await library.search(title)).map((note) => ({ type: note.type, ...(note.fields as { title?: string; context?: string[] }) })).filter((note) => note.type === "agent" && note.title === title);
            for (const agent of agents) {
              for (const id of agent.context ?? []) assert.equal((await library.get(id))?.type, "principle", `${title} stands on a live principle`);
            }
            found.push(...agents.map((agent) => agent.title));
          }
          return found;
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
      assert.deepEqual(await roles(), ["orchestrator", "librarian"], "the retry adds no second copy");
      await setUpProject({ folder: onBox, project, storytree, storytreeHome: box, join: true });
      assert.deepEqual(await roles(), ["orchestrator", "librarian"], "joining adds no second copy");
    });
  });
});
