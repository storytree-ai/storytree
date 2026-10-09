import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { connect, type Library } from "@storytree/library";
import { ghApi, gitIn, readProjectCi, VERIFIED_BY_PROJECT_CI, type GitHub } from "../index.js";

/** A project in the test Postgres `pnpm test` starts, dropped afterwards: one story, its agent reporting every contract passing. */
async function shopLibrary(t: { after(fn: () => Promise<void>): void }): Promise<{ library: Library; capability: string; contracts: string[] }> {
  const url = process.env.STORYTREE_TEST_PG_URL;
  if (url === undefined) throw new Error("run the tests via `pnpm test`, which starts a local Postgres");
  const storytree = await connect({ url });
  const name = `t-${randomBytes(4).toString("hex")}`;
  const library = await storytree.openProject(name);
  t.after(async () => {
    try {
      await storytree.dropProject(name);
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
  return { library, capability: capability.id, contracts };
}

/** The project's folder: a git repository whose one commit holds the story's tests (in its package's `tests`, `src` by default), with a GitHub origin unless told otherwise. */
function projectFolder(t: { after(fn: () => void): void }, origin: string | null = "https://github.com/acme/shop.git", tests = "src"): { folder: string; commit: string } {
  const folder = mkdtempSync(path.join(tmpdir(), "ci-health-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync("git", ["-C", folder, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { encoding: "utf8" }).trim();
  git("init", "-q");
  mkdirSync(path.join(folder, "packages/check-out", tests), { recursive: true });
  writeFileSync(path.join(folder, "packages/check-out", tests, "checkout.test.js"), [
    `import { test } from "node:test";`,
    `test("1.1 your information page shows the form", () => {});`,
    `test("1.2 missing details show the error", () => {});`,
  ].join("\n"));
  git("add", ".");
  git("commit", "-q", "-m", "checkout");
  if (origin !== null) git("remote", "add", "origin", origin);
  return { folder, commit: git("rev-parse", "HEAD") };
}

/** GitHub as the Actions API answers: the repository, its runs for the query asked, a run's jobs and their logs. */
function github(runs: (query: URLSearchParams) => object[], log: string, jobs: { id: number; conclusion: string; name?: string; labels?: string[] }[] = [{ id: 70, conclusion: "success" }, { id: 71, conclusion: "skipped" }]): GitHub & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    async json(route) {
      asked.push(route);
      const [where, query = ""] = route.split("?");
      if (where === "repos/acme/shop") return { default_branch: "trunk" };
      if (where === "repos/acme/shop/actions/runs") return { workflow_runs: runs(new URLSearchParams(query)) };
      if (where === "repos/acme/shop/actions/runs/7/jobs") return { jobs };
      throw new Error(`no such route: ${route}`);
    },
    async text(route) {
      asked.push(route);
      if (route === "repos/acme/shop/actions/jobs/70/logs") return log;
      // A skipped job ran nothing, so it has no log (storytree's own automerge job, 2026-10-04).
      if (route === "repos/acme/shop/actions/jobs/71/logs") throw new Error(`gh api ${route}: HTTP 404`);
      throw new Error(`no such route: ${route}`);
    },
  };
}

const tap = (second: "ok" | "not ok") => [
  "2026-10-03T20:20:26.1100000Z TAP version 13",
  "2026-10-03T20:20:26.1300000Z ok 1 - 1.1 your information page shows the form",
  `2026-10-03T20:20:26.1700000Z ${second} 2 - 1.2 missing details show the error`,
].join("\n");

/** Only a finished push run on the default branch answers; any other query finds nothing. */
const pushRunsOnTrunk = (commit: string) => (query: URLSearchParams) =>
  query.get("branch") === "trunk" && query.get("event") === "push" && query.get("status") === "completed"
    ? [{ id: 7, head_sha: commit, html_url: "https://github.com/acme/shop/actions/runs/7" }]
    : [];

test("3.1 reading a project's CI writes each contract's verified column from the newest finished push run on the default branch, by the project's CI with its tally, commit and run; the agent's reported column is never written, so CI alone turns the capability unhealthy or healthy", async (t) => {
  const { library, capability, contracts } = await shopLibrary(t);
  const { folder, commit } = projectFolder(t);
  const word = async () => (await library.projectTree()).stories[0]!.capabilities.find(({ id }) => id === capability)!.status;

  const failing = github(pushRunsOnTrunk(commit), tap("not ok"));
  const read = await readProjectCi({ library, git: gitIn(folder), github: failing });
  assert.equal(read.written, true, read.written ? "" : read.why);
  assert.equal(await word(), "unhealthy", "the agent reports both passing; CI failed one");
  const [first, second] = await Promise.all(contracts.map((id) => library.health(id)));
  assert.equal(first!.verified.state, "passing");
  assert.equal(second!.verified.state, "failing");
  assert.equal(second!.verified.by, VERIFIED_BY_PROJECT_CI);
  assert.match(second!.verified.note ?? "", new RegExp(`0/1 tests passed, at commit ${commit.slice(0, 12)}, run https://github\\.com/acme/shop/actions/runs/7`));
  assert.equal(second!.reported.state, "passing", "the agent's word stays the agent's");
  assert.equal(second!.reported.by, "an agent");

  await readProjectCi({ library, git: gitIn(folder), github: github(pushRunsOnTrunk(commit), tap("ok")) });
  assert.equal(await word(), "healthy", "CI passed both");
});

test("3.2 a project with no GitHub origin, or with no finished push run on its default branch, writes nothing and says why; its contracts keep reading not checked", async (t) => {
  const { library, contracts } = await shopLibrary(t);
  const noOrigin = projectFolder(t, null);
  const unasked = github(() => [], "");
  const withoutOrigin = await readProjectCi({ library, git: gitIn(noOrigin.folder), github: unasked });
  assert.equal(withoutOrigin.written, false);
  assert.match(withoutOrigin.written ? "" : withoutOrigin.why, /GitHub/);
  assert.deepEqual(unasked.asked, [], "GitHub is not asked about a project that is not on it");

  const onGitHub = projectFolder(t);
  const noRuns = await readProjectCi({ library, git: gitIn(onGitHub.folder), github: github(() => [], tap("ok")) });
  assert.equal(noRuns.written, false);
  assert.match(noRuns.written ? "" : noRuns.why, /no finished push run on trunk/);

  for (const id of contracts) assert.equal((await library.health(id)).verified.state, "not-checked");
  assert.equal((await library.projectTree()).unverified, true, "nothing verifies the project's health");
});

test("3.3 a job log holding terminal escape sequences is read all the same, from a gh that refuses to print one unless allowed (gh 2.102) as from one that prints it as it is", async (t) => {
  const folder = mkdtempSync(path.join(tmpdir(), "ci-health-gh-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const log = "test\tRun npm test\t\u001b[32mok 1 - 1.1 · Your information page shows the form\u001b[0m\n";
  // Like gh 2.102: it refuses a response holding escape sequences until --allow-escape-sequences is passed.
  const strict = path.join(folder, "gh-strict.mjs");
  writeFileSync(strict, `if (!process.argv.includes("--allow-escape-sequences")) { process.stderr.write("the response contains terminal escape sequences; pass --allow-escape-sequences to output it anyway\\n"); process.exit(1); }\nprocess.stdout.write(${JSON.stringify(log)});\n`);
  // Like gh 2.75: it prints the log as it is, and knows no such flag.
  const plain = path.join(folder, "gh-plain.mjs");
  writeFileSync(plain, `if (process.argv.includes("--allow-escape-sequences")) { process.stderr.write("unknown flag: --allow-escape-sequences\\n"); process.exit(1); }\nprocess.stdout.write(${JSON.stringify(log)});\n`);
  for (const gh of [strict, plain]) assert.equal(await ghApi(process.execPath, [gh]).text("repos/acme/shop/actions/jobs/1/logs"), log, path.basename(gh));
});

test("3.4 a story whose tests live in its package's own test folder, outside src, is verified from its CI as one with them under src is", async (t) => {
  const { library, capability } = await shopLibrary(t);
  const { folder, commit } = projectFolder(t, "https://github.com/acme/shop.git", "test");
  const read = await readProjectCi({ library, git: gitIn(folder), github: github(pushRunsOnTrunk(commit), tap("ok")) });
  assert.equal(read.written, true, read.written ? "" : read.why);
  assert.equal((await library.projectTree()).stories[0]!.capabilities.find(({ id }) => id === capability)!.status, "healthy", "both contracts verified passing from packages/check-out/test");
});

test("3.5 a job the run skipped, which has no log, is passed over: the run's other jobs are read all the same", async (t) => {
  const { library, capability } = await shopLibrary(t);
  const { folder, commit } = projectFolder(t);
  const asked = github(pushRunsOnTrunk(commit), tap("ok"));
  const read = await readProjectCi({ library, git: gitIn(folder), github: asked });
  assert.equal(read.written, true, read.written ? "" : read.why);
  assert.equal(read.written && read.tests, 2, "the job that ran is read");
  assert.equal(asked.asked.includes("repos/acme/shop/actions/jobs/71/logs"), false, "the skipped job's log is not asked for");
  assert.equal((await library.projectTree()).stories[0]!.capabilities.find(({ id }) => id === capability)!.status, "healthy");
});

test("3.6 a cancelled job without a log leaves available results readable and contracts without evidence not checked", async (t) => {
  const { library, contracts } = await shopLibrary(t);
  const { folder, commit } = projectFolder(t);
  const asked = github(pushRunsOnTrunk(commit), "ok 1 - 1.1 your information page shows the form", [
    { id: 70, conclusion: "success" }, { id: 71, conclusion: "cancelled" },
  ]);
  const read = await readProjectCi({ library, git: gitIn(folder), github: asked });
  assert.equal(read.written, true, read.written ? "" : read.why);
  assert.equal(read.written && read.tests, 1);
  assert.equal(read.written && read.passing, 1);
  assert.equal((await library.health(contracts[0]!)).verified.state, "passing");
  assert.equal((await library.health(contracts[1]!)).verified.state, "not-checked", "no result must not become a pass");
});

test("3.6 available test results in a cancelled job beside a whole one still count, including failures", async (t) => {
  const { library, contracts } = await shopLibrary(t);
  const { folder, commit } = projectFolder(t);
  const asked = github(pushRunsOnTrunk(commit), tap("not ok"), [{ id: 70, conclusion: "cancelled" }, { id: 72, conclusion: "success" }]);
  const readLog = asked.text;
  asked.text = async (route) => (route.endsWith("/72/logs") ? "ok 1 - 1.1 your information page shows the form" : readLog(route));
  const read = await readProjectCi({ library, git: gitIn(folder), github: asked });
  assert.equal(read.written && read.tests, 3);
  assert.equal((await library.health(contracts[0]!)).verified.state, "passing");
  assert.equal((await library.health(contracts[1]!)).verified.state, "failing");
});

test("3.6 authentication and unrelated log errors remain visible without writing partial verdicts", async (t) => {
  const { library, contracts } = await shopLibrary(t);
  const { folder, commit } = projectFolder(t);
  for (const [conclusion, message] of [
    ["cancelled", "HTTP 401"], ["cancelled", "HTTP 403"], ["cancelled", "HTTP 500"],
    ["cancelled", "connection reset"], ["success", "HTTP 404"], ["failure", "HTTP 404"],
  ]) {
    const asked = github(pushRunsOnTrunk(commit), tap("ok"), [{ id: 70, conclusion: "success" }, { id: 71, conclusion: conclusion! }]);
    const readLog = asked.text;
    const error = Object.assign(new Error("gh failed"), { stderr: `gh: ${message}` });
    asked.text = async (route) => {
      if (route.endsWith("/71/logs")) throw error;
      return readLog(route);
    };
    await assert.rejects(readProjectCi({ library, git: gitIn(folder), github: asked }), (caught) => caught === error, `${conclusion}: ${message}`);
    for (const id of contracts) assert.equal((await library.health(id)).verified.state, "not-checked");
  }
});

test("3.7 each job's results are read as its platform's: a test skipped on Windows for a platform reason and passed on the Linux and macOS jobs verifies passing, and a contract a skip leaves not checked records the skip's kind", async (t) => {
  const { library, contracts } = await shopLibrary(t);
  const { folder, commit } = projectFolder(t);
  const posixSkip = "ok 1 - 1.1 your information page shows the form # SKIP platform:posix: a stand-in gh on PATH must be an .exe on Windows";
  const logs: Record<number, string> = {
    70: [posixSkip, "ok 2 - 1.2 missing details show the error # SKIP owner: needs a signed-in account"].join("\n"),
    71: ["ok 1 - 1.1 your information page shows the form", "ok 2 - 1.2 missing details show the error # SKIP owner: needs a signed-in account"].join("\n"),
    72: ["ok 1 - 1.1 your information page shows the form", "ok 2 - 1.2 missing details show the error # SKIP owner: needs a signed-in account"].join("\n"),
  };
  const asked = github(pushRunsOnTrunk(commit), "", [
    { id: 70, conclusion: "success", name: "verify on Windows", labels: ["windows-latest"] },
    { id: 71, conclusion: "success", name: "verify on Linux", labels: ["ubuntu-latest"] },
    { id: 72, conclusion: "success", name: "verify on macOS", labels: ["macos-latest"] },
  ]);
  asked.text = async (route) => logs[Number(/jobs\/(\d+)\/logs$/.exec(route)?.[1])] ?? "";
  const read = await readProjectCi({ library, git: gitIn(folder), github: asked });
  assert.equal(read.written, true, read.written ? "" : read.why);
  const [first, second] = await Promise.all(contracts.map((id) => library.health(id)));
  assert.equal(first!.verified.state, "passing", "Linux and macOS, the platforms it needs, passed it");
  assert.equal(second!.verified.state, "not-checked");
  assert.equal(second!.verified.skip, "owner", "the skip's kind is recorded, so the worklist says who moves it");
});

test("3.8 a cancelled push run, superseded before its slowest job finished, is passed over: the newest finished push run that ran to its end is read, and a branch whose every finished run was cancelled writes nothing and says why", async (t) => {
  const { library, contracts } = await shopLibrary(t);
  const { folder, commit } = projectFolder(t);
  const runs = (conclusions: string[]) => (query: URLSearchParams) =>
    pushRunsOnTrunk(commit)(query).length === 0 ? [] : conclusions.map((conclusion, at) => ({ id: at === conclusions.length - 1 ? 7 : 90 + at, conclusion, head_sha: commit, html_url: `https://github.com/acme/shop/actions/runs/${at === conclusions.length - 1 ? 7 : 90 + at}` }));
  const asked = github(runs(["cancelled", "cancelled", "success"]), tap("ok"));
  const read = await readProjectCi({ library, git: gitIn(folder), github: asked });
  assert.equal(read.written, true, read.written ? "" : read.why);
  assert.equal(read.written && read.run, "https://github.com/acme/shop/actions/runs/7", "the run that ran to its end is read");
  assert.equal(asked.asked.some((route) => /runs\/9\d\/jobs/.test(route)), false, "no cancelled run's jobs are asked for");
  for (const id of contracts) assert.equal((await library.health(id)).verified.state, "passing");

  const { library: other, contracts: untouched } = await shopLibrary(t);
  const none = await readProjectCi({ library: other, git: gitIn(folder), github: github(runs(["cancelled", "cancelled"]), tap("ok")) });
  assert.equal(none.written, false);
  assert.match(none.written ? "" : none.why, /cancelled/);
  for (const id of untouched) assert.equal((await other.health(id)).verified.state, "not-checked");
});

test("3.8 a push run that concludes failure only because a newer push cancelled the jobs that ran its tests is passed over like a cancelled run: the next run back is read, while a run with one whole test job beside a cancelled one is read", async (t) => {
  const { library, contracts } = await shopLibrary(t);
  const { folder, commit } = projectFolder(t);
  // storytree's own CI (run 37794283051): every platform job cancelled mid-tests, the aggregate verify job failed on that.
  const jobsOf: Record<number, { id: number; conclusion: string; name: string }[]> = {
    91: [{ id: 80, conclusion: "cancelled", name: "verify on Linux" }, { id: 81, conclusion: "cancelled", name: "verify on Windows" }, { id: 82, conclusion: "failure", name: "verify" }],
    7: [{ id: 70, conclusion: "success", name: "verify on Linux" }, { id: 72, conclusion: "success", name: "verify" }],
  };
  const logs: Record<number, string> = { 80: tap("not ok").split("\n").slice(0, 2).join("\n"), 81: "", 82: "verify on Linux: cancelled", 70: tap("ok"), 72: "all platforms passed" };
  const run = (id: number, conclusion: string) => ({ id, conclusion, head_sha: commit, html_url: `https://github.com/acme/shop/actions/runs/${id}` });
  const fake = (runs: object[]) => {
    const asked = github((query) => (pushRunsOnTrunk(commit)(query).length === 0 ? [] : runs), "");
    const json = asked.json;
    asked.json = async (route) => {
      const id = /actions\/runs\/(\d+)\/jobs$/.exec(route)?.[1];
      return id === undefined ? json(route) : { jobs: jobsOf[Number(id)] ?? [] };
    };
    asked.text = async (route) => logs[Number(/jobs\/(\d+)\/logs$/.exec(route)?.[1])] ?? "";
    return asked;
  };

  const read = await readProjectCi({ library, git: gitIn(folder), github: fake([run(91, "failure"), run(7, "success")]) });
  assert.equal(read.written, true, read.written ? "" : read.why);
  assert.equal(read.written && read.run, "https://github.com/acme/shop/actions/runs/7", "the run whose test jobs were cancelled is passed over");
  for (const id of contracts) assert.equal((await library.health(id)).verified.state, "passing");

  // One platform's job ran whole beside a cancelled one: that run is read.
  jobsOf[92] = [{ id: 70, conclusion: "success", name: "verify on Linux" }, { id: 81, conclusion: "cancelled", name: "verify on Windows" }, { id: 82, conclusion: "failure", name: "verify" }];
  const partly = await readProjectCi({ library, git: gitIn(folder), github: fake([run(92, "failure"), run(7, "success")]) });
  assert.equal(partly.written && partly.run, "https://github.com/acme/shop/actions/runs/92");

  const { library: other, contracts: untouched } = await shopLibrary(t);
  const none = await readProjectCi({ library: other, git: gitIn(folder), github: fake([run(91, "failure")]) });
  assert.equal(none.written, false);
  assert.match(none.written ? "" : none.why, /cancelled/);
  for (const id of untouched) assert.equal((await other.health(id)).verified.state, "not-checked");
});
