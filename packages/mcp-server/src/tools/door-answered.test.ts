/**
 * Capability 6 · Tool server (the MCP server). Every tool call's answer is recorded on the calling session as a
 * `door-answered` line (ADR-0983 D1, in force through ADR-0998), and recording it never changes the answer.
 * The tools are fixtures served through the real server, its routing and its activity log.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { withTempDir } from "@storytree/project-and-caller/testing/folders";
import { approveCheckout, testServerDataDir } from "@storytree/project-and-caller/testing/pg";
import { VerbRefusal, type Verb } from "@storytree/library/verbs";
import { takeReads } from "@storytree/library/reads";
import { z } from "zod";

import armCheckParts from "../parts/arm-checks.js";
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
    define("read_thing", "Read the project's plan.", z.object({}), async (_args, call) => {
      await call.library.projectTree();
      return { text: "Read." };
    });
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
      writeFileSync(path.join(home, "settings.json"), JSON.stringify({ ...armPlugin(home), experiment: { name: "twin-build", arm: "map-reads-off", denies: { tools: ["focus"], commands: ["storytree map"] } } }));
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

test("6.104 the tool server asks the arm checks its parts contribute: its own parts contribute none, and with the part a factory plugin's arm check stands in for switched on, a tool the home's arm denies answers as usual", async () => {
  assert.deepEqual(armCheckParts.parts, [], "no story package the server mounts contributes an arm check");
  await withProject(async ({ folder, project }) => {
    await withTempDir(async (home) => {
      // The lane's own storytree home, which names an arm denying show_thing and a plugin's arm check whose part is on.
      writeFileSync(path.join(home, "settings.json"), JSON.stringify({ ...armPlugin(home), "parts-off": [], experiment: { name: "twin-build", arm: "things-off", denies: { tools: ["show_thing"], commands: [] } } }));
      await approveCheckout(folder, project, home);
      await withAgent(folder, claudeCode("arm-tool-off", { extensions: [fixtures], setup: { storytreeHome: home } }), async (agent) => {
        const answered = await agent.call("show_thing");
        assert.equal(answered.isError, false, answered.text);
        assert.match(answered.text, /^Thing t1\./);
      });
    });
  });
});

/**
 * Writes into `home`'s factory a plugin contributing an arm check, which denies what the home's experiment setting says
 * its arm denies, and returns the settings that mount it in the place of experiments, a part the host does not have.
 */
function armPlugin(home: string): Record<string, unknown> {
  const plugin = path.join(home, "factory", "plugins", "my-arms");
  mkdirSync(plugin, { recursive: true });
  writeFileSync(path.join(plugin, "package.json"), JSON.stringify({ name: "my-arms", type: "module", exports: { "./arm-checks": "./arm-checks.js" }, storytree: { interface: 1, armChecks: [{ from: "./arm-checks", export: "armChecks" }] } }));
  writeFileSync(path.join(plugin, "arm-checks.js"), `import { readFileSync } from "node:fs";
import path from "node:path";
export const armChecks = [{ name: "my-arm", verdict(door, verb, home = process.env.STORYTREE_HOME) {
  const { experiment } = JSON.parse(readFileSync(path.join(home, "settings.json"), "utf8"));
  const denies = experiment?.denies?.[door === "tool" ? "tools" : "commands"] ?? [];
  if (!denies.some((denied) => verb === denied || verb.startsWith(denied + " "))) return { allowed: true };
  return { allowed: false, message: \`experiment "\${experiment.name}", arm "\${experiment.arm}", denies \${verb}\` };
} }];
`);
  return { factory: path.join(home, "factory"), "parts-off": ["experiments"], "stand-ins": { experiments: "my-arms" } };
}

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
    // The test home the agent's server reads, not this computer's, whose factory may mount more tools.
    const served = await servedTools(folder, { dataDir: testServerDataDir(), extensions: [fixtures] });
    const named = served.map(({ name }) => name);
    await withAgent(folder, claudeCode("tool-door-names", { extensions: [fixtures] }), async (agent) => {
      // Less a harness's own tools, which no agent or person calls (ADR-1056 D2).
      assert.deepEqual([...named].sort(), (await agent.tools()).filter((tool) => tool !== "hook_event" && tool !== "heartbeat"));
    });
    assert.ok(named.includes("check_setup") && named.includes("show_thing"), "the setup check's tools and an extension's are named too");
    const consumers = (tool: string) => served.find(({ name }) => name === tool)?.consumers;
    assert.deepEqual(consumers("set_up_project"), ["user"], "each with who calls it");
    assert.deepEqual(consumers("show_thing"), ["agent", "user"], "both, unless defined otherwise");
  });
});

test("6.107 what a tool call reads from the library, its routing and its log's lines included, is counted as that tool's", async () => {
  await withProject(async ({ folder }) => {
    await withAgent(folder, claudeCode("tool-reads-1", { extensions: [fixtures] }), async (agent) => {
      takeReads();
      assert.equal((await agent.call("read_thing")).isError, false);
      const read = takeReads().find((total) => total.reader === "tool read_thing");
      assert.ok(read !== undefined && read.bytes > 0 && read.statements > 0, "the call's reads are the tool's");
    });
  });
});
