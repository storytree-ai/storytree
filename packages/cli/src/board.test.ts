/**
 * Capability 7 · Board, read only: one test per contract 7.1-7.4 in the command line story, each running the
 * real, built `storytree` command. Claims are made the way the agent tool makes them, through the
 * Session management's own `claim`, into its activity log on the test Postgres.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { ACTIVITY_DATABASE, claim, openActivityLog, type ActivityLog } from "@storytree/session-management";
import pg from "pg";

import { BuiltCommand, inWorld, testServerUrl, type World } from "./testing/cli.js";

const command = new BuiltCommand();

before(() => command.build());
after(() => command.remove());

/** An increment to claim, and the activity log, for `body`; the log is closed afterwards. */
async function withClaimable(world: World, body: (increment: string, log: ActivityLog) => Promise<void>): Promise<void> {
  const library = await world.library();
  const arc = await library.createArc({ title: "Launch v1", intent: "Ship sign-up", endState: "Visitors sign up" });
  const increment = await library.addIncrement({ arc: arc.id, title: "Email form", objective: "Build it", body: "…" });
  const log = await openActivityLog(testServerUrl());
  try {
    await body(increment.id, log);
  } finally {
    await log.close();
  }
}

test("7.1 a claim made through the agent tool appears with its harness and reason", async () => {
  await inWorld(command, async (world) => {
    await withClaimable(world, async (increment, log) => {
      const claimed = await claim({ log, library: await world.library(), project: world.project, session: "claude-1", harness: "claude-code" }, increment, "building the email form");
      assert.equal(claimed.ok, true);

      const ran = await world.run(["noticeboard"]);

      assert.equal(ran.code, 0, ran.stderr);
      const line = ran.stdout.split(/\r?\n/).find((one) => one.includes(increment));
      assert.ok(line !== undefined, ran.stdout);
      assert.match(line, /Claude Code/);
      assert.match(line, /building the email form/);
      assert.match(line, /\blive\b/);
    });
  });
});

test("7.2 an idle claim reads idle", async () => {
  await inWorld(command, async (world) => {
    await withClaimable(world, async (increment, log) => {
      await claim({ log, library: await world.library(), project: world.project, session: "codex-1", harness: "codex" }, increment, "wiring the form");
      // Time passing: the session has said nothing for two hours, well past the quiet time.
      const url = new URL(testServerUrl());
      url.pathname = `/${ACTIVITY_DATABASE}`;
      const client = new pg.Client({ connectionString: url.href });
      await client.connect();
      try {
        await client.query("UPDATE activity SET at = at - interval '2 hours' WHERE project = $1", [world.project]);
      } finally {
        await client.end();
      }

      const ran = await world.run(["noticeboard"]);

      assert.equal(ran.code, 0, ran.stderr);
      const line = ran.stdout.split(/\r?\n/).find((one) => one.includes(increment));
      assert.ok(line !== undefined, ran.stdout);
      assert.match(line, /\bidle\b/);
    });
  });
});

test("7.4 `noticeboard log` keeps line identity and cause, with complete commands under --full and bounded session selection", async () => {
  await inWorld(command, async (world) => {
    await withClaimable(world, async (_increment, log) => {
      const hook = { session: "claude-1", harness: "claude-code", source: "hook" } as const;
      const request = await log.append(world.project, { ...hook, kind: "tool-requested", tool: "open", call: "toolu_1", agent: "orchestrator" });
      const caused = await log.append(world.project, { ...hook, source: "tool", kind: "tool-called", tool: "open", causedBy: request.seq });
      const unknown = await log.append(world.project, { ...hook, source: "tool", kind: "tool-called", tool: "search_notes" });

      const ran = await world.run(["noticeboard", "log"]);

      assert.equal(ran.code, 0, ran.stderr);
      const lineOf = (seq: number) => ran.stdout.split(/\r?\n/).find((one) => one.includes(`#${seq} `));
      assert.match(lineOf(caused.seq) ?? ran.stdout, new RegExp(`caused by #${request.seq}\\b`));
      assert.match(lineOf(unknown.seq) ?? ran.stdout, /cause not recorded/);

      const recorded = 'pnpm storytree arc increment edit increment_0d9b1b970765 --title "a long recorded command"\n# keep $literal and quotes';
      const started = await log.append(world.project, { ...hook, kind: "command-started", command: recorded, call: "command-1" });
      const completed = await log.append(world.project, { ...hook, kind: "command-run", command: recorded, call: "command-1", causedBy: started.seq });
      await log.append(world.project, { ...hook, session: "other-session", kind: "command-run", command: "other session's newest command" });

      const selected = ["noticeboard", "log", "--session", hook.session, "--limit", "2"];
      const full = await world.run([...selected, "--full"]);
      assert.equal(full.code, 0, full.stderr);
      assert.equal(full.stdout.trimEnd(), [
        `#${started.seq}  ${started.at}  Claude Code ${hook.session}  command-started ${recorded}  · cause not recorded`,
        `#${completed.seq}  ${completed.at}  Claude Code ${hook.session}  command-run ${recorded}  · caused by #${started.seq}`,
      ].join("\n"));

      const compact = await world.run(selected);
      assert.equal(compact.code, 0, compact.stderr);
      assert.equal(compact.stdout.trimEnd(), [
        `#${started.seq}  ${started.at}  Claude Code ${hook.session}  command-started ${recorded.slice(0, 57)}...  · cause not recorded`,
        `#${completed.seq}  ${completed.at}  Claude Code ${hook.session}  command-run ${recorded.slice(0, 57)}...  · caused by #${started.seq}`,
      ].join("\n"));

      const empty = await world.run(["noticeboard", "log", "--full", "--session", "missing-session"]);
      assert.equal(empty.code, 0, empty.stderr);
      assert.equal(empty.stdout.trim(), "The activity log has no lines for missing-session.");
    });
  });
});

test("7.3 `noticeboard <id>` names the holder, or \"nobody\"", async () => {
  await inWorld(command, async (world) => {
    await withClaimable(world, async (increment, log) => {
      const library = await world.library();
      const other = await library.addIncrement({ arc: (await library.projectTree()).arcs[0]!.id, title: "Welcome email", objective: "Send it", body: "…" });
      await claim({ log, library, project: world.project, session: "claude-1", harness: "claude-code" }, increment, "building the email form");

      const held = await world.run(["noticeboard", increment]);
      assert.equal(held.code, 0, held.stderr);
      assert.match(held.stdout, /Claude Code/);
      assert.match(held.stdout, /claude-1/);

      const free = await world.run(["noticeboard", other.id]);
      assert.equal(free.code, 0, free.stderr);
      assert.match(free.stdout, /\bnobody\b/);
    });
  });
});
