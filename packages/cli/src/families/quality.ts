/**
 * Capability 1 · Front door. `storytree quality …`: the quality assurance story's work (ADR-0956), its
 * checks reading the same as its tool on the MCP server gives (that story's contract 1.2).
 */
import type { Family, Verb } from "../door.js";

const checksVerb: Verb = {
  name: "checks",
  usage: "quality checks",
  summary: "every live quality control check: its question and the notes it enforces",
  async act(_args, context) {
    const { checks, checksText } = await import("@storytree/quality-assurance");
    const reading = await checks(await context.library());
    return {
      text: checksText(reading),
      ...(reading.length === 0 ? {} : { next: [{ command: "storytree library read <check>", why: "read one check whole" }] }),
    };
  },
};

export const quality: Family = {
  name: "quality",
  summary: "read the quality control checks a change-reviewer applies",
  verbs: [checksVerb],
};
