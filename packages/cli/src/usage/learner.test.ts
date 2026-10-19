/** The command line 14.12: the learner in the friction drain files each want and raises each cut group once, against a real Postgres. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

import { connect } from "@storytree/library";
import { dropTestDatabases } from "@storytree/local-postgres/testing";
import { openActivityLog } from "@storytree/session-management";
import { testServerUrl } from "@storytree/project-and-caller/testing/pg";

import { learnInDrain } from "./learner.js";
import type { Surfaces } from "./learn.js";

const agent = ["agent"] as const;
const surfaces: Surfaces = {
  commands: [{ verb: "storytree adr pull", consumers: agent }, { verb: "storytree quality graduate", consumers: agent }],
  tools: [{ verb: "quality_brief", consumers: agent }],
  twins: [],
};

test("14.12 · the drain files a want as friction and raises a cut group as a question with an increment held on it, a second drain duplicates neither, and a project without the arcs learns nothing", async () => {
  const project = `t-${randomBytes(4).toString("hex")}`;
  const storytree = await connect({ url: testServerUrl() });
  const log = await openActivityLog(testServerUrl());
  try {
    const library = await storytree.openProject(project);
    try {
      const wants = await library.createArc({ title: "Doors", intent: "Measure the doors", endState: "Measured" });
      const cuts = await library.createArc({ title: "Prune the front doors", intent: "Prune", endState: "Pruned" });
      const now = new Date("2026-11-20T00:00:00.000Z");
      const day = (offset: number) => new Date(now.getTime() - offset * 24 * 60 * 60 * 1000).toISOString();
      const common = { harness: "claude-code", source: "tool", machine: "box" } as const;
      const answer = (session: string, verb: string, at: string, more: { outcome?: "unknown"; word?: string } = {}) =>
        log.append(project, { ...common, session, kind: "door-answered", door: "command", verb, outcome: "answered", next: [], ...more }, { at });
      // 100 sessions over the whole 28 days, so disuse can be judged; twelve of them type a word no command answers.
      for (let index = 0; index < 100; index += 1) {
        const at = day(27.5 - index * 0.27);
        if (index < 12) await answer(`s${index}`, "storytree", at, { outcome: "unknown", word: "plan" });
        else await answer(`s${index}`, "storytree adr pull", at);
      }
      const world = { log, project, library, branch: "claude/learner", surfaces, arcs: { wants: wants.id, cuts: cuts.id }, now };

      assert.deepEqual(await learnInDrain({ ...world, arcs: { wants: "arc_000000000000", cuts: cuts.id } }), [], "a project without the arcs learns nothing");
      assert.equal((await library.list("friction")).length, 0);

      const first = await learnInDrain(world);
      const filed = (await library.list("friction")).filter((friction) => friction.fields.title === 'Agents type "storytree plan", which no command answers');
      assert.equal(filed.length, 1, first.join("\n"));
      assert.match(filed[0]?.fields.statement ?? "", new RegExp(wants.id), "it names the arc that measures the doors");
      const asked = await library.questions(cuts.id);
      assert.deepEqual(asked.map((question) => question.fields.title).sort(), ["Cut, keep or merge the unused verbs in storytree quality?", "Cut, keep or merge the unused verbs in the tools with no command?"]);
      const held = (await library.list("increment")).filter((increment) => increment.fields.arc === cuts.id);
      assert.deepEqual(held.map((increment) => increment.fields.heldOn).sort(), asked.map((question) => [question.id]).sort(), "each group's increment is held on its question");

      await learnInDrain(world);
      assert.equal((await library.list("friction")).length, 1, "a second drain files no second want");
      assert.equal((await library.questions(cuts.id)).length, 2, "a second drain raises no second question");
      assert.equal((await library.list("increment")).length, 2, "a second drain parks no second increment");
    } finally {
      await library.close();
    }
  } finally {
    await log.close();
    await storytree.close();
    await dropTestDatabases([`storytree_${project}`]);
  }
});
