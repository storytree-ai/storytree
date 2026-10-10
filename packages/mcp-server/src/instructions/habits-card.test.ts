/**
 * Capability 7 · Instructions, the habits card: one test per contract 7.1-7.3, 7.5 and 7.8 in
 * the MCP server story. The card names each tool in backticks, and uses backticks for nothing
 * else, so the tools it teaches are exactly the backticked words in it. Whether real agents follow
 * it is the agent link's setup check.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";

import { createAgentTools } from "../index.js";
import { decisionRights } from "@storytree/agent-link";
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
