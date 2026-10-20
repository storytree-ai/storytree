/** Capability 6 · Agent tools: the other stories' tools the server mounts, read from their packages' manifests (ADR-1021). */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { librarianToolParts } from "@storytree/library/librarian";
import { qualityToolParts } from "@storytree/quality-assurance";
import { hookToolParts } from "@storytree/session-management";

import toolParts from "../parts/tools.js";
import { createAgentTools, type ToolPart } from "./server.js";

// The stories restate the server's extension point rather than import it (ADR-1017 D2); this is where the two are checked to fit.
const declared: readonly ToolPart[] = [...librarianToolParts, ...qualityToolParts, ...hookToolParts];

test("6.75 the tool server mounts the tool parts its story packages' manifests name: the librarian's, then quality assurance's, then Session management's hook event tool, each given the project served and the server's tool names", () => {
  assert.equal(import.meta.resolve("#parts/tools"), new URL("../parts/tools.ts", import.meta.url).href, "the package's #parts/tools is its composing module");
  assert.deepEqual(toolParts.parts, declared);
  const tools = () => ["check_setup"];
  const served = (project: string | undefined) => toolParts.parts.map((part) => part({ project, tools }) !== undefined);
  assert.deepEqual(served("storytree"), [true, true, true], "storytree's own library gets the librarian's tools, quality assurance's and the hook event tool");
  assert.deepEqual(served("another-project"), [false, true, true], "another project gets quality assurance's and the hook event tool, not the librarian's (ADR-0644 U1)");
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
  const qualityOff = await served(["quality-assurance"]);
  assert.ok(!qualityOff.includes("quality_brief"), "quality assurance's tools are not served");
  assert.ok(qualityOff.includes("hook_event") && qualityOff.includes("check_setup"), "the rest still are");
  const frictionOff = await served(["friction"]);
  assert.ok(!frictionOff.includes("hook_event") && !frictionOff.includes("quality_brief"), "Session management stands on friction, and quality assurance on it: theirs go with it");
});
