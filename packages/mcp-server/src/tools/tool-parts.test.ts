/** Capability 6 · Agent tools: the other stories' tools the server mounts, read from their packages' manifests (ADR-1021). */
import assert from "node:assert/strict";
import { test } from "node:test";

import { librarianToolParts } from "@storytree/librarian";
import { qualityToolParts } from "@storytree/quality-assurance";

import toolParts from "#parts/tools";
import type { ToolPart } from "./server.js";

// The stories restate the server's extension point rather than import it (ADR-1017 D2); this is where the two are checked to fit.
const declared: readonly ToolPart[] = [...librarianToolParts, ...qualityToolParts];

test("6.75 the tool server mounts the tool parts its story packages' manifests name: the librarian's, then quality assurance's, each given the project served and the server's tool names", () => {
  assert.deepEqual(toolParts, declared);
  const tools = () => ["check_setup"];
  const served = (project: string | undefined) => toolParts.map((part) => part({ project, tools }) !== undefined);
  assert.deepEqual(served("storytree"), [true, true], "storytree's own library gets the librarian's tools and quality assurance's");
  assert.deepEqual(served("another-project"), [false, true], "another project gets quality assurance's only (ADR-0644 U1)");
});
