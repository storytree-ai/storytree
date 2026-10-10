/**
 * Capability 1 · Front door. `storytree quality …`: the quality assurance story's work (ADR-0956), its
 * checks and ledger readings the same as its tools on the MCP server give (that story's contracts 1.2 and 3.4).
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

const ledgerVerb: Verb = {
  name: "ledger",
  usage: "quality ledger",
  summary: "the QA ledger's counts: per check and package, the reviews that ran it and its hits by answer",
  async act(_args, context) {
    const { ledgerText, openLedger } = await import("@storytree/quality-assurance");
    const library = await context.library();
    return { text: ledgerText(await (await openLedger(await context.server())).reading(library.name)) };
  },
};

export const quality: Family = {
  name: "quality",
  summary: "read the quality control checks a change-reviewer applies, and what the QA ledger counts of them",
  verbs: [checksVerb, ledgerVerb],
};
