/**
 * Quality assurance's contract 1.2, at this front door: the real shared server serves the checks reading
 * through quality assurance's public API, the tool being the one that package registers. Kept here, beside
 * the server, because quality assurance cannot depend back on the MCP server.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { connect } from "@storytree/library";
import { checks, checksText, qualityTools } from "@storytree/quality-assurance";

import { approveCheckout, dropTestProjects, testServerUrl, uniqueProjectName } from "@storytree/agent-link/testing/pg";
import { createAgentTools } from "./index.js";

test("(quality assurance's 1.2) the shared server's quality_checks answers the package's checks reading, and the installed server serves it for storytree's own library", async () => {
  const project = uniqueProjectName();
  const storytree = await connect({ url: testServerUrl() });
  const library = await storytree.openProject(project);
  const folder = mkdtempSync(path.join(tmpdir(), "quality-tools-"));
  try {
    const principle = await library.writeKnowledge("principle", { title: "Test creation principles", description: "How a test earns its place.", statement: "A test fails if its behaviour is removed.", why: "A test that cannot fail protects nothing.", howToApply: "Delete the behaviour and watch the test fail." });
    await library.writeKnowledge("check", { title: "Tautological expected value", description: "Expected values computed as the code computes them.", question: "Is any expected value computed the way the code computes it?", enforces: [principle.id] });
    writeFileSync(path.join(folder, ".storytree.json"), JSON.stringify({ project }));
    await approveCheckout(folder, project);
    const tools = createAgentTools({ folder, dataDir: process.env.STORYTREE_TEST_PG_DATA!, env: {}, extensions: [qualityTools()], merges: { mergedPulls: async () => [] } });
    const client = new Client({ name: "claude-code", version: "test" });
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
    try {
      await tools.server.connect(serverSide);
      await client.connect(clientSide);
      const answer = await client.callTool({ name: "quality_checks", arguments: {} });
      const reading = await checks(library);
      assert.equal(reading.length, 1);
      assert.deepEqual(answer.structuredContent, { message: checksText(reading), checks: reading });
      assert.deepEqual(answer.content, [{ type: "text", text: checksText(reading) }]);
    } finally {
      await client.close();
      await tools.close();
    }

    for (const named of ["storytree", "another-project"]) {
      writeFileSync(path.join(folder, ".storytree.json"), JSON.stringify({ project: named }));
      const installed = createAgentTools({ folder, env: {} });
      const lister = new Client({ name: "claude-code", version: "test" });
      const [serverEnd, clientEnd] = InMemoryTransport.createLinkedPair();
      try {
        await installed.server.connect(serverEnd);
        await lister.connect(clientEnd);
        const names = (await lister.listTools()).tools.map((tool) => tool.name);
        assert.equal(names.includes("quality_checks"), named === "storytree", named);
      } finally {
        await lister.close();
        await installed.close();
      }
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
    await library.close();
    await storytree.close();
    await dropTestProjects([project]);
  }
});
