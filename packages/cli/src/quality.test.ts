/**
 * Quality assurance's contracts 1.2 and 3.4, at this front door: the real, built `storytree quality checks`
 * and `storytree quality ledger` print the checks and ledger readings through quality assurance's public API,
 * the same readings its tools on the MCP server give. Its contracts 2.1, 2.2 and 4.1 at this front door: the
 * change-reviewer's loop, `quality brief`, `take`, `answer` and `standing`, run through the same API, and its 4.7: `standing` drops a contract the
 * increment no longer names; and its 5.1:
 * `quality graduate`. Its 2.8: `quality brief` run outside the increment's worktree reads the branch it was claimed on; its 2.16:
 * `quality brief` and `take` with --checkout review a change in a checkout outside the project, as the owner's factory repo is.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";

import { connect } from "@storytree/library";
import { PLUGIN_INTERFACE } from "@storytree/plugin-loader/factory";
import { checks, checksText, ledgerText, openLedger, openReviews } from "@storytree/quality-assurance";

import { BuiltCommand, inWorld, testServerUrl } from "./testing/cli.js";

const command = new BuiltCommand();

before(() => command.build());
after(() => command.remove());

test("quality-assurance 1.2 · `quality checks` prints the package's checks reading", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const principle = await library.writeKnowledge("principle", { title: "Test creation principles", description: "How a test earns its place.", statement: "A test fails if its behaviour is removed.", why: "A test that cannot fail protects nothing.", howToApply: "Delete the behaviour and watch the test fail." });
    await library.writeKnowledge("check", { title: "Tautological expected value", description: "Expected values computed as the code computes them.", question: "Is any expected value computed the way the code computes it?", enforces: [principle.id] });
    const reading = await checks(library);
    assert.equal(reading.length, 1);

    const ran = await world.run(["quality", "checks"]);
    assert.equal(ran.code, 0, ran.stderr);
    assert.ok(ran.stdout.startsWith(checksText(reading)), ran.stdout);
  });
});

test("quality-assurance 3.4 · `quality ledger` prints the package's ledger reading for the folder's project", async () => {
  await inWorld(command, async (world) => {
    const storytree = await connect({ url: testServerUrl() });
    try {
      const ledger = await openLedger(storytree);
      await ledger.record({ project: world.project, review: "r1", packages: ["library"], ran: [{ check: "check_a", hits: [{ package: "library", file: "a.ts", line: 1 }] }, { check: "check_b", hits: [] }] });
      const reading = await ledger.reading(world.project);
      assert.equal(reading.length, 2);

      const ran = await world.run(["quality", "ledger"]);
      assert.equal(ran.code, 0, ran.stderr);
      assert.ok(ran.stdout.startsWith(ledgerText(reading)), ran.stdout);
    } finally {
      await storytree.close();
    }
  });
});

test("quality-assurance 2.1, 2.2 and 4.1 · `quality brief`, `take`, `answer` and `standing` run one review of an increment's change through the package", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const story = await library.addStory({ title: "Visitor can sign up" });
    const capability = await library.addCapability({ title: "1 · Email form", story: story.id });
    const contract = await library.addContract({ capability: capability.id, title: "1.1 · A bad email is refused" });
    const arc = await library.createArc({ title: "Launch sign-up", intent: "Ship sign-up", endState: "Visitors sign up", stories: [story.id] });
    const increment = await library.addIncrement({ arc: arc.id, title: "Email form", objective: "Build the email form", body: "Red then green", capabilities: [capability.id] });
    const principle = await library.writeKnowledge("principle", { title: "Test creation principles", description: "How a test earns its place.", statement: "A test fails if its behaviour is removed.", why: "A test that cannot fail protects nothing.", howToApply: "Delete the behaviour and watch the test fail." });
    const check = await library.writeKnowledge("check", { title: "Tautological expected value", description: "Expected values computed as the code computes them.", question: "Is any expected value computed the way the code computes it?", enforces: [principle.id] });
    writeFileSync(path.join(world.folder, "change.diff"), "diff --git a/packages/forms/src/email.test.ts b/packages/forms/src/email.test.ts\n+  assert.equal(valid(x), valid(x));\n");

    const brief = await world.run(["quality", "brief", increment.id, "--diff", "@change.diff"]);
    assert.equal(brief.code, 0, brief.stderr);
    assert.match(brief.stdout, new RegExp(`Review 1 of change ${increment.id}`));
    assert.match(brief.stdout, new RegExp(`${check.id}[\\s\\S]*${contract.id}[\\s\\S]*valid\\(x\\), valid\\(x\\)`));

    writeFileSync(path.join(world.folder, "return.json"), JSON.stringify({ review: 1, checks: [{ check: check.id, tripped: true, hits: [{ file: "packages/forms/src/email.test.ts", line: 2, found: "compares the code with itself" }] }], contracts: [] }));
    const refused = await world.run(["quality", "take", increment.id, "--return", "@return.json"]);
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, new RegExp(contract.id));

    writeFileSync(path.join(world.folder, "return.json"), JSON.stringify({ review: 1, checks: [{ check: check.id, tripped: true, hits: [{ file: "packages/forms/src/email.test.ts", line: 2, found: "compares the code with itself" }] }], contracts: [{ contract: contract.id, met: true, touched: false }] }));
    const taken = await world.run(["quality", "take", increment.id, "--return", "@return.json"]);
    assert.equal(taken.code, 0, taken.stderr);
    assert.match(taken.stdout, /Architecture checks' graduated checks did not run, so nothing of theirs is recorded/);
    const storytree = await connect({ url: testServerUrl() });
    try {
      const [hit] = await (await openReviews(storytree)).standing(world.project, increment.id);
      assert.match(taken.stdout, new RegExp(`hit ${hit!.id} +${check.id} +packages/forms/src/email.test.ts:2`));

      const answered = await world.run(["quality", "answer", String(hit!.id), "fixed"]);
      assert.equal(answered.code, 0, answered.stderr);
      const standing = await world.run(["quality", "standing", increment.id]);
      assert.equal(standing.code, 0, standing.stderr);
      assert.ok(standing.stdout.startsWith("No finding stands: the change is ready for the gate."), standing.stdout);
    } finally {
      await storytree.close();
    }
  });
});

test("quality-assurance 4.7 · `quality standing` lists a contract found not met while the increment names it, and reads ready once the increment's list no longer does", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const story = await library.addStory({ title: "Visitor can sign up" });
    const capability = await library.addCapability({ title: "1 · Email form", story: story.id });
    const moved = await library.addCapability({ title: "2 · Welcome page", story: story.id });
    const contract = await library.addContract({ capability: capability.id, title: "1.1 · A bad email is refused" });
    const arc = await library.createArc({ title: "Launch sign-up", intent: "Ship sign-up", endState: "Visitors sign up", stories: [story.id] });
    const increment = await library.addIncrement({ arc: arc.id, title: "Email form", objective: "Build the email form", body: "Red then green", capabilities: [capability.id] });
    writeFileSync(path.join(world.folder, "change.diff"), "diff --git a/packages/forms/src/email.ts b/packages/forms/src/email.ts\n+export const valid = 1;\n");
    assert.equal((await world.run(["quality", "brief", increment.id, "--diff", "@change.diff"])).code, 0);
    writeFileSync(path.join(world.folder, "return.json"), JSON.stringify({ review: 1, checks: [], contracts: [{ contract: contract.id, met: false, why: "a bad email is kept" }] }));
    const taken = await world.run(["quality", "take", increment.id, "--return", "@return.json"]);
    assert.equal(taken.code, 0, taken.stderr);

    const unmet = await world.run(["quality", "standing", increment.id]);
    assert.equal(unmet.code, 0, unmet.stderr);
    assert.match(unmet.stdout, new RegExp(`contract ${contract.id} not met: a bad email is kept`));

    await library.editIncrement(increment.id, { capabilities: [moved.id] });
    const narrowed = await world.run(["quality", "standing", increment.id]);
    assert.equal(narrowed.code, 0, narrowed.stderr);
    assert.ok(narrowed.stdout.startsWith("No finding stands: the change is ready for the gate."), narrowed.stdout);
  });
});

test("quality-assurance 2.8 · `quality brief` run from another checkout reads the increment's change from the worktree on the branch it was claimed on, and is refused naming that branch while no worktree is on it", async () => {
  await inWorld(command, async (world) => {
    const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    git(world.folder, "init", "-q", "-b", "main");
    git(world.folder, "add", ".");
    git(world.folder, "commit", "-qm", "first");
    git(world.folder, "update-ref", "refs/remotes/origin/main", "HEAD");
    const library = await world.library();
    const story = await library.addStory({ title: "Visitor can sign up" });
    const capability = await library.addCapability({ title: "1 · Email form", story: story.id });
    const arc = await library.createArc({ title: "Launch sign-up", intent: "Ship sign-up", endState: "Visitors sign up", stories: [story.id] });
    const increment = await library.addIncrement({ arc: arc.id, title: "Email form", objective: "Build the email form", body: "Red then green", capabilities: [capability.id] });
    git(world.folder, "checkout", "-qb", "feature");
    const claimed = await world.run(["workspace", "claim", increment.id, "--reason", "building the form"], { CLAUDE_CODE_SESSION_ID: "claude-9" });
    assert.equal(claimed.code, 0, claimed.stderr);
    mkdirSync(path.join(world.folder, "packages/forms/src"), { recursive: true });
    writeFileSync(path.join(world.folder, "packages/forms/src/email.ts"), "export const valid = 1;\n");
    git(world.folder, "add", "packages");
    git(world.folder, "commit", "-qm", "the change");
    git(world.folder, "checkout", "-q", "main");
    mkdirSync(path.join(world.folder, "tmp"));
    writeFileSync(path.join(world.folder, "tmp/stray.txt"), "not the change\n");

    const refused = await world.run(["quality", "brief", increment.id]);
    assert.equal(refused.code, 1, refused.stdout);
    assert.match(refused.stderr, /branch feature/);

    git(world.folder, "worktree", "add", "-q", path.join(world.elsewhere, "wt"), "feature");
    const brief = await world.run(["quality", "brief", increment.id]);
    assert.equal(brief.code, 0, brief.stderr);
    assert.match(brief.stdout, /export const valid = 1;/);
    assert.doesNotMatch(brief.stdout, /stray|not the change/);
  });
});

test("quality-assurance 2.16 · `quality brief` and `take` with --checkout review the branch in a folder outside the project, a plugin's files in the plugin's package, and the project's ledger holds its finding", async () => {
  await inWorld(command, async (world) => {
    const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const library = await world.library();
    const story = await library.addStory({ title: "Talk by voice" });
    const capability = await library.addCapability({ title: "1 · Connector", story: story.id });
    const arc = await library.createArc({ title: "Voice moves out", intent: "Voice is a plugin", endState: "Voice runs from the factory", stories: [story.id] });
    const increment = await library.addIncrement({ arc: arc.id, title: "Move voice", objective: "Voice in the factory", body: "Red then green", capabilities: [capability.id] });
    const principle = await library.writeKnowledge("principle", { title: "Test creation principles", description: "How a test earns its place.", statement: "A test fails if its behaviour is removed.", why: "A test that cannot fail protects nothing.", howToApply: "Delete the behaviour and watch the test fail." });
    const check = await library.writeKnowledge("check", { title: "Tautological expected value", description: "Expected values computed as the code computes them.", question: "Is any expected value computed the way the code computes it?", enforces: [principle.id] });
    const graduated = await world.run(["quality", "graduate", check.id, "--part", "the same call on both sides of an equality", "--enforced-by", "self-equal-assertion"]);
    assert.equal(graduated.code, 0, graduated.stderr);
    // The factory: a git checkout with no .storytree.json, its branch adding a plugin's test on top of origin/main.
    const factory = path.join(world.elsewhere, "factory");
    mkdirSync(path.join(factory, "plugins/voice/src"), { recursive: true });
    writeFileSync(path.join(factory, "README.md"), "factory\n");
    git(factory, "init", "-q", "-b", "main");
    git(factory, "add", ".");
    git(factory, "commit", "-qm", "first");
    git(factory, "update-ref", "refs/remotes/origin/main", "HEAD");
    git(factory, "checkout", "-qb", "move-voice");
    writeFileSync(path.join(factory, "plugins/voice/src/door.test.ts"), "import assert from \"node:assert/strict\";\nassert.equal(door(1), door(1));\n");
    git(factory, "add", ".");
    git(factory, "commit", "-qm", "voice moves in");

    const brief = await world.run(["quality", "brief", increment.id, "--checkout", factory]);
    assert.equal(brief.code, 0, brief.stderr);
    assert.match(brief.stdout, /packages it touches: voice\./);
    assert.match(brief.stdout, /assert\.equal\(door\(1\), door\(1\)\)/);

    writeFileSync(path.join(world.folder, "return.json"), JSON.stringify({ review: 1, checks: [{ check: check.id, tripped: false, hits: [] }], contracts: [] }));
    const taken = await world.run(["quality", "take", increment.id, "--return", "@return.json", "--checkout", factory]);
    assert.equal(taken.code, 0, taken.stderr);
    const storytree = await connect({ url: testServerUrl() });
    try {
      const standing = await (await openReviews(storytree)).standing(world.project, increment.id);
      assert.deepEqual(standing.map(({ file, line, package: unit }) => ({ file, line, unit })), [{ file: "plugins/voice/src/door.test.ts", line: 2, unit: "voice" }], "the graduated check ran on the factory, and its hit stands in the project's ledger");
    } finally {
      await storytree.close();
    }
  });
});

test("quality-assurance 2.18 · `quality brief --checkout` on a factory checkout on the increment's branch briefs a plugin capability's contracts as the plugin's plan there numbers them", async () => {
  await inWorld(command, async (world) => {
    const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const library = await world.library();
    const factory = path.join(world.elsewhere, "factory");
    const plan = (contracts: { title: string }[]) => ({ story: { title: "Talk by voice" }, capabilities: [{ title: "1 · Connector", proposed: false, contracts }] });
    mkdirSync(path.join(factory, "plugins/voice"), { recursive: true });
    writeFileSync(path.join(factory, "plugins/voice/package.json"), JSON.stringify({ name: "voice", storytree: { interface: PLUGIN_INTERFACE, plan: "./plan.json" } }));
    writeFileSync(path.join(factory, "plugins/voice/plan.json"), JSON.stringify(plan([{ title: "1.1 · A wrong secret is answered 404" }])));
    git(factory, "init", "-q", "-b", "main");
    git(factory, "add", ".");
    git(factory, "commit", "-qm", "first");
    git(factory, "update-ref", "refs/remotes/origin/main", "HEAD");
    const imported = await library.importPluginPlan("voice", plan([{ title: "1.1 · A wrong secret is answered 404" }]));
    const capability = (await library.list("capability")).find(({ fields }) => fields.story === imported.story)!;
    const arc = await library.createArc({ title: "Voice grows", intent: "Voice does more", endState: "Voice does more", stories: [imported.story] });
    const increment = await library.addIncrement({ arc: arc.id, title: "Voice grows", objective: "Voice does more", body: "Red then green", capabilities: [capability.id] });
    git(factory, "checkout", "-qb", `claude/increment-${increment.id.slice("increment_".length)}`);
    writeFileSync(path.join(factory, "plugins/voice/plan.json"), JSON.stringify(plan([{ title: "1.1 · A wrong secret is answered 404" }, { title: "1.2 · A slow caller is timed out" }])));
    git(factory, "commit", "-qam", "voice grows");

    const brief = await world.run(["quality", "brief", increment.id, "--checkout", factory]);
    assert.equal(brief.code, 0, brief.stderr);
    assert.match(brief.stdout, /voice:1\.2  1\.2 · A slow caller is timed out/);
    assert.doesNotMatch(brief.stdout, /was not read/);
  });
});

test("quality-assurance 5.1 · `quality graduate` writes the part and the check in Architecture checks that enforces it on the check, marked whole with --whole, and the checks reading shows both; an unknown check in Architecture checks is refused, writing nothing", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const principle = await library.writeKnowledge("principle", { title: "Test creation principles", description: "How a test earns its place.", statement: "A test fails if its behaviour is removed.", why: "A test that cannot fail protects nothing.", howToApply: "Delete the behaviour and watch the test fail." });
    const check = await library.writeKnowledge("check", { title: "Tautological expected value", description: "Expected values computed as the code computes them.", question: "Is any expected value computed the way the code computes it?", enforces: [principle.id] });

    const refused = await world.run(["quality", "graduate", check.id, "--part", "the same call twice", "--enforced-by", "no-such-check"]);
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /no-such-check/);
    assert.equal((await checks(library))[0]!.graduated, undefined);

    const ran = await world.run(["quality", "graduate", check.id, "--part", "the same call on both sides of an equality", "--enforced-by", "self-equal-assertion"]);
    assert.equal(ran.code, 0, ran.stderr);
    const [read] = await checks(library);
    assert.deepEqual(read!.graduated, [{ part: "the same call on both sides of an equality", enforcedBy: "self-equal-assertion" }]);
    assert.ok(ran.stdout.includes(checksText([read!])), ran.stdout);

    const whole = await library.writeKnowledge("check", { title: "Self-equal assertion", description: "An assertion that compares a value with itself.", question: "Does any assertion compare a value with itself?", enforces: [principle.id] });
    const all = await world.run(["quality", "graduate", whole.id, "--part", "an assertion comparing a value with itself", "--enforced-by", "self-equal-assertion", "--whole"]);
    assert.equal(all.code, 0, all.stderr);
    assert.deepEqual((await checks(library)).find(({ id }) => id === whole.id)!.graduated, [{ part: "an assertion comparing a value with itself", enforcedBy: "self-equal-assertion", whole: true }]);
  });
});
