/**
 * Capability 7 · Instructions, the habits card: one test per contract 7.1-7.3, 7.5 and 7.8 to 7.22 in
 * the MCP server story. The card names each tool in backticks, and uses backticks for nothing
 * else, so the tools it teaches are exactly the backticked words in it. Whether real agents follow
 * it is the app setup's setup check.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";

import { createAgentTools } from "../index.js";
import { storyParts } from "@storytree/plugin-loader";
import { SMALL_FIXES_ARC } from "@storytree/app-setup/project";
import { setupGuidance } from "@storytree/app-setup/setup";
import { decisionRights, readStandIns } from "@storytree/project-and-caller";
import { CONCEPTS } from "@storytree/shown-words";
import { CONTRACT_DEFINITION, habitsCard } from "./habits.js";

/** A client connected in memory to a fresh tool server, as a harness is at session start. */
async function sessionStart(harness = "claude-code", off?: readonly string[]): Promise<{ client: Client; harnessTools: readonly string[]; close(): Promise<void> }> {
  // A user's folder, not this checkout: storytree's own project also serves the librarian's tools.
  const folder = mkdtempSync(path.join(tmpdir(), "habits-card-"));
  // The folder is its own storytree home, so no machine's settings (a module off, a plugin standing in) change the card;
  // modules switched off are named there.
  if (off !== undefined) writeFileSync(path.join(folder, "settings.json"), JSON.stringify({ "modules-off": off }));
  const tools = createAgentTools({ folder, env: {}, setup: { storytreeHome: folder } });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await tools.server.connect(serverSide);
  const client = new Client({ name: harness, version: "test" });
  await client.connect(clientSide);
  return {
    client,
    harnessTools: tools.harnessTools,
    async close() {
      await client.close();
      await tools.close();
      rmSync(folder, { recursive: true, force: true });
    },
  };
}

test("7.1 the card names every tool the server has, and no tool the server lacks", async () => {
  const session = await sessionStart();
  try {
    // A harness's own tools are for it, not the agent, so the card leaves them off (ADR-1056 D2).
    const offered = (await session.client.listTools()).tools.map((tool) => tool.name).filter((tool) => !session.harnessTools.includes(tool)).sort();
    const taught = [...new Set([...habitsCard().matchAll(/`([^`]+)`/g)].map(([, name]) => name!))].sort();
    assert.deepEqual(taught, offered);
    for (const tool of ["list_own_runs", "list_all_runs", "stop_own_run", "clear_own_runs"]) assert.ok(taught.includes(tool), tool);
  } finally {
    await session.close();
  }
});

test("7.12 with a module switched off, the card handed at session start leaves out its section and those of the modules standing on it, names them switched off, and names no tool the server lacks", async () => {
  const session = await sessionStart("claude-code", ["arc-surface"]);
  try {
    const card = session.client.getInstructions() ?? "";
    const offered = (await session.client.listTools()).tools.map((tool) => tool.name).filter((tool) => !session.harnessTools.includes(tool)).sort();
    const taught = [...new Set([...card.matchAll(/`([^`]+)`/g)].map(([, name]) => name!))].sort();
    assert.deepEqual(taught.filter((tool) => !offered.includes(tool)), [], "every tool it teaches is served");
    assert.match(card, /Switched off on this computer, so not served here: arc-surface\. The user switches one on with: storytree settings set module <module> on/);
    for (const section of setupGuidance) assert.ok(card.includes(section), `App setup's section stays: ${section.slice(0, 60)}`);
    for (const tool of ["check_setup", "set_up_project", "wire_pipeline"]) assert.ok(taught.includes(tool) && offered.includes(tool), `${tool} is still served and taught`);
  } finally {
    await session.close();
  }
});

test("7.13 with code review a factory plugin's, the card storytree hands still tells the agent to record its work on the plan, and holds none of the build loop's stops", async () => {
  // What paints the map stays in base now code review is a plugin's (ADR-1209 D2): the reported column, landed and
  // built capabilities, closed increments and the session's close-out.
  const session = await sessionStart("claude-code");
  try {
    const card = session.client.getInstructions() ?? "";
    const taught = new Set([...card.matchAll(/`([^`]+)`/g)].map(([, name]) => name!));
    for (const tool of ["report", "land", "mark_built", "read_context", "close_increment", "park_increment", "close_out"]) assert.ok(taught.has(tool), `the card does not teach ${tool}`);
    assert.doesNotMatch(card, /STOP|Red, then green/, "a stop of the build loop is still on the card");
  } finally {
    await session.close();
  }
});

test("7.14 with a factory plugin standing in for a switched-off module, the card handed at session start carries the plugin's sections in the module's place, not the module's own, and does not name the module switched off; one that cannot be loaded adds nothing and the module is named off", async () => {
  // Code review moved to a factory plugin whole, its section with it (ADR-1209 D1): the card is where a plugin's section reaches an agent.
  const folder = mkdtempSync(path.join(tmpdir(), "habits-card-factory-"));
  try {
    const plugin = path.join(folder, "factory", "plugins", "my-setup");
    mkdirSync(plugin, { recursive: true });
    writeFileSync(path.join(plugin, "package.json"), JSON.stringify({ name: "my-setup", type: "module", exports: { "./guidance": "./guidance.js" }, storytree: { interface: 1, guidance: [{ from: "./guidance", export: "guidance" }] } }));
    writeFileSync(path.join(plugin, "guidance.js"), `export const guidance = ["Review each change with the reviewer before the gate."];\n`);
    const settings = (standIn: string) => ({ factory: path.join(folder, "factory"), "modules-off": ["app-setup"], "stand-ins": { "app-setup": standIn } });
    const card = (off: readonly string[], standIn: string) => {
      const home = mkdtempSync(path.join(folder, "home-"));
      writeFileSync(path.join(home, "settings.json"), JSON.stringify(settings(standIn)));
      return habitsCard(off, readStandIns(home));
    };
    const stoodIn = card(["app-setup"], "my-setup");
    assert.ok(stoodIn.includes("Review each change with the reviewer before the gate."), "the plugin's section is on the card");
    for (const section of setupGuidance) assert.ok(!stoodIn.includes(section), `the module's own section is left out: ${section.slice(0, 60)}`);
    assert.doesNotMatch(stoodIn, /Switched off on this computer/, "a module stood in for is served, not named off");
    assert.ok(stoodIn.indexOf("Review each change") < stoodIn.indexOf("If storytree says it isn't running"), "before the closing line");
    const missing = card(["app-setup"], "no-such-plugin");
    assert.ok(!missing.includes("Review each change"), "a plugin that cannot be loaded adds nothing");
    assert.match(missing, /Switched off on this computer, so not served here: app-setup\./);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("7.3 the tool server hands the card to the agent at the start of every session", async () => {
  for (const session of ["claude-code", "codex-mcp-client"]) {
    const started = await sessionStart(session);
    try {
      assert.equal(started.client.getInstructions(), habitsCard(), `session ${session}`);
    } finally {
      await started.close();
    }
  }
});

test("7.5 the card handed at session start says who decides what, and what no file moves", async () => {
  const rights = decisionRights();
  for (const kinds of [rights.decides, rights.asks, rights.honesty]) assert.ok(kinds.length > 0);
  const session = await sessionStart();
  try {
    const served = session.client.getInstructions() ?? "";
    for (const line of [...rights.decides, ...rights.asks, rights.delegations, rights.override, ...rights.honesty]) {
      assert.ok(served.includes(line), `the served card lacks: ${line}`);
    }
    const decides = served.split("\n").find((line) => line.startsWith("- Decide yourself")) ?? "";
    // ADR-1273 D1: alone, only a call with no trade-off that is reversible.
    for (const test of ["no trade-off", "same outputs", "no new dependency", "no contract or user-facing change", "reversible"]) {
      assert.ok(decides.includes(test), `the card's decides line names ${test}: ${decides}`);
    }
    const asks = served.split("\n").find((line) => line.startsWith("- Ask the owner before")) ?? "";
    assert.ok(asks.includes("trade-off"), `the card's asks line sends any trade-off to the owner: ${asks}`);
  } finally {
    await session.close();
  }
});

test("7.8 the card handed at session start says what one contract is: a behaviour seen from outside, in its inputs, outputs and errors", async () => {
  assert.equal(CONTRACT_DEFINITION.split(/(?<=\.) /).length, 2, "two sentences");
  for (const word of ["outside", "inputs", "outputs", "errors"]) assert.ok(CONTRACT_DEFINITION.includes(word), `the definition lacks: ${word}`);
  const session = await sessionStart();
  try {
    assert.ok((session.client.getInstructions() ?? "").includes(CONTRACT_DEFINITION));
  } finally {
    await session.close();
  }
});

test("7.9 the card handed at session start says how to build beside mapped code", async () => {
  const session = await sessionStart();
  try {
    const served = session.client.getInstructions() ?? "";
    // One phrase for each thing ADR-0993 D4 and D8 to D11, as ADR-1015 narrows them, has the agent do beside mapped code.
    for (const said of [
      "Before changing or deleting anything in the imported project, stop and ask the user",
      "change it there, bring that part into this project, retire it, or leave it and build on top",
      "Do what the user says",
      "do not watch the old project for changes",
      "import it again only when the user asks",
      "depending on the mapped package by a link:",
      "Old code never imports new code",
      "Test the interface your package has with the old code",
      "give `focus` the part's folders as its crossing",
      // ADR-1020: a part of the screens is brought in by bringing in what serves them whole, and how, measured on Next.js.
      "bringing in what serves the screens whole",
      "turbopack.root",
      "its node_modules a link to the old project's",
      "storytree does not draw or watch it",
    ]) assert.ok(served.includes(said), `the served card lacks: ${said}`);
    // ADR-1015: bringing in what serves the UI is one answer the user can give, not the agent's first move.
    assert.ok(!served.includes("bring in whatever serves its UI"), "the card still sends the agent to bring in the UI first");
  } finally {
    await session.close();
  }
});

test("7.10 the card handed at session start is composed from the guidance each story package the server mounts declares in its manifest, in the manifests' order, between the server's own opening and closing lines", async () => {
  const parts = storyParts(path.resolve(import.meta.dirname, "../.."), "guidance");
  for (const story of ["@storytree/app-setup", "@storytree/library", "@storytree/map", "@storytree/project-and-caller", "@storytree/session-management"]) {
    assert.ok(parts.some((part) => part.package === story), `${story} declares no guidance`);
  }
  const session = await sessionStart();
  try {
    const served = session.client.getInstructions() ?? "";
    assert.ok(served.startsWith("storytree keeps this project's plan"), "the server's own opening is not first");
    assert.ok(served.endsWith("If storytree says it isn't running, carry on without it."), "the server's own closing is not last");
    let after = 0;
    for (const part of parts) {
      const declared = ((await import(part.module)) as Record<string, readonly string[]>)[part.export]!;
      for (const section of declared) {
        const at = served.indexOf(section, after);
        assert.ok(at >= after, `the served card lacks ${part.module}'s ${part.export}, in its place: ${section.slice(0, 60)}`);
        after = at + section.length;
      }
    }
  } finally {
    await session.close();
  }
});

test("7.11 the part of the card Claude Code keeps, its first 2,048 characters, tells the agent to plan work the user asks for in storytree before building it, even when the user never mentions storytree (regression: the stable acceptance run's first builds planned nothing, 2026-10-16)", async () => {
  const session = await sessionStart();
  try {
    const kept = (session.client.getInstructions() ?? "").slice(0, 2048);
    for (const said of [
      "When the user asks you to build or change something, plan it in storytree before you build it",
      "even when they never mention storytree and the work is small",
    ]) assert.ok(kept.includes(said), `the card's first 2,048 characters lack: ${said}`);
  } finally {
    await session.close();
  }
});

test("7.15 the card handed at session start says the layout the map draws for Python as for JavaScript: a story's pyproject.toml package with its module under src, and a test carrying its contract number in its name", async () => {
  const session = await sessionStart();
  try {
    const served = session.client.getInstructions() ?? "";
    for (const said of ["packages/<story>/pyproject.toml", "src/<module>", "test_2_3_", "test_<package>_2_3_", "a docstring's number is for reading only"]) {
      assert.ok(served.includes(said), `the served card lacks: ${said}`);
    }
  } finally {
    await session.close();
  }
});

test("7.16 the card handed at session start says to park and claim a change's increment before building it, never afterwards, and to park a small fix that adds or changes no contract on the project's small-fixes arc, anything bigger on an arc of its own", async () => {
  const session = await sessionStart();
  try {
    const served = session.client.getInstructions() ?? "";
    for (const said of [
      "Park the change's increment with `park_increment` and `claim` it before you build, never afterwards to record work already done",
      "A small fix, one that adds or changes no contract",
      `one increment with a one-line objective on this project's standing small-fixes arc "${SMALL_FIXES_ARC}"`,
      "no new story, capability or contract",
      "anything bigger goes on an arc of its own",
    ]) assert.ok(served.includes(said), `the served card lacks: ${said}`);
  } finally {
    await session.close();
  }
});

test("7.17 the card handed at session start says the packages/<story> layout is for new stories, and that an existing repository's code is drawn in place once `import_project` maps it (regression: an agent on an unimported flat repository told the user the map could not draw it, 2026-11-06)", async () => {
  const session = await sessionStart();
  try {
    const served = session.client.getInstructions() ?? "";
    for (const said of [
      "This is the layout for new stories",
      "An existing repository's code, whatever its layout, is drawn where it is once `import_project` maps it",
    ]) assert.ok(served.includes(said), `the served card lacks: ${said}`);
  } finally {
    await session.close();
  }
});

test("7.18 · the card handed at session start says mapping an existing repository includes running its tests, in the agent's own shell (ADR-1275 D3)", async () => {
  const session = await sessionStart();
  try {
    const served = session.client.getInstructions() ?? "";
    assert.ok(served.includes("Mapping includes running the repository's tests in your shell"), "the served card says mapping runs the tests");
  } finally {
    await session.close();
  }
});

test("7.19 · the card handed at session start says that once an imported repository's tests have run, the agent plans one arc whose increments fix its red capabilities, each naming its capability, and carry the user's own requests (ADR-1271)", async () => {
  const session = await sessionStart();
  try {
    const served = session.client.getInstructions() ?? "";
    assert.ok(served.includes("planning one arc: an increment per red capability, naming it"), "the served card asks for the one fix arc");
    assert.ok(served.includes("naming it, and the user's own requests"), "the served card carries the user's requests on it");
  } finally {
    await session.close();
  }
});

test("7.20 · the card handed at session start and plan_contract's description say a contract goes on the part whose behaviour it pins, a guarantee between two parts on their edge, even when every test drives one entry point (regression: the sixth checkbox guided run planned all 21 contracts on its HTTP entry point, 2026-11-09)", async () => {
  const session = await sessionStart();
  try {
    const served = session.client.getInstructions() ?? "";
    const { tools } = await session.client.listTools();
    const planContract = tools.find((tool) => tool.name === "plan_contract")?.description ?? "";
    for (const [where, text] of [["the served card", served], ["plan_contract's description", planContract]] as const) {
      assert.ok(text.includes("A contract goes on the part whose behaviour it pins"), `${where} places a contract on the part it pins`);
      assert.ok(text.includes("even when every test drives one entry point"), `${where} places it there though the tests enter elsewhere`);
      assert.ok(text.includes("a guarantee between two parts on their edge"), `${where} places a guarantee between two parts on their edge`);
    }
  } finally {
    await session.close();
  }
});

test("7.21 · the card handed at session start and plan_contract's description say to plan contracts from where each fault was found, not from the test list (regression: the ninth checkbox guided run put all 15 planned contracts on its HTTP entry point, 2026-11-12)", async () => {
  const session = await sessionStart();
  try {
    const served = session.client.getInstructions() ?? "";
    const { tools } = await session.client.listTools();
    const planContract = tools.find((tool) => tool.name === "plan_contract")?.description ?? "";
    for (const [where, text] of [["the served card", served], ["plan_contract's description", planContract]] as const) {
      assert.ok(text.includes("plan from where you found each fault, not from the test list"), `${where} plans from the diagnosis, not the tests`);
    }
  } finally {
    await session.close();
  }
});

test("7.22 · the card handed at session start says the tools use the library's words for capability, arc and increment, and names the shown word the user sees for each, read from the one table of shown words (ADR-1318)", async () => {
  const session = await sessionStart();
  try {
    const served = session.client.getInstructions() ?? "";
    for (const concept of ["capability", "arc", "increment"] as const) {
      assert.ok(served.includes(`"${CONCEPTS[concept].one}" for ${concept}`), `the served card names no shown word for ${concept}`);
    }
  } finally {
    await session.close();
  }
});
