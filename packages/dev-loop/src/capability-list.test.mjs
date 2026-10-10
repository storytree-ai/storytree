// A branch changes only the capabilities its increment lists (ADR-0949 D3): the rules live in
// packages/dev-loop/src/capability-list.mjs; `pnpm gate` runs them against the library as check:capability-list.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { connect } from "@storytree/library";
import { dropTestDatabases } from "@storytree/local-postgres/testing";
import pg from "pg";

import { branchTree, branchVerdict, capabilitiesOf, capabilityListFor, incrementOfBranch, staleProblems, unlistedCapabilities } from "./capability-list.mjs";
import { runGate } from "./gate.mjs";

/** A checkout holding the till's package: a declared source file, its test, and a file only the survey places. */
function checkout(t) {
  const root = mkdtempSync(path.join(tmpdir(), "capability-list-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const files = {
    "packages/till/src/drawer.ts": "// Capability 1 · The drawer. Holds the cash.\nexport const drawer = 1;\n",
    "packages/till/src/receipt.ts": "/**\n * Capability 2 · Receipts.\n */\nexport const receipt = 2;\n",
    "packages/till/src/receipt.test.ts": "import { test } from \"node:test\";\ntest(\"2.1 a receipt is printed\", () => {});\n",
    "packages/till/src/helper.ts": "export const helper = 3;\n",
    "README.md": "readme\n",
  };
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  return root;
}

const tree = { stories: [{ id: "story-till", title: "The till", capabilities: [{ id: "cap-drawer", title: "1 · The drawer" }, { id: "cap-receipts", title: "2 · Receipts" }] }] };
/** The code survey's inference: the helper is reached nearest by the drawer's tests. */
const survey = async () => ({ "story-till": { files: [{ path: "src/helper.ts", capability: "cap-drawer" }] } });

test("7.4 a branch that changes a capability its increment does not list fails, naming the capability and its files", async (t) => {
  const root = checkout(t);
  const changed = ["packages/till/src/receipt.ts", "packages/till/src/receipt.test.ts", "packages/till/src/helper.ts", "README.md"];
  const owners = await capabilitiesOf(root, changed, tree, { survey });
  assert.deepEqual(Object.fromEntries(owners), {
    "packages/till/src/receipt.ts": "cap-receipts",
    "packages/till/src/receipt.test.ts": "cap-receipts",
    "packages/till/src/helper.ts": "cap-drawer",
  });
  const unlisted = unlistedCapabilities(owners, ["cap-drawer"], tree);
  assert.deepEqual(unlisted, [{ capability: "cap-receipts", title: "The till 2 · Receipts", files: ["packages/till/src/receipt.ts", "packages/till/src/receipt.test.ts"] }]);
  assert.deepEqual(unlistedCapabilities(owners, ["cap-drawer", "cap-receipts"], tree), [], "a branch inside its list passes");
  assert.equal(unlistedCapabilities(owners, [], tree).length, 2, "an empty list holds every capability the branch changes");
});

test("7.4 a branch naming no increment leaves the check NOT RUN with its reason; the gate runs it on an increment's branch", async (t) => {
  assert.equal(incrementOfBranch("claude/increment-ca8ba53211b7-f8f424"), "increment_ca8ba53211b7");
  assert.equal(incrementOfBranch("claude/dazzling-jones-f96c61"), undefined);
  const root = mkdtempSync(path.join(tmpdir(), "capability-list-gate-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: root, stdio: "pipe" });
  git("init", "-q", "-b", "claude/dazzling-jones-f96c61");
  writeFileSync(path.join(root, "README.md"), "readme\n");
  git("add", "-A");
  git("commit", "-qm", "base");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  assert.deepEqual(capabilityListFor(root, { GITHUB_HEAD_REF: "claude/increment-ca8ba53211b7-f8f424" }), { run: true, reason: "claude/increment-ca8ba53211b7-f8f424 is increment_ca8ba53211b7's" }, "CI's pull request head names the branch");

  const gate = async () => {
    const calls = [];
    const output = [];
    const code = await runGate({ root, run: async (step) => { calls.push(step); return step === "check:capability-list" ? 1 : 0; }, log: (line) => output.push(line) });
    return { code, calls, table: output.at(-1) };
  };
  const unnamed = await gate();
  assert.equal(unnamed.code, 0);
  assert.ok(!unnamed.calls.includes("check:capability-list"));
  assert.match(unnamed.table, /NOT RUN\s+check:capability-list.*names no increment/);

  git("checkout", "-q", "-b", "claude/increment-ca8ba53211b7-f8f424");
  const named = await gate();
  assert.equal(named.code, 1);
  assert.equal(named.calls.at(-1), "check:capability-list");
  assert.match(named.table, /FAIL\s+check:capability-list/);
});

test("7.6 a branch's checks read the plan with its increment's pending changes laid over, and each pending change written against an older record is a problem naming both entries", async () => {
  const asked = [];
  const library = { projectTree: async (options) => (asked.push(options), tree) };
  assert.equal(await branchTree(library, "claude/increment-ca8ba53211b7-f8f424"), tree);
  await branchTree(library, "claude/dazzling-jones-f96c61");
  assert.deepEqual(asked, [{ pendingOf: "increment_ca8ba53211b7" }, { pendingOf: undefined }], "the branch's increment, or none");

  assert.deepEqual(staleProblems("increment_ca8ba53211b7", []), []);
  const [problem, ...rest] = staleProblems("increment_ca8ba53211b7", [
    { record: "contract_aaaaaaaaaaaa", type: "contract", base: 41, moved: { seq: 57, action: "updated", at: "2026-10-11T01:00:00.000Z", actor: "session:other" } },
  ]);
  assert.deepEqual(rest, []);
  assert.match(problem, /contract contract_aaaaaaaaaaaa/);
  assert.match(problem, /history entry 41.*entry 57 \(updated 2026-10-11T01:00:00\.000Z by session:other\)/);
});

/** Run `sql` on the test server as the client at `url`, in `database` when given. */
async function query(url, sql, database) {
  const at = new URL(url);
  if (database !== undefined) at.pathname = `/${database}`;
  const client = new pg.Client({ connectionString: at.href });
  await client.connect();
  try {
    return await client.query(sql);
  } finally {
    await client.end();
  }
}

test("7.7 CI's plan-read account, granted exactly infra/library-host/plan-read-grants.sql, reaches the check's verdict, stale pending changes included, as the owner does, and writes nothing", async (t) => {
  const url = process.env.STORYTREE_TEST_PG_URL;
  assert.ok(url, "STORYTREE_TEST_PG_URL is not set: run these tests through `pnpm test`, which starts a local Postgres");
  const admin = process.env.STORYTREE_TEST_PG_ADMIN_URL || url;
  const run = randomBytes(4).toString("hex");
  const [name, role, password] = [`t-${run}`, `ci_plan_read_${run}`, randomBytes(16).toString("hex")];
  const database = `storytree_${name}`;
  const root = checkout(t);
  const opened = [];
  try {
    const owner = await connect({ url });
    opened.push(owner);
    const library = await owner.openProject(name);
    opened.push(library);
    const story = await library.addStory({ title: "The till", description: "Taking payment." });
    const drawer = await library.addCapability({ title: "1 · The drawer", story: story.id });
    await library.addCapability({ title: "2 · Receipts", story: story.id });
    const arc = await library.createArc({ title: "Cash", intent: "Hold cash.", endState: "It is held." });
    const increment = await library.addIncrement({ arc: arc.id, title: "Rename the drawer", objective: "Rename it", body: "Rename.", capabilities: [drawer.id] });
    await library.advanceIncrement(increment.id, "active");
    await library.pendChange(increment.id, { record: drawer.id, fields: { title: "1 · The cash drawer" } });
    await library.editCapability(drawer.id, { description: "Changed since the pending change read it." });

    await query(admin, `CREATE ROLE ${role} LOGIN PASSWORD '${password}'`);
    const grants = readFileSync(new URL("../../../infra/library-host/plan-read-grants.sql", import.meta.url), "utf8")
      .replaceAll("storytree_storytree", database).replaceAll("ci_plan_read", role);
    await query(url, grants, database);

    const asCi = new URL(url);
    [asCi.username, asCi.password] = [role, password];
    const ci = await connect({ url: asCi.href });
    opened.push(ci);
    const onCi = await ci.openProject(name);
    opened.push(onCi);

    const branch = `claude/increment-${increment.id.slice("increment_".length)}-a1b2c3`;
    const changed = ["packages/till/src/drawer.ts", "packages/till/src/receipt.ts"];
    const verdict = await branchVerdict(library, root, branch, changed, { survey });
    assert.deepEqual(verdict.unlisted.map(({ files }) => files), [["packages/till/src/receipt.ts"]]);
    assert.equal(verdict.stale.length, 1, "the pending change was read before the drawer changed");
    assert.deepEqual(await branchVerdict(onCi, root, branch, changed, { survey }), verdict, "CI reads what the owner reads");

    await assert.rejects(onCi.addStory({ title: "Refunds", description: "Written by CI?" }), /permission denied|row-level security/);
  } finally {
    for (const each of opened.reverse()) await each.close().catch(() => {});
    await dropTestDatabases([database]);
    await query(admin, `DROP ROLE IF EXISTS ${role}`);
  }
});
