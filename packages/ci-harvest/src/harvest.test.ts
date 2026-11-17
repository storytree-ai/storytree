import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { connect, type Library } from "@storytree/library";
import type { DoorWords } from "@storytree/library/verbs";
import { removeTemp } from "@storytree/test-waits";

import type { GitHub } from "@storytree/ci-health";

import { HARVEST_FAMILIES } from "./verbs.js";

import { harvestLedger, harvestPool } from "./store.js";
import { gitHubSource, harvest, harvestText, watcherReading, type FailedRun, type HarvestLedger, type RunJob, type HarvestSource } from "./harvest.js";

const NOW = new Date("2026-11-17T12:00:00Z");
const REPO = "acme/shop";
const API = `repos/${REPO}`;

/** A failed run as the harvest lists it. */
function failed(id: number, fields: Partial<FailedRun> = {}): FailedRun {
  return { id, attempt: 1, workflow: "CI", event: "pull_request", head: `${id}`.padStart(12, "a"), branch: "feature", conclusion: "failure", createdAt: "2026-11-17T08:00:00Z", ...fields };
}

/** A CI job's log naming `tests` failed in `unit`, as the test runner prints it. */
function logOf(unit: string, tests: readonly string[]): string {
  return [`2026-11-17T08:01:00Z === ${unit} ===`, ...tests.map((one) => `2026-11-17T08:02:00Z ✖ ${one} (12ms)`), `2026-11-17T08:03:00Z FAIL    ${unit}`].join("\n");
}

/** The library the harvest writes through, its writes kept: one story owning packages/shop, with contract 2.1 on capability_s. */
function libraryOf(increments: object[] = [], patterns: object[] = [], arcs: object[] = []) {
  const flakes: Record<string, unknown>[] = [];
  const written: { kind: string; fields: Record<string, any> }[] = [];
  const tree = { stories: [{ id: "story_aaaaaaaaaaaa", title: "Shop", capabilities: [{ id: "capability_s", title: "2 · Cart", contracts: [{ id: "contract_aaaaaaaaaaaa", title: "2.1 · Totals" }] }] }] };
  const library = {
    projectTree: async () => tree,
    investigateFlake: async (flake: Record<string, unknown>) => (flakes.push(flake), `increment_${String(flake.test).length.toString(16).padStart(12, "0")}`),
    writeKnowledge: async (kind: string, fields: Record<string, any>) => (written.push({ kind, fields }), { id: `escape_${written.length.toString().padStart(12, "0")}`, type: kind, fields }),
    list: async (kind: string) => (kind === "escape" ? patterns : kind === "increment" ? increments : kind === "arc" ? arcs : []),
  };
  return { library: library as unknown as Library, flakes, written };
}

/** A ledger kept in memory. */
function memoryLedger(): HarvestLedger & { rows: Map<number, string> } {
  const rows = new Map<number, string>();
  return { rows, harvested: async (ids) => new Set(ids.filter((id) => rows.has(id))), mark: async (marked) => { for (const { id, sorted } of marked) if (!rows.has(id)) rows.set(id, sorted); } };
}

/** GitHub's REST API over `routes`, each route's JSON or text; every route asked is kept. */
function gitHub(routes: Record<string, unknown>): GitHub & { asked: string[] } {
  const asked: string[] = [];
  const answer = (route: string) => {
    asked.push(route);
    if (!(route in routes)) throw new Error(`no route ${route}`);
    return routes[route];
  };
  return { asked, json: async (route) => answer(route), text: async (route) => String(answer(route)) };
}

/** Every package a change reaches, by the files it changes: packages/lib's change reaches packages/shop too. */
const scope = (files: readonly string[]) => {
  const dirs = new Set(files.map((file) => /^(packages\/[^/]+)\//.exec(file)?.[1]).filter((dir): dir is string => dir !== undefined));
  if (dirs.has("packages/lib")) dirs.add("packages/shop");
  return { full: false, dirs: [...dirs] };
};

test("1.1 · The harvest counts a failed run of a workflow that tests no code, or one only a timeout or cancel failed, as infra, skips own health's, and harvests a run only once", async (t) => {
  const url = process.env.STORYTREE_TEST_PG_URL;
  if (url === undefined) throw new Error("run the tests via `pnpm test`, which starts a local Postgres");
  const storytree = await connect({ url });
  const db = await harvestPool(storytree);
  const project = `t-${randomBytes(4).toString("hex")}`;
  t.after(async () => {
    try { await db.query("DELETE FROM ci_harvested WHERE project = $1", [project]); } finally { await storytree.close(); }
  });
  const runs = [
    failed(1, { workflow: "Release installed app", event: "push" }),
    failed(2, { workflow: "Own health", event: "schedule" }),
    failed(3, { conclusion: "timed_out" }),
    failed(4, { event: "merge_group", branch: "gh-readonly-queue/main/pr-40-0123abc" }),
    failed(5, { pr: 50 }),
    failed(6, { createdAt: "2026-11-01T08:00:00Z" }),
    failed(7),
  ];
  const jobs: Record<number, RunJob[]> = {
    4: [{ name: "verify on Linux", conclusion: "cancelled", steps: 5, log: "" }, { name: "verify on Windows", conclusion: "timed_out", steps: 5, log: "" }],
    5: [{ name: "verify on Linux", conclusion: "failure", steps: 5, log: "2026-11-17T08:00:00Z error TS2322: Type 'string' is not assignable" }],
  };
  // GitHub lists failed and timed-out runs apart, by the day they were made, a hundred to a page: run 3 in both, run 6
  // before the window, and the failed runs' ten full pages, the most the harvest reads, repeating run 1.
  const api = (one: FailedRun) => ({ id: one.id, run_attempt: 1, name: one.workflow, event: one.event, head_sha: one.head, head_branch: one.branch, conclusion: one.conclusion, created_at: one.createdAt, pull_requests: one.pr === undefined ? [] : [{ number: one.pr }] });
  const page = (some: FailedRun[]) => ({ workflow_runs: [...some, ...Array.from({ length: 100 - some.length }, () => runs[0]!)].map(api) });
  const listing = gitHub({
    [`${API}/actions/runs?status=failure&created=>=2026-11-10&per_page=100&page=1`]: page([...runs.filter(({ id }) => id !== 3), runs[2]!]),
    ...Object.fromEntries(Array.from({ length: 9 }, (_, at) => [`${API}/actions/runs?status=failure&created=>=2026-11-10&per_page=100&page=${at + 2}`, page([])])),
    [`${API}/actions/runs?status=timed_out&created=>=2026-11-10&per_page=100&page=1`]: { workflow_runs: [api(runs[2]!)] },
  });
  const read: number[] = [];
  const named: (number | undefined)[] = [];
  const source: HarvestSource = {
    failedRuns: gitHubSource(listing, REPO, await watcherReading(), scope).failedRuns,
    facts: async (run) => {
      read.push(run.id);
      if (run.id === 7) throw new Error("GitHub answered 502");
      named.push(run.pr);
      return { jobs: jobs[run.id]!, reach: new Set(), passedSameHead: false };
    },
  };
  const { library, flakes, written } = libraryOf();
  const ledger = harvestLedger(db, project, () => NOW);
  const watcher = await watcherReading();

  const first = await harvest({ library, source, ledger, watcher, now: NOW });
  assert.deepEqual({ runs: first.runs, infra: first.infra, ownHealth: first.ownHealth, noTest: first.noTest, already: first.already, unread: first.unread }, { runs: 6, infra: 3, ownHealth: 1, noTest: 1, already: 0, unread: 1 },
    "the release run, the timed-out run and the run whose jobs only timed out or were cancelled are infra; own health's is skipped; one before the window is not listed; one GitHub could not be read for is counted");
  assert.deepEqual(read, [4, 5, 7], "only a CI run's jobs are read");
  assert.ok(listing.asked.some((route) => route.endsWith("page=10")) && !listing.asked.some((route) => route.endsWith("page=11")), "ten pages of failed runs are read, and no more");
  assert.deepEqual(named, [40, 50], "a merge-queue run's pull request is the one its branch names, a pull request run's the one GitHub lists");
  assert.deepEqual(flakes, [], "nothing here is a flake");
  assert.deepEqual(written, [], "nor a real failure");
  const text = harvestText(first);
  assert.match(text, /^Harvested 6 failed runs \(0 already harvested before\):/);
  assert.match(text, /1 GitHub could not read/);
  assert.match(text, /infra: 3 \(a workflow that tests no code, or only a timeout or a cancel\); own health's, skipped: 1; red on no named test: 1/, "both counts are printed");
  const { rows } = await db.query<{ run_id: string; sorted: string }>("SELECT run_id, sorted FROM ci_harvested WHERE project = $1 ORDER BY run_id", [project]);
  assert.deepEqual(rows.map(({ run_id, sorted }) => [Number(run_id), sorted]), [[1, "infra"], [2, "own-health"], [3, "infra"], [4, "infra"], [5, "no-test"]]);

  read.length = 0;
  const again = await harvest({ library, source, ledger, watcher, now: NOW });
  assert.deepEqual({ already: again.already, infra: again.infra, ownHealth: again.ownHealth, noTest: again.noTest }, { already: 5, infra: 0, ownHealth: 0, noTest: 0 }, "a run harvested once is never sorted again");
  assert.deepEqual(read, [7], "nor read again, while one GitHub could not be read for is read again");
  assert.match(harvestText(again), /^Harvested 1 failed run \(5 already harvested before\):/);

  // The command: a folder with no GitHub origin has nothing to harvest; one with an origin needs the library's server.
  const harvestVerb = HARVEST_FAMILIES[0]!.verbs.find((one) => "name" in one.command && one.command.name === "ci")!;
  const words: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };
  const folder = mkdtempSync(path.join(tmpdir(), "ci-harvest-"));
  t.after(() => removeTemp(folder));
  execFileSync("git", ["init", "-q", folder]);
  const context = { library, project, session: "test", folder };
  assert.match((await harvestVerb.act({}, context, words)).text, /no GitHub origin, so storytree has no failed CI runs to harvest; nothing was sorted/);
  execFileSync("git", ["-C", folder, "remote", "add", "origin", "https://github.com/acme/shop.git"]);
  await assert.rejects(harvestVerb.act({}, context, words), /kept beside the library, and this door has no library server open/);
});

test("1.2 · The harvest sends each flaky failing test of a CI run to its one investigation, sorted by the watcher's own reading", async () => {
  const runs = [
    // PR #7 changes only packages/web, and its run failed a test in packages/shop: outside what it changes.
    failed(11, { pr: 7 }),
    // PR #8 changes packages/shop, and its head passed on a rerun.
    failed(12, { pr: 8 }),
    // PR #9's queue red merged at the head it was red at.
    failed(13, { pr: 9, event: "merge_group", branch: "gh-readonly-queue/main/pr-9-cafe" }),
    // PR #10 changes packages/shop and is still red, on a test that flaked in run 11 and one already under investigation.
    failed(14, { pr: 10 }),
  ];
  const queueCommit = runs[2]!.head;
  const job = (id: number, tests: string[]) => ({ [`${API}/actions/runs/${id}/attempts/1/jobs?per_page=100`]: { jobs: [{ id: id * 10, name: "verify on Linux", conclusion: "failure", steps: [{}, {}] }] }, [`${API}/actions/jobs/${id * 10}/logs`]: logOf("packages/shop", tests) });
  const none = { workflow_runs: [] };
  const github = gitHub({
    ...job(11, ["2.1 · totals add up"]), ...job(12, ["2.1 · totals add up", "a test with no number"]), ...job(13, ["2.1 · totals round"]),
    [`${API}/actions/runs?head_sha=${runs[0]!.head}&status=success&per_page=100&page=1`]: none,
    [`${API}/pulls/7`]: { merged: false, head: { sha: runs[0]!.head, ref: "web" } },
    [`${API}/pulls/7/files?per_page=100`]: [{ filename: "packages/web/src/page.ts" }],
    [`${API}/actions/runs?branch=web&event=pull_request&status=success&per_page=100&page=1`]: none,
    [`${API}/actions/runs?head_sha=${runs[1]!.head}&status=success&per_page=100&page=1`]: { workflow_runs: [{ id: 99, name: "CI", head_sha: runs[1]!.head, created_at: "2026-11-17T09:00:00Z" }] },
    [`${API}/pulls/8`]: { merged: true, head: { sha: runs[1]!.head, ref: "shop" } },
    [`${API}/pulls/8/files?per_page=100`]: [{ filename: "packages/shop/src/cart.ts" }],
    [`${API}/actions/runs?branch=shop&event=pull_request&status=success&per_page=100&page=1`]: none,
    [`${API}/actions/runs?head_sha=${queueCommit}&status=success&per_page=100&page=1`]: none,
    [`${API}/pulls/9`]: { merged: true, head: { sha: "f".repeat(40), ref: "nine" } },
    [`${API}/pulls/9/files?per_page=100`]: [{ filename: "packages/shop/src/cart.ts" }],
    [`${API}/commits/${queueCommit}`]: { parents: [{ sha: "b".repeat(40) }, { sha: "f".repeat(40) }] },
    [`${API}/compare/main...${"b".repeat(40)}`]: { status: "behind" },
    ...job(14, ["2.1 · totals add up", "2.2 · checkout"]),
    [`${API}/actions/runs?head_sha=${runs[3]!.head}&status=success&per_page=100&page=1`]: none,
    [`${API}/pulls/10`]: { merged: false, head: { sha: runs[3]!.head, ref: "ten" } },
    [`${API}/pulls/10/files?per_page=100`]: [{ filename: "packages/shop/src/cart.ts" }],
    [`${API}/actions/runs?branch=ten&event=pull_request&status=success&per_page=100&page=1`]: none,
  });
  const watcher = await watcherReading();
  const source = gitHubSource(github, REPO, watcher, scope);
  const investigation = { id: "arc_999999999999", fields: { title: 'The flaky test "2.2 · checkout" passes reliably' } };
  const closedOne = { id: "arc_888888888888", fields: { title: 'The flaky test "2.3 · fixed long ago" passes reliably' } };
  const { library, flakes, written } = libraryOf([
    { id: "increment_999999999999", fields: { arc: investigation.id, status: "active", title: "Find why it flakes" } },
    { id: "increment_888888888888", fields: { arc: closedOne.id, status: "closed", title: "Found it" } },
  ], [], [investigation, closedOne]);
  const counts = await harvest({ library, source: { failedRuns: async () => runs, facts: source.facts }, ledger: memoryLedger(), watcher, now: NOW });

  assert.deepEqual(flakes.map(({ test, story, contract, of, seen }) => ({ test, story, contract, of, seen })), [
    { test: "2.1 · totals add up", story: "story_aaaaaaaaaaaa", contract: "contract_aaaaaaaaaaaa", of: undefined, seen: "run 11" },
    { test: "2.1 · totals add up", story: "story_aaaaaaaaaaaa", contract: "contract_aaaaaaaaaaaa", of: undefined, seen: "run 12" },
    { test: "a test with no number", story: "story_aaaaaaaaaaaa", contract: undefined, of: undefined, seen: "run 12" },
    { test: "2.1 · totals round", story: "story_aaaaaaaaaaaa", contract: "contract_aaaaaaaaaaaa", of: undefined, seen: "run 13" },
    { test: "2.1 · totals add up", story: "story_aaaaaaaaaaaa", contract: "contract_aaaaaaaaaaaa", of: undefined, seen: "run 14" },
    { test: "2.2 · checkout", story: "story_aaaaaaaaaaaa", contract: undefined, of: undefined, seen: "run 14" },
  ], "each flaky test goes to its one investigation, under the story owning its unit, with the run as what names it");
  assert.match(String(flakes[4]!.evidence), /it flaked in run 11 too/, "a test that flaked in another run of the window is a flake here too");
  assert.match(String(flakes[5]!.evidence), /under investigation as a flaky test \(arc_999999999999\)/, "so is one whose investigation is open");
  assert.match(String(flakes[0]!.evidence), /run 11 \(PR #7\) at a{10}11 \(pull_request\): the harvest read it as a flake, since it failed outside what its pull request changes/);
  assert.match(String(flakes[1]!.evidence), /passed on a rerun, unchanged/);
  assert.match(String(flakes[3]!.evidence), /merge queue's red merged at the head it was red at/);
  assert.equal(flakes.every(({ by }) => by === "storytree harvest ci"), true);
  assert.deepEqual(written, [], "no flake is recorded as an escape pattern");
  assert.equal(counts.flakes, 6);
  assert.match(harvestText(counts), /flakes routed: 6 flaky tests to 4 investigations/);
});

test("1.2 · A failed CI run on no pull request is sorted by the watcher's reading of an empty reach, with no pull request read", async () => {
  const runs = [
    // A push to main: no pull request, and none looked for.
    failed(31, { event: "push", branch: "main" }),
    // A pull request run whose branch GitHub finds no pull request for.
    failed(32, { branch: "gone" }),
  ];
  const job = (id: number, test: string) => ({ [`${API}/actions/runs/${id}/attempts/1/jobs?per_page=100`]: { jobs: [{ id: id * 10, name: "verify on Linux", conclusion: "failure", steps: [{}] }] }, [`${API}/actions/jobs/${id * 10}/logs`]: logOf("packages/shop", [test]) });
  const none = { workflow_runs: [] };
  const github = gitHub({
    ...job(31, "2.1 · totals add up"), ...job(32, "2.4 · prices show"),
    [`${API}/actions/runs?head_sha=${runs[0]!.head}&status=success&per_page=100&page=1`]: none,
    [`${API}/actions/runs?head_sha=${runs[1]!.head}&status=success&per_page=100&page=1`]: none,
    [`${API}/pulls?head=acme:gone&state=all&per_page=1`]: [],
  });
  const watcher = await watcherReading();
  const source = gitHubSource(github, REPO, watcher, scope);
  const { library, flakes, written } = libraryOf();
  const ledger = memoryLedger();
  const counts = await harvest({ library, source: { failedRuns: async () => runs, facts: source.facts }, ledger, watcher, now: NOW });

  assert.deepEqual(github.asked.filter((route) => route.includes("/pulls")), [`${API}/pulls?head=acme:gone&state=all&per_page=1`],
    "only the pull request run's branch is looked up, and with none found no pull request is read");
  for (const run of runs) {
    const facts = await source.facts(run);
    assert.deepEqual({ pr: facts.pr, reach: [...facts.reach], queue: facts.queue, laterGreen: facts.laterGreen }, { pr: undefined, reach: [], queue: undefined, laterGreen: undefined }, `run ${run.id} reads no pull request`);
  }
  assert.equal(counts.unread, 0, "a run on no pull request is read, not counted as one GitHub could not read");
  assert.deepEqual(flakes.map(({ test, seen }) => ({ test, seen })), [{ test: "2.1 · totals add up", seen: "run 31" }, { test: "2.4 · prices show", seen: "run 32" }],
    "with nothing its pull request changes, every failing unit is outside it, so the watcher's reading sends each test to its investigation");
  assert.match(String(flakes[0]!.evidence), /^run 31 at a{10}31 \(push\): the harvest read it as a flake/, "its evidence names no pull request");
  assert.match(String(flakes[1]!.evidence), /^run 32 at a{10}32 \(pull_request\): /);
  assert.deepEqual(written, [], "nothing is recorded as an escape pattern");
  assert.deepEqual([...ledger.rows], [[31, "flake"], [32, "flake"]], "both runs are harvested, so neither is read again");
  assert.deepEqual({ flakes: counts.flakes, real: counts.real, waiting: counts.waiting, unsettled: counts.unsettled }, { flakes: 2, real: 0, waiting: 0, unsettled: 0 });
});

test("1.3 · The harvest records each real failure, and each increment fixing an escape, as one unjudged escape pattern", async () => {
  const runs = [
    // PR #20 changes packages/shop and packages/lib; red at its first head, green at the next, whose change to packages/lib
    // reaches packages/shop. Merged since, its run no longer names it: it is found by its branch.
    failed(21, { branch: "b20" }),
    // PR #22 changes packages/shop; red, then green at a head whose only change since is main's packages/lib, merged into
    // its branch and none of its own: a flake.
    failed(23, { pr: 22 }),
    // PR #24 is still red: nothing settles it, so it waits for the next harvest.
    failed(25, { pr: 24 }),
    // PR #26 is still red at the window's end: recorded unsettled.
    failed(27, { pr: 26, createdAt: "2026-11-11T06:00:00Z" }),
    // PR #28's queue red at its head e…, which merged only at a new head f… whose change reaches packages/shop.
    failed(29, { pr: 28, event: "merge_group", branch: "gh-readonly-queue/main/pr-28-b0b" }),
  ];
  const job = (id: number, test = "2.1 · totals add up") => ({ [`${API}/actions/runs/${id}/attempts/1/jobs?per_page=100`]: { jobs: [{ id: id * 10, name: "verify on Linux", conclusion: "failure", steps: [{}] }] }, [`${API}/actions/jobs/${id * 10}/logs`]: logOf("packages/shop", [test]) });
  const none = { workflow_runs: [] };
  const pull = (pr: number, head: string, later?: { sha: string; at: string }, files = ["packages/shop/src/cart.ts"]) => ({
    [`${API}/actions/runs?head_sha=${head}&status=success&per_page=100&page=1`]: none,
    [`${API}/pulls/${pr}`]: { merged: false, head: { sha: later?.sha ?? head, ref: `b${pr}` } },
    [`${API}/pulls/${pr}/files?per_page=100`]: files.map((filename) => ({ filename })),
    // Listed newest first: a later green at a head after the next, which the harvest must not take for the next.
    [`${API}/actions/runs?branch=b${pr}&event=pull_request&status=success&per_page=100&page=1`]: { workflow_runs: later === undefined ? [] : [
      { id: pr * 100 + 2, name: "CI", head_sha: "9".repeat(40), created_at: "2026-11-17T11:00:00Z" },
      { id: pr * 100, name: "CI", head_sha: head, created_at: "2026-11-17T07:00:00Z" },
      { id: pr * 100 + 1, name: "CI", head_sha: later.sha, created_at: later.at },
    ] },
  });
  const github = gitHub({
    ...job(21), ...job(23, "2.4 · prices show"), ...job(25), ...job(27),
    [`${API}/pulls?head=acme:b20&state=all&per_page=1`]: [{ number: 20 }],
    // PR #20's files fill thirty pages, the most the harvest reads: its first names both its files.
    ...pull(20, runs[0]!.head, { sha: "c".repeat(40), at: "2026-11-17T10:00:00Z" }, ["packages/shop/src/cart.ts", "packages/lib/src/round.ts", ...Array<string>(98).fill("packages/shop/src/cart.ts")]),
    ...Object.fromEntries(Array.from({ length: 29 }, (_, at) => [`${API}/pulls/20/files?per_page=100&page=${at + 2}`, Array(100).fill({ filename: "packages/shop/src/cart.ts" })])),
    [`${API}/compare/${runs[0]!.head}...${"c".repeat(40)}`]: { files: [{ filename: "packages/lib/src/round.ts" }] },
    ...pull(22, runs[1]!.head, { sha: "d".repeat(40), at: "2026-11-17T10:00:00Z" }),
    [`${API}/compare/${runs[1]!.head}...${"d".repeat(40)}`]: { files: [{ filename: "packages/lib/src/round.ts" }] },
    ...pull(24, runs[2]!.head), ...pull(26, runs[3]!.head),
    ...job(29, "2.5 · totals carry"),
    [`${API}/actions/runs?head_sha=${runs[4]!.head}&status=success&per_page=100&page=1`]: none,
    [`${API}/pulls/28`]: { merged: true, head: { sha: "f".repeat(40), ref: "b28" } },
    [`${API}/pulls/28/files?per_page=100`]: [{ filename: "packages/shop/src/carry.ts" }],
    [`${API}/commits/${runs[4]!.head}`]: { parents: [{ sha: "b".repeat(40) }, { sha: "e".repeat(40) }] },
    [`${API}/compare/main...${"b".repeat(40)}`]: { status: "behind" },
    [`${API}/compare/${"e".repeat(40)}...${"f".repeat(40)}`]: { files: [{ filename: "packages/shop/src/carry.ts" }] },
  });
  const watcher = await watcherReading();
  const source = gitHubSource(github, REPO, watcher, scope);
  const increments = [
    { id: "increment_eeeeeeeeeeee", fields: { title: "Fix the rounding that reached main", escape: { causedBy: "#940", commit: "abcdef1", story: "story_aaaaaaaaaaaa" } } },
    { id: "increment_ffffffffffff", fields: { title: "Nothing escaped here", escape: "none" } },
    { id: "increment_111111111111", fields: { title: "Not landed" } },
  ];
  const judged = { fields: { instance: { escape: "increment_222222222222" }, caughtAt: "escaped", generalises: "yes" } };
  const { library, flakes, written } = libraryOf([...increments, { id: "increment_222222222222", fields: { title: "Already recorded", escape: { causedBy: "#800", story: "story_aaaaaaaaaaaa" } } }], [judged]);
  const ledger = memoryLedger();
  const counts = await harvest({ library, source: { failedRuns: async () => runs, facts: source.facts }, ledger, watcher, now: NOW });

  assert.deepEqual(written.map(({ kind, fields }) => ({ kind, instance: fields.instance, caughtAt: fields.caughtAt, generalises: fields.generalises })), [
    { kind: "escape", instance: { run: 21, pr: 20, head: runs[0]!.head, test: "2.1 · totals add up", contract: "contract_aaaaaaaaaaaa", story: "story_aaaaaaaaaaaa", capability: "capability_s" }, caughtAt: "ci", generalises: undefined },
    { kind: "escape", instance: { run: 29, pr: 28, head: runs[4]!.head, test: "2.5 · totals carry", story: "story_aaaaaaaaaaaa" }, caughtAt: "ci", generalises: undefined },
    { kind: "escape", instance: { pr: 940, head: "abcdef1", story: "story_aaaaaaaaaaaa", escape: "increment_eeeeeeeeeeee" }, caughtAt: "escaped", generalises: undefined },
  ], "a real failure CI caught, with its instance; an increment that fixed an escape, caught-at escaped; one already recorded is not recorded again; none is judged by the harvest");
  assert.match(written[0]!.fields.reasoning, /failed at a{10}21 and passed only at c{12}, once the pull request changed code packages\/shop reaches/);
  assert.deepEqual(flakes.map(({ seen }) => seen), ["run 23"], "green later with no change of its pull request's own reaching its unit, it is a flake");
  assert.deepEqual([...ledger.rows], [[21, "real"], [23, "flake"], [27, "unsettled"], [29, "real"]], "a run nothing settles yet is not marked, so the next harvest reads it again; one at the window's end is marked unsettled");
  assert.deepEqual({ real: counts.real, escaped: counts.escaped, waiting: counts.waiting, unsettled: counts.unsettled, unjudged: counts.unjudged, generalise: counts.generalise },
    { real: 2, escaped: 1, waiting: 1, unsettled: 1, unjudged: 3, generalise: 1 });
  const text = harvestText(counts);
  assert.match(text, /real failures recorded: 2 caught by CI, 1 that reached main/);
  assert.match(text, /Escape patterns: 1 generalise; 3 wait for the agent's judgement/);

  const recorded = written.map(({ fields }) => ({ fields }));
  const again = await harvest({ library: libraryOf(increments, recorded).library, source: { failedRuns: async () => runs, facts: source.facts }, ledger, watcher, now: NOW });
  assert.deepEqual({ already: again.already, real: again.real, escaped: again.escaped, waiting: again.waiting }, { already: 4, real: 0, escaped: 0, waiting: 1 }, "harvested again, nothing is recorded twice");
  const lost = await harvest({ library: libraryOf(increments, recorded).library, source: { failedRuns: async () => runs, facts: source.facts }, ledger: memoryLedger(), watcher, now: NOW });
  assert.deepEqual({ already: lost.already, real: lost.real, escaped: lost.escaped }, { already: 0, real: 0, escaped: 0 }, "with the harvested runs lost, a real failure already recorded is still not recorded again");
});

test("1.4 · The harvest records each failing test of a red property-checks nightly run as a real failure, its head's green rerun notwithstanding, and a nightly run that only timed out or was cancelled as infra", async () => {
  const NIGHTLY = "Property checks nightly";
  const runs = [
    // A scheduled run on main that found counterexamples to two property checks; a run by hand at the same head, on
    // another fresh seed, passed.
    failed(41, { workflow: NIGHTLY, event: "schedule", branch: "main" }),
    // One that timed out, and one whose only red job was cancelled while another timed out.
    failed(42, { workflow: NIGHTLY, event: "schedule", branch: "main", conclusion: "timed_out" }),
    failed(43, { workflow: NIGHTLY, event: "schedule", branch: "main" }),
  ];
  const github = gitHub({
    [`${API}/actions/runs/41/attempts/1/jobs?per_page=100`]: { jobs: [{ id: 410, name: "property checks, nightly tier", conclusion: "failure", steps: [{}, {}] }] },
    [`${API}/actions/jobs/410/logs`]: logOf("packages/shop", ["2.1 · totals add up", "2.5 · totals carry"]),
    [`${API}/actions/runs?head_sha=${runs[0]!.head}&status=success&per_page=100&page=1`]: { workflow_runs: [
      { id: 44, name: NIGHTLY, head_sha: runs[0]!.head, created_at: "2026-11-17T09:00:00Z" },
    ] },
    [`${API}/actions/runs/43/attempts/1/jobs?per_page=100`]: { jobs: [
      { id: 430, name: "property checks, nightly tier", conclusion: "cancelled", steps: [{}] },
      { id: 431, name: "property checks, nightly tier", conclusion: "timed_out", steps: [{}] },
    ] },
    [`${API}/actions/jobs/431/logs`]: "",
    [`${API}/actions/runs?head_sha=${runs[2]!.head}&status=success&per_page=100&page=1`]: { workflow_runs: [] },
  });
  const watcher = await watcherReading();
  const source = gitHubSource(github, REPO, watcher, scope);
  const { library, flakes, written } = libraryOf();
  const ledger = memoryLedger();
  const counts = await harvest({ library, source: { failedRuns: async () => runs, facts: source.facts }, ledger, watcher, now: NOW });

  assert.deepEqual(written.map(({ kind, fields }) => ({ kind, instance: fields.instance, caughtAt: fields.caughtAt, generalises: fields.generalises })), [
    { kind: "escape", instance: { run: 41, head: runs[0]!.head, test: "2.1 · totals add up", contract: "contract_aaaaaaaaaaaa", story: "story_aaaaaaaaaaaa", capability: "capability_s" }, caughtAt: "ci", generalises: undefined },
    { kind: "escape", instance: { run: 41, head: runs[0]!.head, test: "2.5 · totals carry", story: "story_aaaaaaaaaaaa" }, caughtAt: "ci", generalises: undefined },
  ], "each failing test of the red nightly run is one unjudged escape pattern, on no pull request");
  for (const { fields } of written) {
    assert.match(fields.reasoning, /^Real, not a flake: .*fresh seed/, "its reasoning says a fresh seed found it");
    assert.match(fields.description, /on Property checks nightly \(schedule\)/);
  }
  assert.deepEqual(flakes, [], "no failing test of it is sent to a flake investigation, though its head passed on a rerun");
  assert.deepEqual([...ledger.rows], [[41, "real"], [42, "infra"], [43, "infra"]], "the red run is harvested real; the timed-out and cancelled ones infra");
  assert.deepEqual({ infra: counts.infra, real: counts.real, flakes: counts.flakes, noTest: counts.noTest, waiting: counts.waiting, unsettled: counts.unsettled },
    { infra: 2, real: 2, flakes: 0, noTest: 0, waiting: 0, unsettled: 0 });
  assert.match(harvestText(counts), /real failures recorded: 2 caught by CI, 0 that reached main/);
});
