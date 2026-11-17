/**
 * Capability 20 · Lane measures: contracts 20.1 and 20.2, against the real library and agent activity log on the
 * Postgres `pnpm test` provides, in a fresh project dropped afterwards.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { connect, type Library } from "@storytree/library";
import { removeTemp } from "@storytree/test-waits";
import { dropTestProjects, testServerUrl, uniqueProjectName } from "@storytree/project-and-caller/testing/pg";

import { openActivityLog, type ActivityLog } from "../activity/index.js";
import { laneRows, type LaneRow } from "./lanes.js";
import { groupMeasures, measuresText, spreadOf } from "./summary.js";
import { MEASURES_FAMILIES } from "./verbs.js";

/** A Claude Code assistant line: one request's usage, on `model`, under its `requestId`. */
function claudeLine(requestId: string, model: string, usage: { input: number; read?: number; created?: number; hour?: number; output: number }, sidechain = false): string {
  return JSON.stringify({
    type: "assistant", requestId, isSidechain: sidechain,
    message: {
      model, role: "assistant",
      usage: {
        input_tokens: usage.input, cache_read_input_tokens: usage.read ?? 0, cache_creation_input_tokens: usage.created ?? 0, output_tokens: usage.output,
        ...(usage.hour === undefined ? {} : { cache_creation: { ephemeral_5m_input_tokens: (usage.created ?? 0) - usage.hour, ephemeral_1h_input_tokens: usage.hour } }),
      },
    },
  });
}

const records = (lines: string[], part = "") => lines.map((record, index) => ({ part, start: index * 1_000, finish: index * 1_000 + 999, record }));

interface World {
  log: ActivityLog;
  library: Library;
  project: string;
  /** Stories "Sign up" and "Mail", and their capabilities "Email form" and "Sender". */
  signUp: string;
  mail: string;
  emailForm: string;
  sender: string;
  /** Increments, by name: each closed as the test below says. */
  inc: Record<"built" | "abandoned" | "old" | "sharedA" | "sharedB" | "unpriced", string>;
}

async function withWorld(body: (world: World) => Promise<void>): Promise<void> {
  const project = uniqueProjectName();
  const storytree = await connect({ url: testServerUrl() });
  const log = await openActivityLog(testServerUrl());
  try {
    const library = await storytree.openProject(project);
    const signUp = (await library.addStory({ title: "Sign up" })).id;
    const mail = (await library.addStory({ title: "Mail" })).id;
    const emailForm = (await library.addCapability({ title: "Email form", story: signUp })).id;
    const sender = (await library.addCapability({ title: "Sender", story: mail })).id;
    const arc = await library.createArc({ title: "Sign-up", intent: "Ship sign-up", endState: "Visitors sign up" });
    const add = async (title: string, capabilities: string[] = []) => (await library.addIncrement({ arc: arc.id, title, objective: title, body: title, capabilities })).id;
    const inc = {
      built: await add("Built", [emailForm]), abandoned: await add("Abandoned"), old: await add("Old"),
      sharedA: await add("Shared A"), sharedB: await add("Shared B"), unpriced: await add("Unpriced"),
    };
    await library.closeIncrement(inc.built, { pr: "#5", disposition: "landed", date: "2026-11-10" });
    await library.closeIncrement(inc.abandoned, { disposition: "withdrawn", note: "overtaken", date: "2026-11-11" });
    await library.closeIncrement(inc.old, { pr: "#2", disposition: "landed", date: "2026-10-01" });
    await library.closeIncrement(inc.sharedA, { disposition: "failed", note: "no", date: "2026-11-12" });
    await library.closeIncrement(inc.sharedB, { disposition: "landed", pr: "#9", date: "2026-11-30" });
    await library.closeIncrement(inc.unpriced, { disposition: "landed", pr: "#6", date: "2026-11-12" });
    await body({ log, library, project, signUp, mail, emailForm, sender, inc });
  } finally {
    try {
      await log.close();
      await storytree.close();
    } finally {
      await dropTestProjects([project]);
    }
  }
}

test("20.1 a closed increment's lane is joined to its sessions' spend and list-price dollars, review rounds, pass measures and the stories it touched; what is not found is unattributed, never zero", async () => {
  await withWorld(async ({ log, library, project, signUp, mail, emailForm, sender, inc }) => {
    const hook = { source: "hook", folder: "/work", harness: "claude-code" } as const;
    // The lane L claimed "Built"; its fix session F a capability under it; the watcher held it for its pull request.
    await log.append(project, { ...hook, session: "L", kind: "claimed", increment: inc.built, reason: "build it" });
    await log.append(project, { ...hook, session: "F", kind: "claimed", capability: emailForm, under: inc.built, reason: "fix the red" });
    await log.append(project, { session: "pull-request-5", harness: "watcher", source: "tool", kind: "claimed", increment: inc.built, reason: "held for PR #5" });
    await log.append(project, { session: "pull-request-5", harness: "watcher", source: "tool", kind: "pr-red", pr: 5, increment: inc.built, conflict: false, checks: ["test"] });
    await log.append(project, { session: "watcher", harness: "watcher", source: "tool", kind: "queue-red", pr: 5, increment: inc.built, removedAt: "2026-11-10T01:00:00Z", commit: "abc", checks: ["test"], tests: [], outcome: "flake" });
    // Y claimed "Abandoned" but none of its transcript reached the log; Z drove two increments from one transcript.
    await log.append(project, { ...hook, session: "Y", kind: "claimed", increment: inc.abandoned, reason: "try it" });
    await log.append(project, { ...hook, session: "Z", kind: "claimed", increment: inc.sharedA, reason: "both" });
    await log.append(project, { ...hook, session: "Z", kind: "claimed", increment: inc.sharedB, reason: "both" });
    await log.append(project, { ...hook, session: "M", kind: "claimed", increment: inc.unpriced, reason: "a new model" });

    await log.transcripts.store(project, "L", records([
      // One request written across two lines counts once.
      claudeLine("req_1", "claude-opus-5-5", { input: 100, read: 1_000, output: 40 }),
      claudeLine("req_1", "claude-opus-5-5", { input: 100, read: 1_000, output: 40 }),
      claudeLine("req_2", "claude-opus-5-5", { input: 10, read: 2_000, created: 500, hour: 500, output: 60 }),
    ]));
    await log.transcripts.store(project, "L", records([claudeLine("req_a", "claude-haiku-4-5", { input: 2, read: 3_000, output: 8 }, true)], "a1"));
    await log.transcripts.store(project, "F", records([claudeLine("req_f", "claude-opus-5-5", { input: 1_000, output: 100 })]));
    await log.transcripts.store(project, "Z", records([claudeLine("req_z", "claude-opus-5-5", { input: 5, output: 5 })]));
    await log.transcripts.store(project, "M", records([claudeLine("req_m", "claude-unreleased-9", { input: 7, output: 3 })]));

    const window = { from: "2026-11-01", to: "2026-11-15" };
    const rows = await laneRows({ log, library, project }, window, {
      prFiles: async (pr) => (pr === 5 ? ["packages/mail/src/send.ts"] : undefined),
      placeFiles: async (paths) => paths.map((file) => ({ file, path: file, story: { id: mail, title: "Mail" }, package: "packages/mail", capability: sender })),
      reviewRounds: async () => new Map([[inc.built, 2]]),
    });
    const by = new Map(rows.map((row) => [row.increment, row]));
    assert.deepEqual([...by.keys()].sort(), [inc.built, inc.abandoned, inc.sharedA, inc.unpriced].sort(), "only the increments closed in the window");

    const built = by.get(inc.built)!;
    assert.deepEqual(built.sessions, ["F", "L"], "the lane and its fix session; the watcher's hold is no agent's");
    assert.equal(built.tokens, 1_140 + 2_570 + 3_010 + 1_100, "each session's own requests once each, and its subagent's");
    // Opus: input 1,110 at $4, cache reads 3,000 at $0.20, an hour's cache write of 500 at $8, output 200 at $20; Haiku: 2 at $1, 3,000 at $0.10, 8 at $5.
    assert.ok(Math.abs(built.dollars! - (13_040 + 342) / 1_000_000) < 1e-12, `list-price dollars, got ${built.dollars}`);
    assert.equal(built.rounds, 2);
    assert.equal(built.fixSessions, 1);
    assert.equal(built.queueReds, 1);
    assert.equal(built.disposition, "landed");
    assert.equal(built.pr, 5);
    assert.deepEqual(built.stories.map((one) => [one.id, one.by]).sort(), [[mail, "files"], [signUp, "list"]].sort());
    assert.deepEqual(built.capabilities.map((one) => [one.id, one.by]).sort(), [[emailForm, "list"], [sender, "files"]].sort());
    assert.deepEqual(built.unattributed, {});

    const abandoned = by.get(inc.abandoned)!;
    assert.equal(abandoned.tokens, undefined, "a session with no stored transcript leaves the spend unattributed, not zero");
    assert.match(abandoned.unattributed.tokens!, /Y has no transcript stored/);
    assert.equal(abandoned.rounds, 0, "the ledger holding no review for it is a real zero");
    assert.match(abandoned.unattributed.files!, /names no pull request/);

    const shared = by.get(inc.sharedA)!;
    assert.equal(shared.tokens, undefined);
    assert.match(shared.unattributed.tokens!, /Z drove 2 increments/);

    const unpriced = by.get(inc.unpriced)!;
    assert.equal(unpriced.tokens, 10, "its tokens are found");
    assert.equal(unpriced.dollars, undefined, "but a model with no list price leaves its dollars unattributed");
    assert.match(unpriced.unattributed.dollars!, /claude-unreleased-9/);
    assert.match(unpriced.unattributed.files!, /#6's merge is not on the checkout's main line/);

    const bare = await laneRows({ log, library, project }, window);
    const plain = bare.find((row) => row.increment === inc.built)!;
    assert.equal(plain.rounds, undefined, "with no part keeping a QA ledger, review rounds are unattributed");
    assert.match(plain.unattributed.rounds!, /no part keeping a QA ledger/);
    assert.match(plain.unattributed.files!, /no git history or map placement/);
  });
});

/** A joined lane with the measures given, touching story S and capability C. */
function row(id: string, measures: Partial<LaneRow>): LaneRow {
  return {
    increment: id, title: id, closed: "2026-11-10", disposition: "landed", sessions: ["s"], fixSessions: 0, queueReds: 0,
    stories: [{ id: "story_s", title: "Sign up", by: "list" }], capabilities: [{ id: "capability_c", title: "Email form", by: "list" }], unattributed: {}, ...measures,
  };
}

test("20.2 the measures print per story and per capability as median, middle half and range, with the lanes each was attributed for, and the command reads review rounds from the part keeping the ledger", async () => {
  assert.deepEqual(spreadOf([4, undefined, 1, 3, 2]), { lanes: 4, of: 5, median: 2.5, quartiles: [1.75, 3.25], range: [1, 4] });
  assert.deepEqual(spreadOf([undefined]), { lanes: 0, of: 1 });

  const rows = [
    row("increment_a", { tokens: 1_000, dollars: 1, rounds: 1 }),
    row("increment_b", { tokens: 3_000, dollars: 3, rounds: 3, fixSessions: 2, disposition: "failed" }),
    row("increment_c", { rounds: 2, unattributed: { tokens: "session X has no transcript stored in the log", dollars: "session X has no transcript stored in the log" } }),
  ];
  const [story] = groupMeasures(rows, (one) => one.stories);
  assert.equal(story!.lanes, 3);
  assert.equal(story!.landed, 2);
  assert.deepEqual(story!.tokens, { lanes: 2, of: 3, median: 2_000, quartiles: [1_500, 2_500], range: [1_000, 3_000] }, "a lane whose tokens are unattributed is left out, never a zero");

  const text = measuresText(rows, { from: "2026-11-04", to: "2026-11-10" });
  assert.match(text, /report only/);
  assert.match(text, /3 increments closed\. Attributed: tokens 2 of 3 \(67%\), dollars 2 of 3 \(67%\), review rounds 3 of 3 \(100%\)/);
  assert.match(text, /Per story[^]*Sign up \[story_s\]: 3 lanes, 2 landed \(67%\)\n {4}tokens: median 2,000, middle half 1,500–2,500, range 1,000–3,000 \(2 of 3 lanes\)\n {4}dollars: median \$2\.00/);
  assert.match(text, /Per capability[^]*Email form \[capability_c\]: 3 lanes/);
  assert.match(text, /fix sessions: fix sessions the watcher started/, "each measure is defined where it is printed");
  assert.match(text, /Not attributed:\n {2}increment_c \(increment_c\): tokens: session X has no transcript stored/);
  assert.match(measuresText([], { from: "2026-11-04", to: "2026-11-10" }), /No increment closed in that window/);

  // The command: the window it is given, and review rounds from whichever mounted part's project records offer them.
  const family = MEASURES_FAMILIES[0]!;
  await withWorld(async ({ log, library, project, inc }) => {
    const folder = mkdtempSync(path.join(tmpdir(), "measures-"));
    try {
      const context = {
        log, library, project, session: "me", folder, server: {} as never, placeFiles: async () => [],
        projectRecords: async () => [{ name: "Other" }, { name: "QA ledger", reviewRounds: async (_server: unknown, asked: string, increments: readonly string[]) => new Map(increments.map((id) => [id, asked === project ? 4 : 0])) }],
      };
      const answer = await family.bare!.act({ from: "2026-11-10", to: "2026-11-10", json: true }, context as never, {} as never);
      const report = JSON.parse(answer.text) as { rows: LaneRow[] };
      assert.deepEqual(report.rows.map((one) => [one.increment, one.rounds]), [[inc.built, 4]]);
      assert.match(report.rows[0]!.unattributed.files!, /#5's merge is not on the checkout's main line/, "a folder with no git history finds no pull request's merge");
      // With no days given, the window is the seven days to today.
      const today = new Date().toISOString().slice(0, 10);
      const week = JSON.parse((await family.bare!.act({ json: true }, context as never, {} as never)).text) as { window: { from: string; to: string } };
      assert.deepEqual(week.window, { from: new Date(Date.parse(`${today}T00:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10), to: today });
      await assert.rejects(family.bare!.act({ from: "2026-11-31", json: false }, context as never, {} as never), /not a day/);
      await assert.rejects(family.bare!.act({ from: "2026-11-12", to: "2026-11-10", json: false }, context as never, {} as never), /after --to/);
    } finally {
      await removeTemp(folder);
    }
  });
});
