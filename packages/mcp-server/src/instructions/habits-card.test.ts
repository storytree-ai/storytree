/**
 * Capability 7 · Instructions, the habits card: one test per contract 7.1-7.3, 7.5 and 7.8 to 7.11 in
 * the MCP server story. The card names each tool in backticks, and uses backticks for nothing
 * else, so the tools it teaches are exactly the backticked words in it. Whether real agents follow
 * it is the app setup's setup check.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";

import { createAgentTools } from "../index.js";
import { storyParts } from "@storytree/plugin-loader";
import { setupGuidance } from "@storytree/app-setup/setup";
import { decisionRights } from "@storytree/project-and-caller";
import { qualityGuidance } from "@storytree/quality-assurance";
import { CONTRACT_DEFINITION, habitsCard } from "./habits.js";

/** A client connected in memory to a fresh tool server, as a harness is at session start. */
async function sessionStart(harness = "claude-code", off?: readonly string[]): Promise<{ client: Client; harnessTools: readonly string[]; close(): Promise<void> }> {
  // A user's folder, not this checkout: storytree's own project also serves the librarian's tools.
  const folder = mkdtempSync(path.join(tmpdir(), "habits-card-"));
  // The folder is its own storytree home, so no machine's settings (a part off, a plugin standing in) change the card;
  // parts switched off are named there.
  if (off !== undefined) writeFileSync(path.join(folder, "settings.json"), JSON.stringify({ "parts-off": off }));
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

test("7.12 with a part switched off, the card handed at session start leaves out its section and those of the parts standing on it, names them switched off, and names no tool the server lacks", async () => {
  // Code review stands on Architecture checks, so switching that off takes code review with it; App setup no longer stands on code review (ADR-1170 D2).
  const session = await sessionStart("claude-code", ["guardrails"]);
  try {
    const card = session.client.getInstructions() ?? "";
    const offered = (await session.client.listTools()).tools.map((tool) => tool.name).filter((tool) => !session.harnessTools.includes(tool)).sort();
    const taught = [...new Set([...card.matchAll(/`([^`]+)`/g)].map(([, name]) => name!))].sort();
    assert.deepEqual(taught.filter((tool) => !offered.includes(tool)), [], "every tool it teaches is served");
    assert.ok(!taught.includes("quality_brief") && !offered.includes("quality_brief"), "quality assurance's tools are neither served nor taught");
    assert.match(card, /Switched off on this computer, so not served here: guardrails, quality-assurance\. The user switches one on with: storytree settings set part <part> on/);
    for (const section of qualityGuidance) assert.ok(!card.includes(section), `its section is left out: ${section.slice(0, 60)}`);
    for (const section of setupGuidance) assert.ok(card.includes(section), `App setup's section stays: ${section.slice(0, 60)}`);
    for (const tool of ["check_setup", "set_up_project", "wire_pipeline"]) assert.ok(taught.includes(tool) && offered.includes(tool), `${tool} is still served and taught`);
  } finally {
    await session.close();
  }
});

test("7.13 with code review switched off, the card still tells the agent to record its work on the plan, and holds none of the build loop's stops", async () => {
  // What paints the map stays in base when code review moves to a plugin (ADR-1209 D2): the reported column, landed and
  // built capabilities, closed increments and the session's close-out.
  const session = await sessionStart("claude-code", ["quality-assurance"]);
  try {
    const card = session.client.getInstructions() ?? "";
    const taught = new Set([...card.matchAll(/`([^`]+)`/g)].map(([, name]) => name!));
    for (const tool of ["report", "land", "mark_built", "read_context", "close_increment", "park_increment", "close_out"]) assert.ok(taught.has(tool), `the card does not teach ${tool}`);
    assert.doesNotMatch(card, /STOP|Red, then green/, "a stop of the build loop is still on the card");
  } finally {
    await session.close();
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
  for (const story of ["@storytree/app-setup", "@storytree/library", "@storytree/map", "@storytree/project-and-caller", "@storytree/quality-assurance", "@storytree/session-management"]) {
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
