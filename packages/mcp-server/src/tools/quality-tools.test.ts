/**
 * Quality assurance's contracts 1.2, 2.3, 3.4, 4.4, 5.1 and 5.3, at this front door: the real shared server serves the checks and
 * ledger readings and the change-reviewer's loop through quality assurance's public API, the tools being the ones that package registers. Kept here, beside
 * the server, because quality assurance cannot depend back on the MCP server.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { connect } from "@storytree/library";
import { briefText, checks, checksText, ledgerText, openLedger, openReviews, qualityTools, standingText } from "@storytree/quality-assurance";

import { approveCheckout, dropTestProjects, testServerUrl, uniqueProjectName } from "@storytree/session-management/testing/pg";
import { createAgentTools } from "./index.js";

test("quality-assurance 1.2 · the shared server's quality_checks answers the package's checks reading, and the installed server serves it for storytree's own library", async () => {
  const project = uniqueProjectName();
  const storytree = await connect({ url: testServerUrl() });
  const library = await storytree.openProject(project);
  const folder = mkdtempSync(path.join(tmpdir(), "quality-tools-"));
  try {
    const principle = await library.writeKnowledge("principle", { title: "Test creation principles", description: "How a test earns its place.", statement: "A test fails if its behaviour is removed.", why: "A test that cannot fail protects nothing.", howToApply: "Delete the behaviour and watch the test fail." });
    await library.writeKnowledge("check", { title: "Tautological expected value", description: "Expected values computed as the code computes them.", question: "Is any expected value computed the way the code computes it?", enforces: [principle.id] });
    writeFileSync(path.join(folder, ".storytree.json"), JSON.stringify({ project }));
    await approveCheckout(folder, project);
    const tools = createAgentTools({ folder, dataDir: process.env.STORYTREE_TEST_PG_DATA!, env: {}, extensions: [qualityTools()], merges: { mergedPulls: async () => [] } });
    const client = new Client({ name: "claude-code", version: "test" });
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
    try {
      await tools.server.connect(serverSide);
      await client.connect(clientSide);
      const answer = await client.callTool({ name: "quality_checks", arguments: {} });
      const reading = await checks(library);
      assert.equal(reading.length, 1);
      assert.deepEqual(answer.structuredContent, { message: checksText(reading), checks: reading });
      assert.deepEqual(answer.content, [{ type: "text", text: checksText(reading) }]);
    } finally {
      await client.close();
      await tools.close();
    }

    for (const named of ["storytree", "another-project"]) {
      writeFileSync(path.join(folder, ".storytree.json"), JSON.stringify({ project: named }));
      const installed = createAgentTools({ folder, env: {} });
      const lister = new Client({ name: "claude-code", version: "test" });
      const [serverEnd, clientEnd] = InMemoryTransport.createLinkedPair();
      try {
        await installed.server.connect(serverEnd);
        await lister.connect(clientEnd);
        const names = (await lister.listTools()).tools.map((tool) => tool.name);
        assert.equal(names.includes("quality_checks"), named === "storytree", named);
      } finally {
        await lister.close();
        await installed.close();
      }
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
    await library.close();
    await storytree.close();
    await dropTestProjects([project]);
  }
});

test("quality-assurance 3.4 · the shared server's quality_ledger answers the package's ledger reading for the folder's project", async () => {
  const project = uniqueProjectName();
  const storytree = await connect({ url: testServerUrl() });
  const library = await storytree.openProject(project);
  const folder = mkdtempSync(path.join(tmpdir(), "quality-ledger-"));
  try {
    const ledger = await openLedger(storytree);
    await ledger.record({ project, review: "r1", packages: ["library"], ran: [{ check: "check_a", hits: [{ package: "library", file: "a.ts", line: 1 }] }] });
    const reading = await ledger.reading(project);
    assert.equal(reading.length, 1);
    writeFileSync(path.join(folder, ".storytree.json"), JSON.stringify({ project }));
    await approveCheckout(folder, project);
    const tools = createAgentTools({ folder, dataDir: process.env.STORYTREE_TEST_PG_DATA!, env: {}, extensions: [qualityTools()], merges: { mergedPulls: async () => [] } });
    const client = new Client({ name: "claude-code", version: "test" });
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
    try {
      await tools.server.connect(serverSide);
      await client.connect(clientSide);
      const answer = await client.callTool({ name: "quality_ledger", arguments: {} });
      assert.deepEqual(answer.structuredContent, { message: ledgerText(reading), ledger: reading });
    } finally {
      await client.close();
      await tools.close();
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
    await library.close();
    await storytree.close();
    await dropTestProjects([project]);
  }
});

/** A served client on `folder`'s project with this package's tools, handed to `use`. */
async function withClient(folder: string, use: (client: Client) => Promise<void>): Promise<void> {
  const tools = createAgentTools({ folder, dataDir: process.env.STORYTREE_TEST_PG_DATA!, env: {}, extensions: [qualityTools()], merges: { mergedPulls: async () => [] } });
  const client = new Client({ name: "claude-code", version: "test" });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  try {
    await tools.server.connect(serverSide);
    await client.connect(clientSide);
    await use(client);
  } finally {
    await client.close();
    await tools.close();
  }
}

/** The text a tool answered with. */
function textOf(answer: Awaited<ReturnType<Client["callTool"]>>): string {
  return (answer.content as { text: string }[])[0]!.text;
}

test("quality-assurance 2.3 and 4.4 · the shared server's quality_brief, quality_take, quality_answer and quality_standing run the package's review loop, the brief's diff given as text or read from a worktree", async () => {
  const project = uniqueProjectName();
  const storytree = await connect({ url: testServerUrl() });
  const library = await storytree.openProject(project);
  const folder = mkdtempSync(path.join(tmpdir(), "quality-review-"));
  const worktree = mkdtempSync(path.join(tmpdir(), "quality-branch-"));
  try {
    const story = await library.addStory({ title: "Visitor can sign up" });
    const capability = await library.addCapability({ title: "1 · Email form", story: story.id });
    const contract = await library.addContract({ capability: capability.id, title: "1.1 · A bad email is refused" });
    const arc = await library.createArc({ title: "Launch sign-up", intent: "Ship sign-up", endState: "Visitors sign up", stories: [story.id] });
    const increment = (await library.addIncrement({ arc: arc.id, title: "Email form", objective: "Build the email form", body: "The breakdown.", capabilities: [capability.id] })).id;
    const principle = await library.writeKnowledge("principle", { title: "Test creation principles", description: "How a test earns its place.", statement: "A test fails if its behaviour is removed.", why: "A test that cannot fail protects nothing.", howToApply: "Delete the behaviour and watch the test fail." });
    const check = await library.writeKnowledge("check", { title: "Tautological expected value", description: "Expected values computed as the code computes them.", question: "Is any expected value computed the way the code computes it?", enforces: [principle.id] });
    const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: worktree, encoding: "utf8" });
    git("init", "-q");
    writeFileSync(path.join(worktree, "README.md"), "base\n");
    git("add", "."), git("commit", "-qm", "base"), git("update-ref", "refs/remotes/origin/main", "HEAD");
    mkdirSync(path.join(worktree, "packages", "forms", "src"), { recursive: true });
    writeFileSync(path.join(worktree, "packages", "forms", "src", "email.test.ts"), "assert.equal(width(2), 2 * BASE);\n");
    git("add", "."), git("commit", "-qm", "change");
    const diff = git("diff", "origin/main...HEAD");
    writeFileSync(path.join(folder, ".storytree.json"), JSON.stringify({ project }));
    await approveCheckout(folder, project);
    const reviews = await openReviews(storytree);

    await withClient(folder, async (client) => {
      const fromWorktree = await client.callTool({ name: "quality_brief", arguments: { increment, worktree } });
      const fromText = await client.callTool({ name: "quality_brief", arguments: { increment, diff } });
      const brief = await reviews.brief(library, increment, diff);
      assert.equal(brief.iteration, 1);
      assert.match(brief.diff, /2 \* BASE/);
      assert.equal(textOf(fromWorktree), briefText(brief));
      assert.deepEqual(fromText.structuredContent, { message: briefText(brief), brief });
      assert.equal((await client.callTool({ name: "quality_brief", arguments: { increment } })).isError, true);

      const file = "packages/forms/src/email.test.ts";
      const taken = await client.callTool({ name: "quality_take", arguments: { increment, return: {
        checks: [{ check: check.id, tripped: true, hits: [{ file, line: 1, found: "2 * BASE is the code's own formula" }] }],
        contracts: [{ contract: contract.id, met: true }],
      } } });
      const [hit] = await reviews.standing(project, increment);
      assert.equal(hit!.file, file);
      assert.match(textOf(taken), new RegExp(`Recorded review ${increment}#1: 1 hit\\.\\n  hit ${hit!.id}  ${check.id}  ${file}:1`));
      assert.equal(textOf(await client.callTool({ name: "quality_standing", arguments: { increment } })), standingText([hit!]));

      assert.equal((await client.callTool({ name: "quality_answer", arguments: { hit: hit!.id, answer: "rejected" } })).isError, true);
      await client.callTool({ name: "quality_answer", arguments: { hit: hit!.id, answer: "rejected", reason: "BASE is a worked number" } });
      const [rejected] = (await openLedger(storytree).then((ledger) => ledger.rows(project))).hits;
      assert.deepEqual({ answer: rejected!.answer, reason: rejected!.reason }, { answer: "rejected", reason: "BASE is a worked number" });
      await client.callTool({ name: "quality_answer", arguments: { hit: hit!.id, answer: "fixed" } });
      const standing = await client.callTool({ name: "quality_standing", arguments: { increment } });
      assert.deepEqual(standing.structuredContent, { message: standingText([]), standing: [] });
    });
  } finally {
    rmSync(folder, { recursive: true, force: true });
    rmSync(worktree, { recursive: true, force: true });
    await library.close();
    await storytree.close();
    await dropTestProjects([project]);
  }
});

test("quality-assurance 5.1 and 5.3 · the shared server's graduate_check graduates a check, in part or whole, through the package, and quality_take given the worktree records what the graduated check finds there as its own", async () => {
  const project = uniqueProjectName();
  const storytree = await connect({ url: testServerUrl() });
  const library = await storytree.openProject(project);
  const folder = mkdtempSync(path.join(tmpdir(), "quality-graduate-"));
  const worktree = mkdtempSync(path.join(tmpdir(), "quality-graduated-branch-"));
  try {
    const story = await library.addStory({ title: "Visitor can sign up" });
    const capability = await library.addCapability({ title: "1 · Email form", story: story.id });
    const contract = await library.addContract({ capability: capability.id, title: "1.1 · A bad email is refused" });
    const arc = await library.createArc({ title: "Launch sign-up", intent: "Ship sign-up", endState: "Visitors sign up", stories: [story.id] });
    const increment = (await library.addIncrement({ arc: arc.id, title: "Email form", objective: "Build the email form", body: "The breakdown.", capabilities: [capability.id] })).id;
    const principle = await library.writeKnowledge("principle", { title: "Test creation principles", description: "How a test earns its place.", statement: "A test fails if its behaviour is removed.", why: "A test that cannot fail protects nothing.", howToApply: "Delete the behaviour and watch the test fail." });
    const check = await library.writeKnowledge("check", { title: "Tautological expected value", description: "Expected values computed as the code computes them.", question: "Is any expected value computed the way the code computes it?", enforces: [principle.id] });
    const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: worktree, encoding: "utf8" });
    git("init", "-q");
    writeFileSync(path.join(worktree, "README.md"), "base\n");
    git("add", "."), git("commit", "-qm", "base"), git("update-ref", "refs/remotes/origin/main", "HEAD");
    mkdirSync(path.join(worktree, "packages", "forms", "src"), { recursive: true });
    writeFileSync(path.join(worktree, "packages", "forms", "src", "email.test.ts"), "assert.equal(valid(x), valid(x));\n");
    git("add", "."), git("commit", "-qm", "change");
    writeFileSync(path.join(folder, ".storytree.json"), JSON.stringify({ project }));
    await approveCheckout(folder, project);

    await withClient(folder, async (client) => {
      assert.equal((await client.callTool({ name: "graduate_check", arguments: { check: check.id, part: "the same call twice", enforced_by: "no-such-check" } })).isError, true);
      const graduated = await client.callTool({ name: "graduate_check", arguments: { check: check.id, part: "the same call on both sides of an equality", enforced_by: "self-equal-assertion" } });
      const reading = await checks(library);
      assert.deepEqual(reading[0]!.graduated, [{ part: "the same call on both sides of an equality", enforcedBy: "self-equal-assertion" }]);
      assert.ok(textOf(graduated).includes(checksText(reading)), textOf(graduated));
      const whole = await library.writeKnowledge("check", { title: "Self-equal assertion", description: "An assertion that compares a value with itself.", question: "Does any assertion compare a value with itself?", enforces: [principle.id] });
      assert.notEqual((await client.callTool({ name: "graduate_check", arguments: { check: whole.id, part: "an assertion comparing a value with itself", enforced_by: "self-equal-assertion", whole: true } })).isError, true);
      assert.deepEqual((await checks(library)).find(({ id }) => id === whole.id)!.graduated, [{ part: "an assertion comparing a value with itself", enforcedBy: "self-equal-assertion", whole: true }]);

      await client.callTool({ name: "quality_brief", arguments: { increment, worktree } });
      await client.callTool({ name: "quality_take", arguments: { increment, worktree, return: { checks: [{ check: check.id, tripped: false }], contracts: [{ contract: contract.id, met: true }] } } });
      const { hits } = await (await openLedger(storytree)).rows(project);
      assert.deepEqual(hits.map(({ check: id, file, line, foundBy }) => ({ id, file, line, foundBy })).sort((a, b) => a.id.localeCompare(b.id)), [
        { id: check.id, file: "packages/forms/src/email.test.ts", line: 1, foundBy: "graduated" },
        { id: whole.id, file: "packages/forms/src/email.test.ts", line: 1, foundBy: "graduated" },
      ].sort((a, b) => a.id.localeCompare(b.id)));
    });
  } finally {
    rmSync(folder, { recursive: true, force: true });
    rmSync(worktree, { recursive: true, force: true });
    await library.close();
    await storytree.close();
    await dropTestProjects([project]);
  }
});
