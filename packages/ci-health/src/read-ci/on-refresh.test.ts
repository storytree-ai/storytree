import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setImmediate as tick } from "node:timers/promises";
import { test } from "node:test";

import { connect, type Library, type Storytree } from "@storytree/library";
import { removeTemp, waitUntil } from "@storytree/test-waits";

import { ciTimesAnswers } from "../ci-times/runtime.js";
import { LOOK_EVERY_MS, readCiOnRefresh } from "./on-refresh.js";
import { VERIFIED_BY_PROJECT_CI, type GitHub } from "./read-ci.js";

const NOW = new Date("2026-11-23T12:00:00Z");

async function shopLibrary(t: { after(fn: () => Promise<void>): void }): Promise<{ storytree: Storytree; project: string; library: Library; contracts: string[] }> {
  const url = process.env.STORYTREE_TEST_PG_URL;
  if (url === undefined) throw new Error("run the tests via `pnpm test`, which starts a local Postgres");
  const storytree = await connect({ url });
  const project = `t-${randomBytes(4).toString("hex")}`;
  const library = await storytree.openProject(project);
  t.after(async () => {
    try {
      await storytree.dropProject(project);
    } finally {
      await storytree.close();
    }
  });
  const story = await library.addStory({ title: "Check out" });
  const capability = await library.addCapability({ title: "1 · Checkout pages", story: story.id, proposed: false });
  const contracts = [];
  for (const title of ["1.1 · Your information page shows the form", "1.2 · Missing details show the error"]) {
    const contract = await library.addContract({ title, capability: capability.id });
    await library.reportHealth(contract.id, "passing", { by: "an agent" });
    contracts.push(contract.id);
  }
  return { storytree, project, library, contracts };
}

function projectFolder(t: { after(fn: () => void): void }): { folder: string; commit: string } {
  const folder = mkdtempSync(path.join(tmpdir(), "ci-health-"));
  t.after(() => removeTemp(folder));
  const git = (...args: string[]) => execFileSync("git", ["-C", folder, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { encoding: "utf8" }).trim();
  git("init", "-q");
  mkdirSync(path.join(folder, "packages/check-out/src"), { recursive: true });
  writeFileSync(path.join(folder, "packages/check-out/src/checkout.test.js"), [
    `import { test } from "node:test";`,
    `test("1.1 your information page shows the form", () => {});`,
    `test("1.2 missing details show the error", () => {});`,
  ].join("\n"));
  git("add", ".");
  git("commit", "-q", "-m", "checkout");
  git("remote", "add", "origin", "https://github.com/acme/shop.git");
  return { folder, commit: git("rev-parse", "HEAD") };
}

const tap = (second: "ok" | "not ok") => [
  "2026-11-23T11:50:26.1100000Z TAP version 13",
  "2026-11-23T11:50:26.1300000Z ok 1 - 1.1 your information page shows the form",
  `2026-11-23T11:50:26.1700000Z ${second} 2 - 1.2 missing details show the error`,
].join("\n");

const notFound = (route: string) => Object.assign(new Error(`Command failed: gh api ${route}\ngh: Not Found (HTTP 404)\n`), { stderr: "gh: Not Found (HTTP 404)\n" });

function shopGitHub(commit: string, { wired = true, before = async () => {} }: { wired?: boolean; before?: (route: string) => Promise<void> } = {}): GitHub & { asked: string[]; newest: { id: number; second: "ok" | "not ok" } } {
  const asked: string[] = [];
  const newest = { id: 7, second: "ok" as "ok" | "not ok" };
  const run = () => ({ id: newest.id, workflow_id: 99, conclusion: "success", head_sha: commit, head_branch: "trunk", html_url: `https://github.com/acme/shop/actions/runs/${newest.id}` });
  const finishedPushOnTrunk = (query: URLSearchParams) => query.get("branch") === "trunk" && query.get("event") === "push" && query.get("status") === "completed";
  return {
    asked,
    newest,
    async json(route) {
      asked.push(route);
      await before(route);
      const [where, query = ""] = route.split("?");
      const params = new URLSearchParams(query);
      if (where === "repos/acme/shop") return { default_branch: "trunk" };
      if (where === "repos/acme/shop/actions/workflows/storytree.yml/runs") {
        if (!wired) throw notFound(route);
        return { total_count: 1, workflow_runs: finishedPushOnTrunk(params) ? [run()] : [] };
      }
      if (where === "repos/acme/shop/actions/runs") return { workflow_runs: finishedPushOnTrunk(params) ? [run()] : [] };
      if (where === `repos/acme/shop/actions/runs/${newest.id}/jobs`) return { jobs: [{ id: newest.id * 10, conclusion: "success", name: "test (ubuntu-latest)" }] };
      throw new Error(`no such route: ${route}`);
    },
    async text(route) {
      asked.push(route);
      if (route === `repos/acme/shop/actions/jobs/${newest.id * 10}/logs`) return tap(newest.second);
      throw new Error(`no such route: ${route}`);
    },
  };
}

const routes = (asked: readonly string[]) => asked.map((route) => route.split("?")[0]);

test("3.27 · Looking at a project's CI reads the newest finished push run of its storytree.yml on the default branch into verified health once; the same run is not read again, a look inside five minutes asks GitHub nothing, and a newer run five minutes on is read", async (t) => {
  const { project, library, contracts } = await shopLibrary(t);
  const { folder, commit } = projectFolder(t);
  const github = shopGitHub(commit);
  const opened: string[] = [];
  let now = NOW;
  const look = readCiOnRefresh({ open: async (name) => { opened.push(name); return library; }, github, now: () => now });
  const verified = async () => Promise.all(contracts.map(async (id) => (await library.health(id)).verified));

  await look(project, folder);
  assert.deepEqual(opened, [project], "a new run opens the project's library");
  const workflowAsk = github.asked.find((route) => route.startsWith("repos/acme/shop/actions/workflows/storytree.yml/runs?"));
  assert.ok(workflowAsk !== undefined, JSON.stringify(github.asked));
  const asked = new URLSearchParams(workflowAsk.split("?")[1]);
  assert.deepEqual([asked.get("branch"), asked.get("event"), asked.get("status"), asked.get("per_page")], ["trunk", "push", "completed", "1"]);
  const first = await verified();
  assert.deepEqual(first.map(({ state, by, source }) => [state, by, source]), [["passing", VERIFIED_BY_PROJECT_CI, "ci"], ["passing", VERIFIED_BY_PROJECT_CI, "ci"]]);
  assert.match(first[1]!.note ?? "", /run https:\/\/github\.com\/acme\/shop\/actions\/runs\/7/);
  assert.equal(routes(github.asked).filter((route) => route === "repos/acme/shop/actions/runs/7/jobs").length, 1);
  assert.equal(routes(github.asked).filter((route) => route === "repos/acme/shop/actions/jobs/70/logs").length, 1);

  const before = github.asked.length;
  await look(project, folder);
  assert.deepEqual(github.asked.slice(before), [], "a look at the same moment asks GitHub nothing");

  now = new Date(NOW.getTime() + LOOK_EVERY_MS);
  const fiveOn = github.asked.length;
  await look(project, folder);
  assert.deepEqual(routes(github.asked.slice(fiveOn)), ["repos/acme/shop", "repos/acme/shop/actions/workflows/storytree.yml/runs"], "five minutes on it looks again, and a run already read is not read");
  assert.deepEqual(opened, [project], "nor is the library opened for it");

  now = new Date(NOW.getTime() + 2 * LOOK_EVERY_MS - 1);
  github.newest.id = 8;
  github.newest.second = "not ok";
  const inside = github.asked.length;
  await look(project, folder);
  assert.deepEqual(github.asked.slice(inside), [], "a look less than five minutes after the last asks GitHub nothing");
  assert.equal((await library.health(contracts[1]!)).verified.state, "passing", "so the newer run is not read yet");

  now = new Date(NOW.getTime() + 3 * LOOK_EVERY_MS);
  await look(project, folder);
  assert.deepEqual(opened, [project, project], "a newer run opens the library again");
  assert.equal(routes(github.asked).filter((route) => route === "repos/acme/shop/actions/runs/8/jobs").length, 1);
  const second = await verified();
  assert.deepEqual(second.map(({ state }) => state), ["passing", "failing"], "the newer run is read into verified health");
  assert.match(second[1]!.note ?? "", /run https:\/\/github\.com\/acme\/shop\/actions\/runs\/8/);
  assert.equal(second[1]!.by, VERIFIED_BY_PROJECT_CI);
});

test("3.27 · A project whose repository has no storytree.yml workflow (GitHub answers HTTP 404) is not read: nothing is written, the library is not opened, and the look does not throw", async (t) => {
  const { project, library, contracts } = await shopLibrary(t);
  const { folder, commit } = projectFolder(t);
  const github = shopGitHub(commit, { wired: false });
  const opened: string[] = [];
  const look = readCiOnRefresh({ open: async (name) => { opened.push(name); return library; }, github, now: () => NOW });

  await look(project, folder);
  assert.deepEqual(opened, [], "the library is not opened");
  assert.deepEqual(routes(github.asked), ["repos/acme/shop", "repos/acme/shop/actions/workflows/storytree.yml/runs"], "no run, job or log is asked for");
  for (const id of contracts) {
    const { verified, reported } = await library.health(id);
    assert.equal(verified.state, "not-checked", "nothing is written");
    assert.equal(reported.by, "an agent");
  }
});

test("3.27 · Every CI times ask for a known project looks at its CI with the project and its folder, and the answer does not wait on the look", async (t) => {
  const url = process.env.STORYTREE_TEST_PG_URL;
  if (url === undefined) throw new Error("run the tests via `pnpm test`, which starts a local Postgres");
  const server = await connect({ url });
  const project = `t-${randomBytes(4).toString("hex")}`;
  await server.openProject(project);
  t.after(async () => {
    try {
      await server.dropProject(project);
    } finally {
      await server.close();
    }
  });
  const looks: [string, string][] = [];
  const answers = ciTimesAnswers({ server: () => server, library: () => ({ projectFolder: async (name) => (name === project ? "/work/shop" : undefined) }) }, {
    now: () => NOW,
    record: async () => {},
    readCi: (name, folder) => {
      looks.push([name, folder]);
      return new Promise<void>(() => {});
    },
  });

  assert.equal(await answers.ciTimes(project), undefined, "answered while the look is still under way");
  await tick();
  assert.deepEqual(looks, [[project, "/work/shop"]]);
  await answers.ciTimes(project);
  await tick();
  assert.deepEqual(looks, [[project, "/work/shop"], [project, "/work/shop"]], "every ask looks; the look itself keeps to once every five minutes");
  await assert.rejects(answers.ciTimes("no-such-project"), /there is no project called/);
  await tick();
  assert.equal(looks.length, 2, "an unknown project is never looked at");
});

type Server = Pick<Storytree, "ownDatabase" | "listProjects" | "openProject">;

function countingServer(storytree: Storytree, refuse: (opened: number) => Error | undefined = () => undefined): Server & { opens: Promise<Library>[] } {
  const opens: Promise<Library>[] = [];
  return {
    opens,
    ownDatabase: (...args) => storytree.ownDatabase(...args),
    listProjects: (...args) => storytree.listProjects(...args),
    openProject: (...args) => {
      const refused = refuse(opens.length + 1);
      const opening = refused === undefined ? storytree.openProject(...args) : Promise.reject(refused);
      opens.push(opening);
      return opening;
    },
  };
}

function logged(t: { mock: { method(object: object, name: string, fn: (...args: unknown[]) => void): unknown } }): { lines: unknown[]; said(count: number): Promise<unknown[]> } {
  const lines: unknown[] = [];
  t.mock.method(console, "error", (line: unknown) => { lines.push(line); });
  return { lines, said: (count) => waitUntil(() => (lines.length >= count ? [...lines] : undefined), 15_000, `${count} error line(s) said`) };
}

test("3.27 · The app's own CI look opens a project's library once per server, however many CI times answerers look, and opens it again after an open that failed, saying that look could not be read", async (t) => {
  const { storytree, project, library, contracts } = await shopLibrary(t);
  const { folder, commit } = projectFolder(t);
  const github = shopGitHub(commit);
  const server = countingServer(storytree, (opened) => (opened === 1 ? new Error("the library refused the connection") : undefined));
  const errors = logged(t);
  const frame = { server: () => server, library: () => ({ projectFolder: async () => folder }) };
  const answerer = () => ciTimesAnswers(frame, { record: async () => {}, github });
  const verified = (contract: string) => async () => (await library.health(contract)).verified.state;

  await answerer().ciTimes(project);
  assert.deepEqual(await errors.said(1), [`The CI of ${project} could not be read: the library refused the connection`]);
  assert.equal((await verified(contracts[0]!)()), "not-checked", "a failed open writes nothing");

  await answerer().ciTimes(project);
  await waitUntil(async () => (await verified(contracts[1]!)()) === "passing", 15_000, "the run read after the failed open");
  assert.equal(server.opens.length, 2, "the failed open is not kept: the next look opens again");

  github.newest.second = "not ok";
  await answerer().ciTimes(project);
  await waitUntil(async () => (await verified(contracts[1]!)()) === "failing", 15_000, "the run read by a third answerer");
  assert.equal(server.opens.length, 2, "the library opened on this server is reused, not opened again");
  assert.deepEqual(errors.lines, [`The CI of ${project} could not be read: the library refused the connection`]);
});

test("3.27 · The app's own CI look says a GitHub failure other than a missing workflow, and writes nothing", async (t) => {
  const { storytree, project, library, contracts } = await shopLibrary(t);
  const { folder, commit } = projectFolder(t);
  const failure = (route: string) => new Error(`Command failed: gh api ${route}\ngh: Server Error (HTTP 500)\n`);
  const github = shopGitHub(commit, { before: async (route) => { if (route.startsWith("repos/acme/shop/actions/workflows/")) throw failure(route); } });
  const server = countingServer(storytree);
  const errors = logged(t);
  const answers = ciTimesAnswers({ server: () => server, library: () => ({ projectFolder: async () => folder }) }, { record: async () => {}, github });

  await answers.ciTimes(project);
  const lines = await errors.said(1);
  const route = github.asked.find((one) => one.startsWith("repos/acme/shop/actions/workflows/"))!;
  assert.deepEqual(lines, [`The CI of ${project} could not be read: ${failure(route).message}`]);
  assert.equal(server.opens.length, 0, "the library is not opened");
  for (const id of contracts) assert.equal((await library.health(id)).verified.state, "not-checked");
});

test("3.27 · A CI look under way when the library closes says no error", async (t) => {
  const url = process.env.STORYTREE_TEST_PG_URL;
  if (url === undefined) throw new Error("run the tests via `pnpm test`, which starts a local Postgres");
  const storytree = await connect({ url });
  t.after(() => storytree.close().catch(() => {}));
  const project = `t-${randomBytes(4).toString("hex")}`;
  await storytree.openProject(project);
  t.after(async () => {
    const again = await connect({ url });
    try { await again.dropProject(project); } finally { await again.close(); }
  });
  const { folder, commit } = projectFolder(t);
  let asked!: () => void;
  const reached = new Promise<void>((resolve) => { asked = resolve; });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const github = shopGitHub(commit, { before: async (route) => { if (route === "repos/acme/shop") { asked(); await gate; } } });
  const server = countingServer(storytree);
  const errors = logged(t);
  const answers = ciTimesAnswers({ server: () => server, library: () => ({ projectFolder: async () => folder }) }, { record: async () => {}, github });

  await answers.ciTimes(project);
  await reached;
  await storytree.close();
  release();
  await waitUntil(() => server.opens.length === 1, 15_000, "the look opening the closed library");
  await assert.rejects(server.opens[0]!, "the closed library refuses the open");
  await tick();
  await tick();
  assert.deepEqual(errors.lines, [], "no error is said");
});
