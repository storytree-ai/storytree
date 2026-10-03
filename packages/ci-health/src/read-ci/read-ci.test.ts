import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { connect, type Library } from "@storytree/library";
import { gitIn, readProjectCi, VERIFIED_BY_PROJECT_CI, type GitHub } from "./read-ci.js";

/** A project in the test Postgres `pnpm test` starts, dropped afterwards: one story, its agent reporting every contract passing. */
async function shopLibrary(t: { after(fn: () => Promise<void>): void }): Promise<{ library: Library; capability: string; contracts: string[] }> {
  const url = process.env.STORYTREE_TEST_PG_URL;
  if (url === undefined) throw new Error("run the tests via `pnpm test`, which starts a local Postgres");
  const storytree = await connect({ url });
  const name = `t-${randomBytes(4).toString("hex")}`;
  const library = await storytree.openProject(name);
  t.after(async () => {
    await storytree.dropProject(name);
    await storytree.close();
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

/** The project's folder: a git repository whose one commit holds the story's tests, with a GitHub origin unless told otherwise. */
function projectFolder(t: { after(fn: () => void): void }, origin: string | null = "https://github.com/acme/shop.git"): { folder: string; commit: string } {
  const folder = mkdtempSync(path.join(tmpdir(), "ci-health-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
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
  if (origin !== null) git("remote", "add", "origin", origin);
  return { folder, commit: git("rev-parse", "HEAD") };
}

/** GitHub as the Actions API answers: the repository, its runs for the query asked, a run's jobs and their logs. */
function github(runs: (query: URLSearchParams) => object[], log: string): GitHub & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    async json(route) {
      asked.push(route);
      const [where, query = ""] = route.split("?");
      if (where === "repos/acme/shop") return { default_branch: "trunk" };
      if (where === "repos/acme/shop/actions/runs") return { workflow_runs: runs(new URLSearchParams(query)) };
      if (where === "repos/acme/shop/actions/runs/7/jobs") return { jobs: [{ id: 70 }] };
      throw new Error(`no such route: ${route}`);
    },
    async text(route) {
      asked.push(route);
      if (route === "repos/acme/shop/actions/jobs/70/logs") return log;
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
