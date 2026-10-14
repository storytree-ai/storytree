/**
 * Capability 7 · Instructions, the habits card: one test per contract 7.1-7.3, 7.5 and 7.8 to 7.10 in
 * the MCP server story. The card names each tool in backticks, and uses backticks for nothing
 * else, so the tools it teaches are exactly the backticked words in it. Whether real agents follow
 * it is the app setup's setup check.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";

import { createAgentTools } from "../index.js";
import { storyParts } from "@storytree/plugin-loader";
import { decisionRights } from "@storytree/project-and-caller";
import { CONTRACT_DEFINITION, habitsCard } from "./habits.js";

/** A client connected in memory to a fresh tool server, as a harness is at session start. */
async function sessionStart(harness = "claude-code"): Promise<{ client: Client; close(): Promise<void> }> {
  // A user's folder, not this checkout: storytree's own project also serves the librarian's tools.
  const folder = mkdtempSync(path.join(tmpdir(), "habits-card-"));
  const tools = createAgentTools({ folder, env: {} });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await tools.server.connect(serverSide);
  const client = new Client({ name: harness, version: "test" });
  await client.connect(clientSide);
  return {
    client,
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
    const offered = (await session.client.listTools()).tools.map((tool) => tool.name).sort();
    const taught = [...new Set([...habitsCard().matchAll(/`([^`]+)`/g)].map(([, name]) => name!))].sort();
    assert.deepEqual(taught, offered);
    for (const tool of ["list_own_runs", "list_all_runs", "stop_own_run", "clear_own_runs"]) assert.ok(taught.includes(tool), tool);
  } finally {
    await session.close();
  }
});

test("7.2 the card is no longer than 60 lines", () => {
  const lines = habitsCard().trimEnd().split(/\r?\n/).length;
  assert.ok(lines <= 60, `the card is ${lines} lines`);
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
      "call `import_project` again only when the user asks",
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

test("7.10 the card handed at session start is composed from the guidance each story package the server mounts declares in its manifest, in the manifests' order, between the server's own first and last lines", async () => {
  const parts = storyParts(path.resolve(import.meta.dirname, "../.."), "guidance");
  for (const story of ["@storytree/app-setup", "@storytree/library", "@storytree/map", "@storytree/processes", "@storytree/project-and-caller", "@storytree/quality-assurance", "@storytree/session-management"]) {
    assert.ok(parts.some((part) => part.package === story), `${story} declares no guidance`);
  }
  const session = await sessionStart();
  try {
    const served = session.client.getInstructions() ?? "";
    assert.ok(served.startsWith("storytree keeps the plan of this project"), "the server's own opening is not first");
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
