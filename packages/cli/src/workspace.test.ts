/**
 * Capability 11 · Workspace (the command line story): each test runs the real,
 * built `storytree` command in a project folder that is a git clone with an origin beside it. The
 * agent's session reaches the command as its shell does, in CLAUDE_CODE_SESSION_ID or
 * CODEX_THREAD_ID.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { after, before, test } from "node:test";

import { claim, openActivityLog, readClaims } from "@storytree/agent-link";

import { BuiltCommand, inWorld, testServerUrl, type World } from "./testing/cli.js";

const command = new BuiltCommand();

before(() => command.build());
after(() => command.remove());

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=storytree test", "-c", "user.email=test@storytree.invalid", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** Make the world's project folder a git repository with an origin beside it, and park an increment. */
async function withRepository(world: World): Promise<string> {
  const origin = path.join(path.dirname(world.folder), "origin.git");
  git(path.dirname(world.folder), "init", "--bare", "-b", "main", origin);
  git(world.folder, "init", "-b", "main");
  git(world.folder, "add", ".");
  git(world.folder, "commit", "-m", "first");
  git(world.folder, "remote", "add", "origin", origin);
  git(world.folder, "push", "origin", "main");
  const library = await world.library();
  const arc = await library.createArc({ title: "Launch v1", intent: "Ship sign-up", endState: "Visitors sign up" });
  return (await library.addIncrement({ arc: arc.id, title: "Email form", objective: "Build it", body: "…" })).id;
}

test("11.1 from an agent's shell, `workspace <increment> --reason` makes a worktree on a fresh branch from origin's main and claims the increment for that session on that branch, naming the folder to work in", async () => {
  await inWorld(command, async (world) => {
    const increment = await withRepository(world);

    const ran = await world.run(["workspace", increment, "--reason", "building the email form"], { CLAUDE_CODE_SESSION_ID: "claude-9" });

    assert.equal(ran.code, 0, ran.stderr);
    const log = await openActivityLog(testServerUrl());
    try {
      const [held, ...more] = await readClaims(log, world.project);
      assert.deepEqual(more, []);
      assert.equal(held?.increment, increment);
      assert.equal(held?.session, "claude-9");
      const workspace = path.join(world.folder, ".claude", "worktrees", path.basename(held!.branch!));
      assert.ok(ran.stdout.includes(workspace), ran.stdout);
      assert.equal(git(workspace, "rev-parse", "--abbrev-ref", "HEAD").trim(), held?.branch);
    } finally {
      await log.close();
    }
  });
});

test("11.2 work another live session holds is refused naming its holder, and no worktree is made", async () => {
  await inWorld(command, async (world) => {
    const increment = await withRepository(world);
    const log = await openActivityLog(testServerUrl());
    try {
      await claim({ log, library: await world.library(), project: world.project, session: "codex-1", harness: "codex" }, increment, "wiring the form");
    } finally {
      await log.close();
    }

    const ran = await world.run(["workspace", increment, "--reason", "me too"], { CLAUDE_CODE_SESSION_ID: "claude-9" });

    assert.equal(ran.code, 1);
    assert.match(ran.stderr, /codex-1/);
    assert.equal(git(world.folder, "worktree", "list").trim().split(/\r?\n/).length, 1);
  });
});

test("11.3 from a shell no agent session runs, it is refused saying to run it from the agent, and nothing is claimed", async () => {
  await inWorld(command, async (world) => {
    const increment = await withRepository(world);

    const ran = await world.run(["workspace", increment, "--reason", "building the email form"]);

    assert.equal(ran.code, 1);
    assert.match(ran.stderr, /agent/);
    const log = await openActivityLog(testServerUrl());
    try {
      assert.deepEqual(await readClaims(log, world.project), []);
    } finally {
      await log.close();
    }
  });
});


test("11.4 Codex prepares app creation then attaches its returned folder; an invalid directory and a person-only shell are refused", async () => {
  await inWorld(command, async (world) => {
    const increment = await withRepository(world);
    const env = { CODEX_THREAD_ID: "codex-app" };
    const prepared = await world.run(["workspace", increment, "--reason", "build form"], env);
    assert.equal(prepared.code, 0, prepared.stderr);
    assert.match(prepared.stdout, /create_worktree/);
    const args = prepared.stdout.match(/\{"ref":"[^"\n]+","name":"[^"\n]+"\}/)?.[0];
    assert.ok(args, prepared.stdout);
    const { ref, name } = JSON.parse(args) as { ref: string; name: string };
    assert.ok(prepared.stdout.includes(`git worktree add --detach <folder> ${ref}`), prepared.stdout);
    assert.doesNotMatch(prepared.stdout, /continue in the Codex desktop app/);
    const log = await openActivityLog(testServerUrl());
    try {
      assert.deepEqual(await readClaims(log, world.project), []);
      assert.equal(git(world.folder, "worktree", "list").trim().split(/\r?\n/).length, 1);
      const folder = path.join(path.dirname(world.folder), "app returned");
      git(world.folder, "worktree", "add", "--detach", folder, ref);
      const attach = ["workspace", "attach", increment, "--folder", folder, "--ref", ref, "--name", name, "--reason", "build form"];
      const person = await world.run(attach);
      assert.equal(person.code, 1);
      assert.match(person.stderr, /agent/);
      const bad = await world.run([...attach, "--folder", world.folder], env);
      assert.equal(bad.code, 1);
      assert.match(bad.stderr, /kept|untouched/);
      assert.deepEqual(await readClaims(log, world.project), []);
      const attached = await world.run(attach, env);
      assert.equal(attached.code, 0, attached.stderr);
      assert.ok(attached.stdout.includes(folder), attached.stdout);
      assert.equal(git(folder, "symbolic-ref", "--short", "HEAD").trim(), `codex/${name}`);
      const [held] = await readClaims(log, world.project);
      assert.equal(held?.session, "codex-app");
      assert.equal(held?.branch, `codex/${name}`);
    } finally {
      await log.close();
    }
  });
});

test("11.5 `workspace release` ends the calling session's increment or capability claim without closing or landing the work", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const arc = await library.createArc({ title: "Launch", intent: "Ship sign-up", endState: "Visitors sign up" });
    const increment = await library.addIncrement({ arc: arc.id, title: "Email form", objective: "Build it", body: "…" });
    const story = await library.addStory({ title: "Sign-up" });
    const capability = await library.addCapability({ story: story.id, title: "Email form" });
    const log = await openActivityLog(testServerUrl());
    try {
      for (const [id, env, session, harness] of [
        [increment.id, { CLAUDE_CODE_SESSION_ID: "claude-release" }, "claude-release", "claude-code"],
        [capability.id, { CODEX_THREAD_ID: "codex-release" }, "codex-release", "codex"],
      ] as const) {
        assert.equal((await claim({ log, library, project: world.project, session, harness }, id, "building the form")).ok, true);
        const history = await library.history({ id });
        const ran = await world.run(["workspace", "release", id], env);
        assert.equal(ran.code, 0, ran.stderr);
        assert.ok(ran.stdout.includes(id), ran.stdout);
        assert.deepEqual(await readClaims(log, world.project), []);
        assert.deepEqual(await library.history({ id }), history, "releasing changes no library record");
        const line = (await log.since(world.project, 0)).lines.at(-1);
        assert.equal(line?.kind, "released");
        if (line?.kind === "released") assert.deepEqual([line.increment ?? line.capability, line.session], [id, session]);
      }
      assert.equal((await library.arcView(arc.id))?.increments[0]?.fields.status, "active");
    } finally {
      await log.close();
    }
  });
});

test("11.6 `workspace release` refuses another session's claim, an unheld target, and a shell without an agent session", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const story = await library.addStory({ title: "Sign-up" });
    const capability = await library.addCapability({ story: story.id, title: "Email form" });
    const log = await openActivityLog(testServerUrl());
    try {
      assert.equal((await claim({ log, library, project: world.project, session: "holder", harness: "codex" }, capability.id, "building the form")).ok, true);
      const before = await log.since(world.project, 0);
      const other = await world.run(["workspace", "release", capability.id], { CLAUDE_CODE_SESSION_ID: "other" });
      assert.equal(other.code, 1);
      assert.match(other.stderr, /holder/);
      const unheld = await world.run(["workspace", "release", "capability_000000000000"], { CODEX_THREAD_ID: "holder" });
      assert.equal(unheld.code, 1);
      assert.match(unheld.stderr, /nobody/);
      const person = await world.run(["workspace", "release", capability.id]);
      assert.equal(person.code, 1);
      assert.match(person.stderr, /agent/);
      assert.deepEqual(await log.since(world.project, 0), before, "refusals append no claim events");
      assert.equal((await readClaims(log, world.project))[0]?.session, "holder");
    } finally {
      await log.close();
    }
  });
});

test("11.4 a Claude Code session attaches the linked worktree the app started it in, with no --ref or --name, and holds its work on that worktree's branch", async () => {
  await inWorld(command, async (world) => {
    const increment = await withRepository(world);
    const folder = path.join(path.dirname(world.folder), "claude app worktree");
    git(world.folder, "worktree", "add", "-b", "claude/app-made", folder, "main");

    const attached = await world.run(["workspace", "attach", increment, "--folder", folder, "--reason", "build form"], { CLAUDE_CODE_SESSION_ID: "claude-app" });

    assert.equal(attached.code, 0, attached.stderr);
    assert.ok(attached.stdout.includes(folder), attached.stdout);
    assert.equal(git(world.folder, "worktree", "list").trim().split(/\r?\n/).length, 2, "no second worktree");
    const log = await openActivityLog(testServerUrl());
    try {
      assert.deepEqual((await readClaims(log, world.project)).map(({ session, branch }) => ({ session, branch })), [{ session: "claude-app", branch: "claude/app-made" }]);
    } finally {
      await log.close();
    }
  });
});
