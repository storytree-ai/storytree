/** The command line 14.12, 14.13 and 14.15: the learner in the friction drain files each want, raises each cut group and writes each pointer once, against a real Postgres. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

import { connect, type Library } from "@storytree/library";
import { recordFriction } from "@storytree/session-management/friction";
import { dropTestDatabases } from "@storytree/local-postgres/testing";
import { openActivityLog, type ActivityLog } from "@storytree/session-management";
import { testServerUrl } from "@storytree/project-and-caller/testing/pg";

import { learnInDrain, type LearnerWorld } from "./learner.js";
import type { Surfaces } from "./learn.js";

const agent = ["agent"] as const;
const surfaces: Surfaces = {
  commands: [{ verb: "storytree adr pull", consumers: agent }, { verb: "storytree quality graduate", consumers: agent }],
  tools: [{ verb: "quality_brief", consumers: agent }],
  twins: [],
};

/** A fresh project with both arcs and `sessions` sessions (100 unless named) over the whole 28 days, twelve for each of `words` typing it where no command answers it, handed to `body` with the learner's world. */
async function inProject(words: readonly string[], body: (world: LearnerWorld, library: Library) => Promise<void>, sessions = 100): Promise<void> {
  const project = `t-${randomBytes(4).toString("hex")}`;
  const storytree = await connect({ url: testServerUrl() });
  const log: ActivityLog = await openActivityLog(testServerUrl());
  try {
    const library = await storytree.openProject(project);
    try {
      const wants = await library.createArc({ title: "Doors", intent: "Measure the doors", endState: "Measured" });
      const cuts = await library.createArc({ title: "Prune the front doors", intent: "Prune", endState: "Pruned" });
      const now = new Date("2026-11-20T00:00:00.000Z");
      const day = (offset: number) => new Date(now.getTime() - offset * 24 * 60 * 60 * 1000).toISOString();
      const common = { harness: "claude-code", source: "tool", machine: "box" } as const;
      // Sessions over the whole 28 days, so disuse can be judged; twelve of them for each word type it where no command answers it.
      for (let index = 0; index < sessions; index += 1) {
        const word = words[Math.floor(index / 12)];
        const line = word === undefined
          ? { verb: "storytree adr pull", outcome: "answered" as const }
          : { verb: "storytree", outcome: "unknown" as const, word };
        await log.append(project, { ...common, session: `s${index}`, kind: "door-answered", door: "command", next: [], ...line }, { at: day(27.5 - index * 0.27) });
      }
      await body({ log, project, library, surfaces, arcs: { wants: wants.id, cuts: cuts.id }, now, caller: { session: "drain-1", harness: "claude-code" } }, library);
    } finally {
      await library.close();
    }
  } finally {
    await log.close();
    await storytree.close();
    await dropTestDatabases([`storytree_${project}`]);
  }
}

const CUT_TITLES = ["Cut, keep or merge the unused verbs in storytree quality?", "Cut, keep or merge the unused verbs in the tools with no command?"];

test("14.12 · the drain files a want as friction and raises a cut group as a question with an increment held on it, a second drain duplicates neither, and a project without the arcs learns nothing", async () => {
  await inProject(["plan"], async (world, library) => {
    assert.deepEqual(await learnInDrain({ ...world, arcs: { wants: "arc_000000000000", cuts: world.arcs.cuts } }), [], "a project without the arcs learns nothing");
    assert.equal((await library.list("friction")).length, 0);

    const first = await learnInDrain(world);
    const filed = (await library.list("friction")).filter((friction) => friction.fields.title === 'Agents type "storytree plan", which no command answers');
    assert.equal(filed.length, 1, first.join("\n"));
    assert.match(filed[0]?.fields.statement ?? "", new RegExp(world.arcs.wants), "it names the arc that measures the doors");
    const asked = await library.questions(world.arcs.cuts);
    assert.deepEqual(asked.map((question) => question.fields.title).sort(), CUT_TITLES);
    const held = (await library.list("increment")).filter((increment) => increment.fields.arc === world.arcs.cuts);
    assert.deepEqual(held.map((increment) => increment.fields.heldOn).sort(), asked.map((question) => [question.id]).sort(), "each group's increment is held on its question");

    await learnInDrain(world);
    assert.equal((await library.list("friction")).length, 1, "a second drain files no second want");
    assert.equal((await library.questions(world.arcs.cuts)).length, 2, "a second drain raises no second question");
    assert.equal((await library.list("increment")).length, 2, "a second drain parks no second increment");
  });
});

test("14.13 · a want is filed on the learner's own branch, so it never spends the landing session's three, and one past the learner's three waits while the rest of the step runs", async () => {
  await inProject(["plan", "story", "wait", "contract"], async (world, library) => {
    const said = await learnInDrain(world);
    const filed = await library.list("friction");
    assert.deepEqual(filed.map((friction) => friction.fields.provenance?.branch), ["(doors learner)", "(doors learner)", "(doors learner)"], said.join("\n"));
    assert.ok(said.includes("  1 more want waits for a later drain: the learner has filed its three for today."), said.join("\n"));
    assert.equal((await library.questions(world.arcs.cuts)).length, 2, "the cut groups are raised all the same");
    // The landing session's own three still file.
    const own = { title: "A session's own", description: "Its own.", statement: "Its own.", evidence: "`pnpm test` failed", impact: "Slow." };
    for (const branch of ["claude/lane", "claude/lane", "claude/lane"]) await recordFriction(library, { ...own, branch });
    assert.equal((await library.list("friction")).length, 6);
  });
});

test("14.15 · the drain writes a word's pointer line once, with its evidence, and its fallback line once; a second drain writes neither again", async () => {
  await inProject([], async (world) => {
    const common = { harness: "claude-code", source: "tool" as const, kind: "door-answered" as const, door: "command" as const, next: [] as string[] };
    const minute = (offset: number) => new Date(world.now.getTime() + offset * 60 * 1000).toISOString();
    // Six sessions refuse `adr show`, offered `adr pull`, and take it: above the bar.
    for (let index = 0; index < 6; index += 1) {
      await world.log.append(world.project, { ...common, session: `show-${index}`, verb: "storytree adr", outcome: "unknown", word: "show", next: ["storytree adr pull"] }, { at: minute(-60 + index * 2) });
      await world.log.append(world.project, { ...common, session: `show-${index}`, verb: "storytree adr pull", outcome: "answered" }, { at: minute(-59 + index * 2) });
    }
    const pointers = () => world.log.lines(world.project, { kinds: ["door-pointer"] });

    const said = await learnInDrain(world);
    const written = await pointers();
    assert.deepEqual(written.map((line) => line.kind === "door-pointer" && { where: line.where, word: line.word, to: line.to, session: line.session }), [
      { where: "storytree adr", word: "show", to: "storytree adr pull", session: world.caller.session },
    ], said.join("\n"));
    assert.match(written[0]?.kind === "door-pointer" ? written[0].evidence : "", /"storytree adr show" refused as unknown 6 times in 6 sessions; hints followed: storytree adr pull 6/);
    await learnInDrain(world);
    assert.equal((await pointers()).length, 1, "a second drain writes no second pointer");

    // Six pointed calls, each refused: the sessions left it.
    for (let index = 0; index < 6; index += 1) {
      await world.log.append(world.project, { ...common, session: `pointed-${index}`, verb: "storytree adr pull", outcome: "refused", word: "show", pointedFrom: "storytree adr" }, { at: minute(1 + index) });
    }
    const later = { ...world, now: new Date(world.now.getTime() + 60 * 60 * 1000) };
    await learnInDrain(later);
    const fallen = await pointers();
    assert.deepEqual(fallen.map((line) => line.kind === "door-pointer" && line.to), ["storytree adr pull", undefined], "the pointer falls back");
    await learnInDrain(later);
    assert.equal((await pointers()).length, 2, "a second drain writes no second fallback");
  });
});

test("14.16 · a drain a week or more after the last doors check reads the trailing week and files at most three standing-out items, skipping what the learner filed or raised, and records the check; a drain within the week does nothing", async () => {
  await inProject([], async (world, library) => {
    const common = { harness: "claude-code", source: "tool" as const, kind: "door-answered" as const, door: "command" as const };
    const hour = (offset: number) => new Date(world.now.getTime() - offset * 60 * 60 * 1000).toISOString();
    // In the last week: "storytree story" refused 6 times, below a want's 10; "storytree wait" 4 times, below the check's bar.
    for (let index = 0; index < 10; index += 1) {
      await world.log.append(world.project, { ...common, session: `guess-${index}`, verb: "storytree", outcome: "unknown", word: index < 6 ? "story" : "wait", next: [] }, { at: hour(100 - index) });
    }
    // The hint "storytree quality graduate" offered 25 times and never taken.
    for (let index = 0; index < 26; index += 1) {
      await world.log.append(world.project, { ...common, session: "hinted", verb: "storytree adr pull", outcome: "answered", next: index < 25 ? ["storytree quality graduate"] : [] }, { at: hour(50 - index) });
    }
    const checks = async () => (await world.log.lines(world.project, { kinds: ["door-checked"] })).map((line) => (line.kind === "door-checked" ? [...line.filed].sort() : []));
    const checked = async () => (await library.list("friction")).filter((friction) => friction.fields.provenance?.branch === "(doors check)");

    // 50 sessions: too few for the learner to raise cuts, so the unused groups are the check's.
    const said = await learnInDrain(world);
    const first = await checked();
    assert.deepEqual(first.map((friction) => friction.fields.title).sort(), [
      'Agents rarely take the hint "storytree quality graduate"',
      'Agents type "storytree story", which no command answers',
      "No agent called these verbs in storytree quality for 28 days",
    ], said.join("\n"));
    assert.deepEqual(await checks(), [first.map((friction) => friction.id).sort()], "the check is recorded with what it filed");
    assert.ok(said.includes("  More stood out than the 3 a check files; the rest wait for next week's."), said.join("\n"));

    const again = await learnInDrain({ ...world, now: new Date(world.now.getTime() + 6 * 24 * 60 * 60 * 1000) });
    assert.equal((await checks()).length, 1, "a drain within the week checks nothing");
    assert.ok(again.some((line) => line.includes("the next weekly check is due from 2026-11-27")), again.join("\n"));

    const week = new Date(world.now.getTime() + 7 * 24 * 60 * 60 * 1000);
    // A week later the check runs again; the open three are not filed again, and the one left waiting meets the branch's three for today.
    const later = await learnInDrain({ ...world, now: week });
    assert.equal((await checked()).length, 3, later.join("\n"));
    assert.ok(later.includes("  The rest wait for next week's check: the check has filed its three for today."), later.join("\n"));
    assert.deepEqual(await checks(), [first.map((friction) => friction.id).sort(), []], "a check that filed nothing is still recorded");
    await learnInDrain({ ...world, now: new Date(week.getTime() + 24 * 60 * 60 * 1000) });
    assert.equal((await checks()).length, 2, "and it counts as the week's check");
  }, 50);
});
