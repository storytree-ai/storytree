// Capability 9 · Context readings
import { verb, type Verb, type VerbInputs, type VerbPlace } from "@storytree/library/verbs";

export const CONTEXT_READING: Verb<VerbInputs, VerbPlace> = verb({
  command: { family: "context", name: "context", summary: "how many tokens this agent session's context holds right now" },
  tool: { absent: "Session management's own read_context tool answers this" },
  inputs: { json: { kind: "switch", describe: "the reading record as JSON" } },
  callerless: true,
  async act({ json }, { folder }: VerbPlace) {
    const { contextCommand } = await import("./command.js");
    const { text } = await contextCommand({ folder, env: process.env, json });
    return { text };
  },
});
