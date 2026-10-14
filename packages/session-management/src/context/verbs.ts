/**
 * Capability 9 · Context readings. `storytree context` (contract 9.6, ADR-0725), declared once (ADR-0969 D2, ADR-1033): how many
 * tokens this agent session's context holds, worked out now. It needs no caller: it answers outside a project, or in a
 * folder not approved, opening nothing. The command line mounts it as its `context` family (SESSION_FAMILIES); the MCP
 * server answers the same through its own read_context tool.
 */
import { verb, type Verb, type VerbInputs, type VerbPlace } from "@storytree/library/verbs";

/** `storytree context [--json]`, the bare verb of the command line's `context` family. */
export const CONTEXT_READING: Verb<VerbInputs, VerbPlace> = verb({
  command: { family: "context", name: "context", summary: "how many tokens this agent session's context holds right now" },
  tool: { absent: "the MCP server answers this with its own read_context tool" },
  inputs: { json: { kind: "switch", describe: "the reading record as JSON" } },
  callerless: true,
  async act({ json }, { folder }: VerbPlace) {
    const { contextCommand } = await import("./command.js");
    const { text } = await contextCommand({ folder, env: process.env, json });
    return { text };
  },
});
