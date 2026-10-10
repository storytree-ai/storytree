/**
 * Capability 1 · Front door. `storytree context` (Session management's contract 9.6, ADR-0725): how many tokens this agent
 * session's context holds, worked out now. A front door only: Session management reads it.
 */
import type { Family, Verb } from "../door.js";

const read: Verb = {
  name: "context",
  usage: "context [--json]",
  summary: "how many tokens this agent session's context holds right now",
  switches: ["json"],
  async act(args, context) {
    const { contextCommand } = await import("@storytree/session-management");
    const { text } = await contextCommand({ folder: context.cwd, env: process.env, json: args.has("json") });
    return { text };
  },
};

export const contextFamily: Family = {
  name: "context",
  summary: "how full this session's context is (Session management's)",
  verbs: [],
  bare: read,
};
