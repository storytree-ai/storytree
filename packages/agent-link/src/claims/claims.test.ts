/**
 * Capability 5 · Claims: one test per contract 5.1-5.6 in stories/agent-link.md, against the real
 * Postgres `pnpm test` provides. Each test plans a story with two capabilities in a fresh project's
 * library (named with uniqueProjectName(), dropped afterwards), and claims them through the agent
 * activity log, as sessions A (Claude Code) and B (Codex) would.
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";

import { connect, type Library } from "@storytree/library";

import { openActivityLog, type ActivityLog } from "../activity/index.js";
import { runHook } from "../hooks/index.js";
import { MARKER_FILE } from "../routing/index.js";
import { claudeCode, withAgent } from "../testing/agent.js";
import { withTempDir } from "../testing/folders.js";
import { dropTestProjects, testServerDataDir, testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { claim, land, readAttribution, readClaims, release, type ClaimContext, type MergedPull, type MergeWatch } from "./index.js";

interface World {
  log: ActivityLog;
  library: Library;
  project: string;
  /** The capability "Email form". */
  emailForm: string;
  /** The capability "Password reset". */
  passwordReset: string;
  /** Session A (Claude Code), or B (Codex), claiming in this project. */
  as(session: "A" | "B", options?: { quietMs?: number; log?: ActivityLog; branch?: string }): ClaimContext;
}

/** Run `body` with a fresh project planned with two capabilities, and the log open on the test server. */
async function withWorld(body: (world: World) => Promise<void>): Promise<void> {
  const project = uniqueProjectName();
  const storytree = await connect({ url: testServerUrl() });
  const log = await openActivityLog(testServerUrl());
  try {
    const library = await storytree.openProject(project);
    const story = await library.addStory({ title: "Visitor can sign up" });
    const emailForm = (await library.addCapability({ title: "Email form", story: story.id })).id;
    const passwordReset = (await library.addCapability({ title: "Password reset", story: story.id })).id;
    const harnessOf = { A: "claude-code", B: "codex" } as const;
    await body({
      log,
      library,
      project,
      emailForm,
      passwordReset,
      as: (session, options = {}) => ({
        log: options.log ?? log,
        library,
        project,
        session,
        harness: harnessOf[session],
        ...(options.quietMs === undefined ? {} : { quietMs: options.quietMs }),
        ...(options.branch === undefined ? {} : { branch: options.branch }),
      }),
    });
  } finally {
    try {
      await log.close();
      await storytree.close();
    } finally {
      await dropTestProjects([project]);
    }
  }
}

test('5.1 session A claims "email form", and the claim shows A and the reason', async () => {
  await withWorld(async ({ log, project, emailForm, as }) => {
    const answer = await claim(as("A"), emailForm, "building the email form");
    assert.equal(answer.ok, true);
    assert.deepEqual(
      (await readClaims(log, project)).map(({ capability, session, label, reason, holder }) => ({ capability, session, label, reason, holder })),
      [{ capability: emailForm, session: "A", label: "Claude Code", reason: "building the email form", holder: "live" }],
    );
  });
});

test("5.2 B's claim on it is refused, naming A; once A has been idle past the quiet time, B's claim succeeds", async () => {
  await withWorld(async ({ log, project, emailForm, as }) => {
    const quietMs = 1_000;
    assert.equal((await claim(as("A"), emailForm, "building the email form")).ok, true);

    const refused = await claim(as("B", { quietMs }), emailForm, "I want it too");
    assert.equal(refused.ok, false);
    assert.ok(!refused.ok && refused.refused === "held");
    assert.deepEqual({ session: refused.holder.session, label: refused.holder.label, reason: refused.holder.reason }, {
      session: "A",
      label: "Claude Code",
      reason: "building the email form",
    });

    await sleep(quietMs + 300); // A says nothing for longer than the quiet time
    const takenOver = await claim(as("B", { quietMs }), emailForm, "A went quiet; taking over");
    assert.ok(takenOver.ok);
    assert.equal(takenOver.takenOverFrom?.session, "A");
    assert.deepEqual(
      (await readClaims(log, project, { quietMs })).map(({ capability, session, reason }) => ({ capability, session, reason })),
      [{ capability: emailForm, session: "B", reason: "A went quiet; taking over" }],
      "B holds it now, and A does not",
    );
  });
});

test('5.3 when A reports it landed, the claim ends and a "landed" line is written; a release, or A\'s session ending, also ends it', async () => {
  await withWorld(async ({ log, project, emailForm, as }) => {
    assert.equal((await claim(as("A"), emailForm, "building the email form")).ok, true);
    const landed = await land(as("A"), emailForm);
    assert.ok(landed.ok);
    assert.deepEqual({ kind: landed.line.kind, session: landed.line.session }, { kind: "landed", session: "A" });
    assert.ok(landed.line.kind === "landed" && landed.line.capability === emailForm);
    assert.deepEqual(await readClaims(log, project), [], "landing ended the claim");

    assert.equal((await claim(as("A"), emailForm, "one more change")).ok, true);
    assert.deepEqual(await release(as("A"), emailForm), { ok: true });
    assert.deepEqual(await readClaims(log, project), [], "releasing ended it");

    assert.equal((await claim(as("A"), emailForm, "and another")).ok, true);
    await log.append(project, { session: "A", harness: "claude-code", source: "hook", kind: "session-ended", reason: "other" });
    assert.deepEqual(await readClaims(log, project), [], "A's session ending ended it");
  });
});

test("5.4 a claim on a capability the library doesn't have is refused, and when two agents claim at the same instant exactly one wins", async () => {
  await withWorld(async ({ log, project, library, as }) => {
    const missing = await claim(as("A"), "capability_000000000000", "no such thing");
    assert.deepEqual(missing, { ok: false, refused: "unknown-capability", capability: "capability_000000000000" });
    assert.deepEqual((await log.since(project, 0)).lines, [], "nothing written for it");

    // Each agent through its own connection, both claiming the same capability at once: every time,
    // one wins and the other is refused naming the winner.
    const other = await openActivityLog(testServerUrl());
    try {
      const [story] = (await library.projectTree()).stories;
      for (let round = 1; round <= 5; round++) {
        const contested = (await library.addCapability({ title: `Contested ${round}`, story: story!.id })).id;
        const [a, b] = await Promise.all([claim(as("A"), contested, "mine"), claim(as("B", { log: other }), contested, "no, mine")]);
        assert.equal([a, b].filter((answer) => answer.ok).length, 1, `round ${round}: exactly one wins`);
        const [winner, loser] = a.ok ? ["A", b] : ["B", a];
        assert.ok(!loser.ok && loser.refused === "held" && loser.holder.session === winner, `round ${round}: the other is refused naming ${winner}`);
        assert.deepEqual((await readClaims(log, project)).filter((held) => held.capability === contested).map((held) => held.session), [winner]);
      }
    } finally {
      await other.close();
    }
  });
});

test('5.5 an edit made while A holds "email form" counts toward it, and an edit from a session holding nothing counts as unplanned activity', async () => {
  await withWorld(async ({ log, project, emailForm, as }) => {
    const edit = (session: "A" | "B", file: string) =>
      log.append(project, { session, harness: session === "A" ? "claude-code" : "codex", source: "hook", kind: "file-edited", files: [file] });

    await edit("A", "notes.md"); // before any claim
    assert.equal((await claim(as("A"), emailForm, "building the email form")).ok, true);
    await edit("A", "src/signup.ts");
    await log.append(project, { session: "A", harness: "claude-code", source: "hook", kind: "command-run", command: "npm test" });
    await edit("B", "src/other.ts"); // B holds nothing
    assert.equal((await land(as("A"), emailForm)).ok, true);
    await edit("A", "README.md"); // after landing

    assert.deepEqual(
      (await readAttribution(log, project)).map(({ line, capability }) => [line.session, line.kind === "file-edited" ? line.files[0] : line.kind, capability]),
      [
        ["A", "notes.md", undefined],
        ["A", "src/signup.ts", emailForm],
        ["A", "command-run", emailForm],
        ["B", "src/other.ts", undefined],
        ["A", "README.md", undefined],
      ],
    );
  });
});

test("5.6 while a command A started is still running, past the quiet time, B's claim on A's capability is refused naming A", async () => {
  await withWorld(async ({ log, project, emailForm, as }) => {
    const quietMs = 1_000;
    assert.equal((await claim(as("A"), emailForm, "building the email form")).ok, true);
    await log.append(project, { session: "A", harness: "claude-code", source: "hook", kind: "command-started", command: "npm run build", call: "call-1" });

    await sleep(quietMs + 300); // the build runs on, longer than the quiet time, and A writes nothing
    const refused = await claim(as("B", { quietMs }), emailForm, "A went quiet; taking over");
    assert.ok(!refused.ok && refused.refused === "held" && refused.holder.session === "A" && refused.holder.holder === "live");
    assert.deepEqual((await readClaims(log, project, { quietMs })).map(({ session, holder }) => ({ session, holder })), [{ session: "A", holder: "live" }]);
  });
});

test("5.10 a claim taken on branch feature/signup ends with a merged line once GitHub shows a pull request from that branch merged after the claim was taken, found at the next tool call or hook line; one merged before the claim, or still open, ends nothing", async () => {
  await withWorld(async ({ log, project, emailForm, passwordReset, as }) => {
    await withTempDir(async (folder) => {
      writeFileSync(path.join(folder, MARKER_FILE), `${JSON.stringify({ project })}
`);
      // GitHub, as `gh` would answer: the merged pull requests from each branch.
      const pulls = new Map<string, MergedPull[]>();
      const merges: MergeWatch = { mergedPulls: async (_folder, branch) => pulls.get(branch) ?? [], everyMs: 0 };
      const held = async () => (await readClaims(log, project)).map(({ capability, session }) => [capability, session]);

      pulls.set("feature/signup", [{ number: 6, mergedAt: new Date(Date.now() - 3_600_000).toISOString() }]); // an earlier pull request from the same branch
      assert.equal((await claim(as("A", { branch: "feature/signup" }), emailForm, "building the email form")).ok, true);
      assert.equal((await claim(as("B", { branch: "feature/reset" }), passwordReset, "building the reset")).ok, true); // B's pull request is still open
      await sleep(20);

      await withAgent(folder, { ...claudeCode("C"), merges }, async (agent) => {
        await agent.call("show_plan");
        assert.deepEqual(await held(), [[emailForm, "A"], [passwordReset, "B"]], "a merge from before the claim, and an open pull request, end nothing");

        pulls.set("feature/signup", [...pulls.get("feature/signup")!, { number: 7, mergedAt: new Date().toISOString() }]);
        await agent.call("show_plan");
      });
      assert.deepEqual(await held(), [[passwordReset, "B"]], "the merge ended A's claim, at the next tool call");
      const merged = (await log.since(project, 0)).lines.filter((line) => line.kind === "merged");
      assert.deepEqual(
        merged.map((line) => line.kind === "merged" && { capability: line.capability, holder: line.holder, branch: line.branch, pr: line.pr, session: line.session }),
        [{ capability: emailForm, holder: "A", branch: "feature/signup", pr: 7, session: "C" }],
      );

      pulls.set("feature/reset", [{ number: 8, mergedAt: new Date().toISOString() }]);
      const edit = JSON.parse(readFileSync(new URL("../hooks/fixtures/claude-code/post-tool-use-write.json", import.meta.url), "utf8")) as Record<string, unknown>;
      await runHook({ argv: ["claude-code"], input: JSON.stringify({ ...edit, cwd: folder, session_id: "D" }), merges, locate: { dataDir: testServerDataDir() } });
      assert.deepEqual(await held(), [], "the merge ended B's claim, at the next hook line");
    });
  });
});
