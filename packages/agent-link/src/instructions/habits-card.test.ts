/**
 * Capability 7 · Instructions, the habits card: one test per contract 7.1-7.3 in
 * the agent link story. The card names each tool in backticks, and uses backticks for nothing
 * else, so the tools it teaches are exactly the backticked words in it. Whether real agents follow
 * it is capability 8's live check.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";

import { createAgentTools } from "../tools/index.js";
import { habitsCard } from "./index.js";

/** A client connected in memory to a fresh tool server, as a harness is at session start. */
async function sessionStart(): Promise<{ client: Client; close(): Promise<void> }> {
  const tools = createAgentTools({ folder: process.cwd(), env: {} });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await tools.server.connect(serverSide);
  const client = new Client({ name: "claude-code", version: "test" });
  await client.connect(clientSide);
  return {
    client,
    async close() {
      await client.close();
      await tools.close();
    },
  };
}

test("7.1 the card names every tool the server has, and no tool the server lacks", async () => {
  const session = await sessionStart();
  try {
    const offered = (await session.client.listTools()).tools.map((tool) => tool.name).sort();
    const taught = [...new Set([...habitsCard().matchAll(/`([^`]+)`/g)].map(([, name]) => name!))].sort();
    assert.deepEqual(taught, offered);
  } finally {
    await session.close();
  }
});

test("7.2 the card is no longer than 60 lines", () => {
  const lines = habitsCard().trimEnd().split(/\r?\n/).length;
  assert.ok(lines <= 60, `the card is ${lines} lines`);
});

test("7.3 the tool server hands the card to the agent at the start of every session", async () => {
  for (let session = 1; session <= 2; session++) {
    const started = await sessionStart();
    try {
      assert.equal(started.client.getInstructions(), habitsCard(), `session ${session}`);
    } finally {
      await started.close();
    }
  }
});
