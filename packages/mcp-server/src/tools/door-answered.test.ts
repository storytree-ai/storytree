/**
 * Capability 6 · Agent tools (the MCP server). Every tool call's answer is recorded on the calling session as a
 * `door-answered` line (ADR-0983 D1, in force through ADR-0998), and recording it never changes the answer.
 * The tools are fixtures served through the real server, its routing and its activity log.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { writeFileSync } from "node:fs";
import path from "node:path";

import { withTempDir } from "@storytree/project-and-caller/testing/folders";
import { approveCheckout } from "@storytree/project-and-caller/testing/pg";
import { VerbRefusal, type Verb } from "@storytree/library/verbs";
import { z } from "zod";

import { claudeCode, withAgent } from "../testing/agent.js";
import { withProject } from "../testing/tool-world.js";
import { mountTools } from "./mount.js";
import { servedTools, type ToolExtension } from "./server.js";

const offers: Verb = {
  command: { family: "thing", name: "show", summary: "show a thing" },
  tool: { name: "show_thing", description: "Show a thing." },
  inputs: { refuse: { kind: "switch", describe: "refuse instead" } },
  async act({ refuse }) {
    if (refuse) throw new VerbRefusal("No thing here.");
    return { text: "Thing t1.", next: [{ tool: "open", command: "library read <id>", why: "read it whole" }, { command: "session list --all", why: "the hidden sessions too" }] };
  },
};

const fixtures: ToolExtension = {
  registerTools(define) {
    mountTools(define, [offers]);
    define("break_thing", "Fail.", z.object({}), async () => { throw new TypeError("the thing broke"); });
    define("lose_log", "Answer, with the activity log refusing every line from then on.", z.object({}), async (_args, call) => {
      call.log.append = async () => { throw new Error("the activity log is gone"); };
      return { text: "Still answered." };
    });
  },
};

test("6.60 every tool call's answer is recorded on the calling session as a door-answered line: the tool, answered, refused or failed with its class, and the next steps it offered as the tool door names them", async () => {
  await withProject(async ({ folder, project, log }) => {
    await withAgent(folder, claudeCode("tool-door-1", { extensions: [fixtures] }), async (agent) => {
      assert.equal((await agent.call("show_thing")).isError, false);
      assert.equal((await agent.call("show_thing", { refuse: true })).isError, true);
      assert.equal((await agent.call("break_thing")).isError, true);
    });

    const lines = await log.lines(project, { sessions: ["tool-door-1"], kinds: ["door-answered"] });
    const said = lines.map((line) => {
      const { door, verb, outcome, next, ...rest } = line as Extract<typeof line, { kind: "door-answered" }>;
      return { door, verb, outcome, class: rest.class, next };
    });
    assert.deepEqual(said, [
      { door: "tool", verb: "show_thing", outcome: "answered", class: undefined, next: ["open", "storytree session list --all"] },
      { door: "tool", verb: "show_thing", outcome: "refused", class: undefined, next: [] },
      { door: "tool", verb: "break_thing", outcome: "failed", class: "TypeError", next: [] },
    ]);
  });
});

test("6.90 a tool the lane's experiment arm denies does nothing else: it answers refused, naming the experiment and arm, and is recorded as a door-answered line, denied-by-arm, carrying both", async () => {
  await withProject(async ({ folder, project, log }) => {
    await withTempDir(async (home) => {
      // The lane's own storytree home, which names its arm, and where its checkout is approved.
      writeFileSync(path.join(home, "settings.json"), JSON.stringify({ experiment: { name: "twin-build", arm: "map-reads-off", denies: { tools: ["focus"], commands: ["storytree map"] } } }));
      await approveCheckout(folder, project, home);
      await withAgent(folder, claudeCode("arm-tool-1", { extensions: [fixtures], setup: { storytreeHome: home } }), async (agent) => {
        const denied = await agent.call("focus", { select: "story:Anything" });
        assert.equal(denied.isError, true);
        assert.match(denied.text, /twin-build.*map-reads-off.*focus/);
        assert.equal((await agent.call("show_thing")).isError, false, "a verb the arm leaves alone still answers");
      });
    });

    const lines = await log.lines(project, { sessions: ["arm-tool-1"], kinds: ["door-answered", "tool-called"] });
    assert.deepEqual(lines.map((line) => {
      const said = line as Extract<typeof line, { kind: "door-answered" }>;
      return { kind: line.kind, verb: said.verb, outcome: said.outcome, experiment: line.experiment, arm: line.arm };
    }), [
      { kind: "tool-called", verb: undefined, outcome: undefined, experiment: "twin-build", arm: "map-reads-off" },
      { kind: "door-answered", verb: "focus", outcome: "denied-by-arm", experiment: "twin-build", arm: "map-reads-off" },
      { kind: "tool-called", verb: undefined, outcome: undefined, experiment: "twin-build", arm: "map-reads-off" },
      { kind: "door-answered", verb: "show_thing", outcome: "answered", experiment: "twin-build", arm: "map-reads-off" },
    ]);
  });
});

test("6.61 a tool whose door-answered line cannot be written still gives its answer", async () => {
  await withProject(async ({ folder }) => {
    await withAgent(folder, claudeCode("tool-door-2", { extensions: [fixtures] }), async (agent) => {
      const answer = await agent.call("lose_log");

      assert.equal(answer.isError, false, answer.text);
      assert.equal(answer.text, "Still answered.");
    });
  });
});

test("6.63 the tool server names every tool it would serve in a folder, the same names its client lists, with who calls each, without a call", async () => {
  await withProject(async ({ folder }) => {
    const served = await servedTools(folder, { extensions: [fixtures] });
    const named = served.map(({ name }) => name);
    await withAgent(folder, claudeCode("tool-door-names", { extensions: [fixtures] }), async (agent) => {
      // Less a harness's own tools, which no agent or person calls (ADR-1056 D2).
      assert.deepEqual([...named].sort(), (await agent.tools()).filter((tool) => tool !== "hook_event"));
    });
    assert.ok(named.includes("check_setup") && named.includes("show_thing"), "the setup check's tools and an extension's are named too");
    const consumers = (tool: string) => served.find(({ name }) => name === tool)?.consumers;
    assert.deepEqual(consumers("set_up_project"), ["user"], "each with who calls it");
    assert.deepEqual(consumers("show_thing"), ["agent", "user"], "both, unless defined otherwise");
  });
});
