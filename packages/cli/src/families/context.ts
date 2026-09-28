/**
 * `storytree context` (the agent link's contract 9.6, ADR-0725): how many tokens this agent
 * session's context holds, worked out now. A front door only: the agent link reads it.
 */
import { contextCommand } from "@storytree/agent-link";

import type { Family, Verb } from "../door.js";

const read: Verb = {
  name: "context",
  usage: "context [--json]",
  summary: "how many tokens this agent session's context holds right now",
  switches: ["json"],
  async act(args, context) {
    const { text } = await contextCommand({ folder: context.cwd, env: process.env, json: args.has("json") });
    return { text };
  },
};

export const contextFamily: Family = {
  name: "context",
  summary: "how full this session's context is (the agent link's)",
  verbs: [],
  bare: read,
};
