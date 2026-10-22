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
import { hookToolParts } from "@storytree/session-management";
import { sessionToolParts } from "@storytree/session-management/tools";

import toolParts from "../parts/tools.js";
import { createAgentTools, type ToolPart } from "./server.js";

// The stories restate the server's extension point rather than import it (ADR-1017 D2); this is where the two are checked to fit.
const declared: readonly ToolPart[] = [...librarianToolParts, ...qualityToolParts, ...hookToolParts, ...sessionToolParts, ...mapToolParts, ...setupToolParts];

test("6.75 the tool server mounts the tool parts its story packages' manifests name: the librarian's, then quality assurance's, then Session management's hook event tool and its claim, landing, context and runs tools, then the map's, then App setup's, each given the project served and the server's tool names", () => {
  assert.equal(import.meta.resolve("#parts/tools"), new URL("../parts/tools.ts", import.meta.url).href, "the package's #parts/tools is its composing module");
  assert.deepEqual(toolParts.parts, declared);
  const tools = () => ["check_setup"];
  const served = (project: string | undefined) => toolParts.parts.map((part) => part({ project, tools, imports: async () => [], heldBack: () => undefined }) !== undefined);
  assert.deepEqual(served("storytree"), [true, true, true, true, true, true], "storytree's own library gets the librarian's tools, quality assurance's, Session management's, the map's and App setup's");
  assert.deepEqual(served("another-project"), [false, true, true, true, true, true], "another project gets all but the librarian's (ADR-0644 U1)");
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

test("6.98 with a factory folder chosen and a factory plugin named to stand in for experiments, a part nothing stands on, the tool server serves the plugin's verb tools where experiments' were, and not once experiments is on again", async (t) => {
  const folder = mkdtempSync(path.join(tmpdir(), "stand-in-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const plugin = path.join(folder, "factory", "plugins", "my-health");
  mkdirSync(plugin, { recursive: true });
  writeFileSync(path.join(plugin, "package.json"), JSON.stringify({ name: "my-health", type: "module", exports: { "./verbs": "./verbs.js" }, storytree: { verbs: [{ from: "./verbs", export: "families" }] } }));
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
