/**
 * Capability 11 · Workspace (the command line story): integration tests run the real,
 * built `storytree` command in a project folder that is a git clone with an origin beside it. The
 * agent's session reaches the command as its shell does, in CLAUDE_CODE_SESSION_ID or
 * CODEX_THREAD_ID.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { claim, openActivityLog, readClaims } from "@storytree/agent-link";

import { workspaceRefusalText } from "./families/workspace.js";
import { BuiltCommand, inWorld, storytree, testServerUrl, type World } from "./testing/cli.js";

const command = new BuiltCommand();
/** A folder holding a `gh` that is a copy of Node: `gh api …` runs the project folder's `api` script. */
let ghFolder: string;

before(async () => {
  await command.build();
  ghFolder = mkdtempSync(path.join(tmpdir(), "storytree-cli-gh-"));
  const gh = path.join(ghFolder, process.platform === "win32" ? "gh.exe" : "gh");
  if (process.platform === "win32") {
    try {
      linkSync(process.execPath, gh);
    } catch {
      copyFileSync(process.execPath, gh);
    }
  } else {
    symlinkSync(process.execPath, gh);
  }
});
after(() => {
  command.remove();
  rmSync(ghFolder, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

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

test("11.2 work another live session holds is refused naming its holder and why it binds, and no worktree is made", async () => {
  await inWorld(command, async (world) => {
    const increment = await withRepository(world);
    const log = await openActivityLog(testServerUrl());
    try {
      await claim({ log, library: await world.library(), project: world.project, session: "codex-1", harness: "codex" }, increment, "wiring the form");
      await log.append(world.project, { session: "codex-1", harness: "codex", source: "hook", kind: "command-started", call: "running", command: "pnpm test" });
    } finally {
      await log.close();
    }

    const ran = await world.run(["workspace", increment, "--reason", "me too"], { CLAUDE_CODE_SESSION_ID: "claude-9" });

    assert.equal(ran.code, 1);
    assert.match(ran.stderr, /codex-1/);
    assert.match(ran.stderr, /binds: a command is still recorded as running/);
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

test("11.8 work with an open pull request is refused naming it and --despite-open-pulls, with nothing made or claimed; with the flag, the workspace is made beside it", async () => {
  await inWorld(command, async (world) => {
    const increment = await withRepository(world);
    // gh's GraphQL answers that an open pull request is on a branch a workspace made for this increment.
    const pulls = [{ number: 41, headRefName: `claude/${increment.replace(/_/g, "-")}-a1b2c3`, isDraft: false, isInMergeQueue: false }];
    writeFileSync(path.join(world.folder, "api"), `process.stdout.write(${JSON.stringify(JSON.stringify({ data: { repository: { pullRequests: { nodes: pulls } } } }))});\n`);
    const env = { CLAUDE_CODE_SESSION_ID: "claude-9", PATH: [ghFolder, process.env.PATH ?? process.env.Path ?? ""].join(path.delimiter) };
    const log = await openActivityLog(testServerUrl());
    try {
      const refused = await world.run(["workspace", increment, "--reason", "build form"], env);
      assert.equal(refused.code, 1);
      assert.match(refused.stderr, /#41/);
      assert.match(refused.stderr, /--despite-open-pulls/);
      assert.deepEqual(await readClaims(log, world.project), []);
      assert.equal(git(world.folder, "worktree", "list").trim().split(/\r?\n/).length, 1);

      const made = await world.run(["workspace", increment, "--reason", "build form", "--despite-open-pulls"], env);
      assert.equal(made.code, 0, made.stderr);
      const [held] = await readClaims(log, world.project);
      assert.equal(held?.session, "claude-9");
      assert.equal(git(world.folder, "worktree", "list").trim().split(/\r?\n/).length, 2);
    } finally {
      await log.close();
    }
  });
});

test("11.8 the CLI offers --despite-open-pulls from the refusal's pull data regardless of its wording", () => {
  const increment = "increment_email";
  const why = "Finish pull request #41 on claude/email first";
  const refused = workspaceRefusalText(increment, {
    ok: false,
    refused: "no-workspace",
    why,
    openPulls: [{ number: 41, branch: "claude/email" }],
  });
  assert.ok(refused.includes(why), refused);
  assert.ok(refused.includes(`storytree workspace ${increment} --reason <text> --despite-open-pulls`), refused);
  assert.doesNotMatch(workspaceRefusalText(increment, {
    ok: false,
    refused: "no-workspace",
    why: "Cannot check whether this work already has open pull requests",
  }), /--despite-open-pulls/);
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
        if (id === capability.id) assert.deepEqual(await library.history({ id }), history, "releasing a capability changes no library record");
        const line = (await log.since(world.project, 0)).lines.at(-1);
        assert.equal(line?.kind, "released");
        if (line?.kind === "released") assert.deepEqual([line.increment ?? line.capability, line.session], [id, session]);
      }
      assert.equal((await library.arcView(arc.id))?.increments[0]?.fields.status, "proposal", "released, not closed (11.11)");
    } finally {
      await log.close();
    }
  });
});

test("11.11 `workspace release` of an increment's last claim returns the unclosed increment to proposal, keeping its parked date", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const arc = await library.createArc({ title: "Launch", intent: "Ship sign-up", endState: "Visitors sign up" });
    const increment = await library.addIncrement({ arc: arc.id, title: "Email form", objective: "Build it", body: "…" });
    const log = await openActivityLog(testServerUrl());
    try {
      assert.equal((await claim({ log, library, project: world.project, session: "claude-release", harness: "claude-code" }, increment.id, "building the form")).ok, true);
      const fieldsOf = async () => (await library.get(increment.id))?.fields as { status?: string; parked?: string } | undefined;
      assert.equal((await fieldsOf())?.status, "active", "claiming started it");
      const ran = await world.run(["workspace", "release", increment.id], { CLAUDE_CODE_SESSION_ID: "claude-release" });
      assert.equal(ran.code, 0, ran.stderr);
      assert.match(ran.stdout, /proposal/);
      assert.deepEqual(await fieldsOf(), { ...(await fieldsOf()), status: "proposal", parked: increment.fields.parked });
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

test("11.12 `workspace release --holder <session> --reason` is the session manager's release of a quiet session's claim; a live holder's claim is refused", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const arc = await library.createArc({ title: "Launch", intent: "Ship sign-up", endState: "Visitors sign up" });
    const increment = await library.addIncrement({ arc: arc.id, title: "Email form", objective: "Build it", body: "…" });
    const log = await openActivityLog(testServerUrl());
    try {
      assert.equal((await world.run(["settings", "set", "idle-after", "1s"])).code, 0);
      assert.equal((await claim({ log, library, project: world.project, session: "quiet", harness: "claude-code", quietMs: 1_000 }, increment.id, "building the form")).ok, true);
      const before = await log.since(world.project, 0);
      const live = await world.run(["workspace", "release", increment.id, "--holder", "quiet", "--reason", "quiet, messaged"], { CLAUDE_CODE_SESSION_ID: "manager" });
      assert.equal(live.code, 1);
      assert.match(live.stderr, /quiet.*live/);
      assert.deepEqual(await log.since(world.project, 0), before, "a refusal writes nothing");

      await new Promise((done) => setTimeout(done, 1_300)); // the holder says nothing for longer than idle-after
      const ran = await world.run(["workspace", "release", increment.id, "--holder", "quiet", "--reason", "quiet 24h after the manager's message"], { CLAUDE_CODE_SESSION_ID: "manager" });
      assert.equal(ran.code, 0, ran.stderr);
      assert.match(ran.stdout, /quiet/);
      assert.match(ran.stdout, /proposal/);
      assert.deepEqual(await readClaims(log, world.project), []);
      assert.equal(((await library.get(increment.id))?.fields as { status?: string } | undefined)?.status, "proposal");
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

test("11.10 work that waits for the owner or an outside event is refused naming what it waits for, its note and its check-back day", async () => {
  await inWorld(command, async (world) => {
    const library = await world.library();
    const arc = await library.createArc({ title: "Launch", intent: "Ship sign-up", endState: "Visitors sign up" });
    const increment = (await library.addIncrement({ arc: arc.id, title: "Ship to TestFlight", objective: "A build", body: "…" })).id;
    await library.addWaitFor(increment, { releaser: "owner", note: "Sign the Apple developer agreement" });
    await library.addWaitFor(increment, { releaser: "event", note: "Apple reviews build 12", checkBack: "2099-01-01" });

    const ran = await world.run(["workspace", "claim", increment, "--reason", "shipping it"], { CLAUDE_CODE_SESSION_ID: "claude-9" });

    assert.equal(ran.code, 1, ran.stdout);
    assert.ok(ran.stderr.includes(`${increment} waits for the owner: Sign the Apple developer agreement`), ran.stderr);
    assert.ok(ran.stderr.includes(`${increment} waits for an outside event: Apple reviews build 12 (check back 2099-01-01)`), ran.stderr);
  });
});

test("11.9 `workspace claim` claims the work for the calling agent session without making a worktree or branch, and is refused as the claim tool refuses it", async () => {
  await inWorld(command, async (world) => {
    const increment = await withRepository(world);
    const library = await world.library();
    const story = await library.addStory({ title: "Sign-up" });
    const capability = await library.addCapability({ story: story.id, title: "Email form" });
    const branches = git(world.folder, "branch", "--list");

    const claimed = await world.run(["workspace", "claim", capability.id, "--reason", "building the form"], { CLAUDE_CODE_SESSION_ID: "claude-9" });
    const started = await world.run(["workspace", "claim", increment, "--reason", "driving the form"], { CLAUDE_CODE_SESSION_ID: "claude-9" });

    assert.equal(claimed.code, 0, claimed.stderr);
    assert.equal(started.code, 0, started.stderr);
    assert.match(claimed.stdout, /claude-9 holds/);
    assert.equal(git(world.folder, "worktree", "list").trim().split(/\r?\n/).length, 1, "no worktree was made");
    assert.equal(git(world.folder, "branch", "--list"), branches, "no branch was made");
    const log = await openActivityLog(testServerUrl());
    try {
      const before = await log.since(world.project, 0);
      const held = await world.run(["workspace", "claim", capability.id, "--reason", "me too"], { CODEX_THREAD_ID: "other" });
      assert.equal(held.code, 1);
      assert.match(held.stderr, /held by .* claude-9/);
      assert.match(held.stderr, /binds: activity is within the claim quiet time/);
      const unknown = await world.run(["workspace", "claim", "capability_000000000000", "--reason", "x"], { CODEX_THREAD_ID: "other" });
      assert.equal(unknown.code, 1);
      assert.match(unknown.stderr, /no capability or increment/);
      const person = await world.run(["workspace", "claim", capability.id, "--reason", "x"]);
      assert.equal(person.code, 1);
      assert.match(person.stderr, /agent/);
      assert.deepEqual((await log.since(world.project, 0)).lines.filter((line) => line.kind === "claimed"), before.lines.filter((line) => line.kind === "claimed"), "refusals claim nothing");
      assert.deepEqual((await readClaims(log, world.project)).map(({ session }) => session), ["claude-9", "claude-9"]);
    } finally {
      await log.close();
    }
  });
});

test("11.13 from a linked worktree or a folder inside one, `workspace <increment>` is refused with the hint to claim it there, making no worktree or branch and claiming or starting nothing, from Claude Code's and Codex's shells; `workspace claim` then takes it in place", async () => {
  await inWorld(command, async (world) => {
    const increment = await withRepository(world);
    const named = path.join(path.dirname(world.folder), "named worktree");
    const detached = path.join(path.dirname(world.folder), "detached worktree");
    git(world.folder, "worktree", "add", "-b", "claude/older-work", named, "main");
    git(world.folder, "worktree", "add", "--detach", detached, "main");
    const nested = path.join(named, "deep", "folder");
    mkdirSync(nested, { recursive: true });
    const counts = () => [git(world.folder, "worktree", "list"), git(world.folder, "branch", "--list")];
    const before = counts();
    const statusOf = async () => ((await (await world.library()).get(increment))?.fields as { status?: string } | undefined)?.status;
    const log = await openActivityLog(testServerUrl());
    try {
      for (const cwd of [named, nested, detached]) {
        for (const env of [{ CLAUDE_CODE_SESSION_ID: "claude-in-worktree" }, { CODEX_THREAD_ID: "codex-in-worktree" }]) {
          const ran = await storytree(command.script, ["workspace", increment, "--reason", "build form"], { cwd, home: world.home, env });
          assert.equal(ran.code, 1, ran.stdout);
          assert.ok(ran.stderr.includes(`storytree workspace claim ${increment} --reason`), ran.stderr);
          assert.match(ran.stderr, cwd === detached ? /detached HEAD/ : /on branch claude\/older-work/);
        }
      }
      assert.deepEqual(counts(), before, "no worktree or branch was made");
      assert.deepEqual(await readClaims(log, world.project), []);
      assert.equal(await statusOf(), "proposal", "nothing was started");

      const claimed = await storytree(command.script, ["workspace", "claim", increment, "--reason", "build form"], { cwd: nested, home: world.home, env: { CLAUDE_CODE_SESSION_ID: "claude-in-worktree" } });
      assert.equal(claimed.code, 0, claimed.stderr);
      assert.deepEqual((await readClaims(log, world.project)).map(({ session, increment: held }) => ({ session, held })), [{ session: "claude-in-worktree", held: increment }]);
      assert.deepEqual(counts(), before, "claimed in place");
    } finally {
      await log.close();
    }
  });
});

test("11.14 `workspace claim` from the main checkout, then `workspace <increment>` by the same Claude Code session, makes the worktree and keeps the claim, moved onto the new branch with no release between", async () => {
  await inWorld(command, async (world) => {
    const increment = await withRepository(world);
    const claimed = await world.run(["workspace", "claim", increment, "--reason", "keeping it off the refill"], { CLAUDE_CODE_SESSION_ID: "claude-9" });
    assert.equal(claimed.code, 0, claimed.stderr);
    const log = await openActivityLog(testServerUrl());
    try {
      const lines = (await log.since(world.project, 0)).lines.length;

      const ran = await world.run(["workspace", increment, "--reason", "building the email form"], { CLAUDE_CODE_SESSION_ID: "claude-9" });

      assert.equal(ran.code, 0, ran.stderr);
      const [held, ...more] = await readClaims(log, world.project);
      assert.deepEqual(more, []);
      assert.equal(held?.session, "claude-9");
      assert.notEqual(held?.branch, "main");
      const workspace = path.join(world.folder, ".claude", "worktrees", path.basename(held!.branch!));
      assert.ok(ran.stdout.includes(workspace), ran.stdout);
      assert.equal(git(workspace, "rev-parse", "--abbrev-ref", "HEAD").trim(), held?.branch);
      assert.deepEqual((await log.since(world.project, 0)).lines.slice(lines).filter((line) => line.kind === "released"), [], "no moment releases it");
    } finally {
      await log.close();
    }
  });
});
