/** Capability 6 · Agent tools: the other stories' tools the server mounts, read from their packages' manifests (ADR-1021). */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { setupToolParts } from "@storytree/app-setup/tools";
import { librarianToolParts } from "@storytree/library/librarian";
import { mapToolParts } from "@storytree/map/tools";
import { qualityToolParts } from "@storytree/quality-assurance";
import { testRunToolParts } from "@storytree/quality-assurance/test-run";
import { hookToolParts } from "@storytree/session-management";
import { sessionToolParts } from "@storytree/session-management/tools";
import { removeTemp } from "@storytree/test-waits";

import { approveCheckout } from "@storytree/project-and-caller/testing/pg";

import toolParts from "../parts/tools.js";
import { withAgent } from "../testing/agent.js";
import { withProject } from "../testing/tool-world.js";
import { createAgentTools, type ToolPart } from "./server.js";

// The stories restate the server's extension point rather than import it (ADR-1017 D2); this is where the two are checked to fit.
const declared: readonly ToolPart[] = [...librarianToolParts, ...qualityToolParts, ...testRunToolParts, ...hookToolParts, ...sessionToolParts, ...mapToolParts, ...setupToolParts];

test("6.75 the tool server mounts the tool parts its story packages' manifests name: the librarian's, then quality assurance's review tools and its verified test run, then Session management's hook event tool and its claim, landing, context and runs tools, then the map's, then App setup's, each given the project served and the server's tool names", () => {
  assert.equal(import.meta.resolve("#parts/tools"), new URL("../parts/tools.ts", import.meta.url).href, "the package's #parts/tools is its composing module");
  assert.deepEqual(toolParts.parts, declared);
  const tools = () => ["check_setup"];
  const served = (project: string | undefined) => toolParts.parts.map((part) => part({ project, tools, imports: async () => [], heldBack: () => undefined, pipelineJobs: [] }) !== undefined);
  assert.deepEqual(served("storytree"), [true, true, true, true, true, true, true], "storytree's own library gets the librarian's tools, quality assurance's, Session management's, the map's and App setup's");
  assert.deepEqual(served("another-project"), [false, true, true, true, true, true, true], "another project gets all but the librarian's (ADR-0644 U1)");
});

test("6.95 the tool server serves no tool of a part this computer switches off, nor of one standing on it, and serves the rest", async (t) => {
  const folder = mkdtempSync(path.join(tmpdir(), "parts-off-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const served = async (off: readonly string[]) => {
    writeFileSync(path.join(folder, "settings.json"), JSON.stringify({ "parts-off": off }));
    const tools = createAgentTools({ folder, env: {}, setup: { storytreeHome: folder } });
    try {
      return [...tools.tools, ...tools.harnessTools];
    } finally {
      await tools.close();
    }
  };
  const all = await served([]);
  assert.ok(all.includes("quality_brief") && all.includes("hook_event"), "both parts' tools are served with nothing off");
  const declaredTools = ["record_friction", "friction_drain", "route", "name_session", "close_out"];
  for (const tool of declaredTools) assert.ok(all.includes(tool), `${tool}, declared on a verb, is served with nothing off`);
  const partTools = ["claim", "release", "make_workspace", "attach_workspace", "stale_claims", "read_context", "list_own_runs", "list_all_runs", "stop_own_run", "clear_own_runs", "report", "land", "present_question"];
  for (const tool of partTools) assert.ok(all.includes(tool), `${tool}, Session management's tool part, is served with nothing off`);
  const qualityOff = await served(["quality-assurance"]);
  assert.ok(!qualityOff.includes("quality_brief"), "quality assurance's tools are not served");
  assert.ok(qualityOff.includes("hook_event") && qualityOff.includes("check_setup"), "the rest still are");
  const sessionsOff = await served(["session-management"]);
  for (const tool of declaredTools) assert.ok(!sessionsOff.includes(tool), `${tool}, declared on Session management's verbs, goes with it`);
  for (const tool of partTools) assert.ok(!sessionsOff.includes(tool), `${tool}, in Session management's tool part, goes with it`);
  assert.ok(!sessionsOff.includes("hook_event") && !sessionsOff.includes("quality_brief"), "quality assurance stands on Session management: its tools go with it");
  assert.ok(sessionsOff.includes("check_setup"), "the server's own tools stay");
  const mapTools = ["focus", "health_worklist"];
  const setupTools = ["wire_pipeline", "import_project", "take_starter_pack", "move_onto_factory"];
  for (const tool of [...mapTools, ...setupTools]) assert.ok(all.includes(tool), `${tool} is served with nothing off`);
  const mapOff = await served(["map"]);
  for (const tool of mapTools) assert.ok(!mapOff.includes(tool), `${tool}, in the map's tool part, goes with it`);
  for (const tool of setupTools) assert.ok(!mapOff.includes(tool), `${tool}: App setup stands on the map, so its tools go with it`);
  assert.ok(mapOff.includes("show_plan") && mapOff.includes("plan_contract"), "the library's plan tools stay");
  const setupOff = await served(["app-setup"]);
  for (const tool of setupTools) assert.ok(!setupOff.includes(tool), `${tool}, in App setup's tool part, goes with it`);
  for (const tool of ["check_setup", "set_up_project", ...mapTools]) assert.ok(setupOff.includes(tool), `${tool} stays with App setup off`);
});

test("6.103 with code review and architecture checks both switched off, the tool server starts and serves every tool it serves with both on but code review's (ADR-1170 D2)", async (t) => {
  const folder = mkdtempSync(path.join(tmpdir(), "review-off-"));
  t.after(() => removeTemp(folder));
  const served = async (off: readonly string[]) => {
    writeFileSync(path.join(folder, "settings.json"), JSON.stringify({ "parts-off": off }));
    const tools = createAgentTools({ folder, env: {}, setup: { storytreeHome: folder } });
    try {
      return [...tools.tools, ...tools.harnessTools];
    } finally {
      await tools.close();
    }
  };
  const all = await served([]);
  const off = await served(["quality-assurance", "guardrails"]);
  const gone = all.filter((tool) => !off.includes(tool));
  assert.ok(gone.length > 0 && gone.every((tool) => tool.startsWith("quality_") || tool === "graduate_check" || tool === "run_tests"), `only code review's tools go: ${gone.join(", ")}`);
  for (const tool of ["check_setup", "claim", "land", "make_workspace", "show_plan", "close_increment", "wire_pipeline"]) assert.ok(off.includes(tool), `${tool} is still served`);
  assert.deepEqual(off.filter((tool) => !all.includes(tool)), [], "nothing new is served in their place");
});

test("6.98 with a factory folder chosen and a factory plugin named to stand in for experiments, a part nothing stands on, the tool server serves the plugin's verb tools where experiments' were, and not once experiments is on again", async (t) => {
  const folder = mkdtempSync(path.join(tmpdir(), "stand-in-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const plugin = path.join(folder, "factory", "plugins", "my-health");
  mkdirSync(plugin, { recursive: true });
  writeFileSync(path.join(plugin, "package.json"), JSON.stringify({ name: "my-health", type: "module", exports: { "./verbs": "./verbs.js" }, storytree: { interface: 1, verbs: [{ from: "./verbs", export: "families" }] } }));
  writeFileSync(path.join(plugin, "verbs.js"), `const check = {
  command: { family: "health", name: "check", summary: "my own health check" },
  tool: { name: "my_health_check", description: "my own health check" },
  inputs: {},
  callerless: true,
  act: async () => ({ text: "my health is fine" }),
};
export const families = [{ name: "health", summary: "my own health", order: 18, verbs: [check] }];
`);
  const served = async (settings: object) => {
    writeFileSync(path.join(folder, "settings.json"), JSON.stringify({ factory: path.join(folder, "factory"), ...settings }));
    const tools = createAgentTools({ folder, env: {}, setup: { storytreeHome: folder } });
    try {
      return tools.tools;
    } finally {
      await tools.close();
    }
  };
  const standingIn = await served({ "parts-off": ["experiments"], "stand-ins": { experiments: "my-health" } });
  assert.ok(standingIn.includes("my_health_check"), "the plugin's tool is served");
  assert.ok(standingIn.includes("check_setup"), "the rest still are");
  const on = await served({ "parts-off": [], "stand-ins": {} });
  assert.ok(!on.includes("my_health_check"), "switched back on, the plugin's tool is not served");
});

test("6.105 a factory plugin mounted in a switched-off part's place writes its own kind of record through its tool, the server opening the project with the kinds the plugin declares; a plugin whose kinds cannot be read is named on the card, as a stand-in that failed is (ADR-1178 D3)", async () => {
  await withProject(async ({ folder, project, library }) => {
    const home = mkdtempSync(path.join(tmpdir(), "stand-in-kinds-"));
    try {
      await approveCheckout(folder, project, home);
      const plugin = path.join(home, "factory", "plugins", "my-health");
      mkdirSync(plugin, { recursive: true });
      const manifest = (kind: string) => JSON.stringify({ name: "my-health", type: "module", exports: { "./verbs": "./verbs.js" }, storytree: {
        interface: 1, verbs: [{ from: "./verbs", export: "families" }],
        recordKinds: [{ kind, version: 1, fields: { type: "object", properties: { words: { type: "string" } }, required: ["words"] }, writers: ["my_health"] }],
      } });
      writeFileSync(path.join(plugin, "package.json"), manifest("my-health.reading"));
      writeFileSync(path.join(plugin, "verbs.js"), `const note = {
  command: { family: "health", name: "note", summary: "keep a health reading" },
  tool: { name: "my_health_note", description: "keep a health reading" },
  inputs: { words: { kind: "text", word: 0, describe: "the reading" } },
  act: async ({ words }, { library, writer }) => ({ text: (await library.createPluginRecord("my-health.reading", { words }, writer)).id }),
};
export const families = [{ name: "health", summary: "my own health", order: 18, verbs: [note] }];
`);
      writeFileSync(path.join(home, "settings.json"), JSON.stringify({ factory: path.join(home, "factory"), "parts-off": ["experiments"], "stand-ins": { experiments: "my-health" } }));

      await withAgent(folder, { setup: { storytreeHome: home } }, async (agent) => {
        const noted = await agent.call("my_health_note", { words: "steady" });
        assert.equal(noted.isError, false, noted.text);
        const id = noted.text.trim().split("\n")[0]!;
        const kept = await library.get(id);
        assert.deepEqual([kept?.type, kept?.fields], ["my-health.reading", { words: "steady" }], "the server wrote the plugin's record");
        assert.doesNotMatch(agent.instructions() ?? "", /record kinds could not be read/);
      });

      writeFileSync(path.join(plugin, "package.json"), manifest("other.reading"));
      await withAgent(folder, { setup: { storytreeHome: home } }, async (agent) => {
        assert.match(agent.instructions() ?? "", /experiments is switched off on this computer, and its stand-in my-health's record kinds could not be read: my-health's record kind "other\.reading" is not named my-health\.<kind>\. Switch it on with: storytree settings set part experiments on/);
      });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

test("plugin-loader 5.15 · check_plugin, served by the tool server, is handed its command families: on a stand-in for experiments it lists the commands experiments provides that the plugin does not", async (t) => {
  const home = mkdtempSync(path.join(tmpdir(), "stand-in-check-"));
  const before = process.env.STORYTREE_HOME;
  process.env.STORYTREE_HOME = home;
  t.after(() => {
    if (before === undefined) delete process.env.STORYTREE_HOME;
    else process.env.STORYTREE_HOME = before;
    return removeTemp(home);
  });
  const plugin = path.join(home, "factory", "plugins", "my-lab");
  mkdirSync(plugin, { recursive: true });
  writeFileSync(path.join(plugin, "package.json"), JSON.stringify({ name: "my-lab", type: "module", exports: { "./verbs": "./verbs.js" }, storytree: { interface: 1, for: "experiments", verbs: [{ from: "./verbs", export: "families" }] } }));
  writeFileSync(path.join(plugin, "verbs.js"), `export const families = [{ name: "lab", summary: "my lab", order: 27, verbs: [{ command: { family: "lab", name: "run", summary: "s" }, tool: { absent: "no" }, inputs: {}, callerless: true, act: async () => ({ text: "ran" }) }] }];\n`);
  writeFileSync(path.join(home, "settings.json"), JSON.stringify({ factory: path.join(home, "factory") }));
  await withProject(async ({ folder }) => {
    await withAgent(folder, {}, async (agent) => {
      const checked = await agent.call("check_plugin", { plugin: "my-lab" });
      assert.equal(checked.isError, false, checked.text);
      assert.match(checked.text, /^my-lab stands in for experiments, which provides what my-lab does not: the commands experiment freeze, experiment curves\b/m);
    });
  });
});
