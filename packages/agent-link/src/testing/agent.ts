/**
 * An agent for the agent link's tests: a tool server (capability 6) and an MCP client connected to
 * it in memory, as Claude Code or Codex would be, with no real agent and no network. Claude Code's
 * session id reaches the server in its environment; Codex's on each call's `_meta`.
 */
import assert from "node:assert/strict";

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";

import { createAgentTools, type AgentToolOptions } from "../tools/index.js";
import { testServerDataDir } from "./pg.js";

export interface Answer {
  text: string;
  isError: boolean;
  /** What the tool handed back as data, beside its sentence. */
  data: Record<string, unknown>;
}

export interface Agent {
  call(tool: string, args?: Record<string, unknown>, meta?: Record<string, unknown>): Promise<Answer>;
  tools(): Promise<string[]>;
  instructions(): string | undefined;
  close(): Promise<void>;
}

export interface AgentOptions extends Partial<Omit<AgentToolOptions, "folder">> {
  /** The client's name: `claude-code` (the default) or `codex-mcp-client`, as each harness calls itself. */
  readonly client?: string;
  /** Sent on every call, as Codex sends its session id. */
  readonly meta?: Record<string, unknown>;
}

/** A tool server for `folder`, and a client connected to it in memory, as a harness would be. */
export async function agentIn(folder: string, options: AgentOptions = {}): Promise<Agent> {
  const { client: clientName, meta, ...serverOptions } = options;
  const tools = createAgentTools({ dataDir: testServerDataDir(), env: {}, ...serverOptions, folder });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await tools.server.connect(serverSide);
  const client = new Client({ name: clientName ?? "claude-code", version: "test" });
  await client.connect(clientSide);
  return {
    async call(tool, args = {}, perCall) {
      const sent = perCall ?? meta;
      const result = await client.callTool({ name: tool, arguments: args, ...(sent === undefined ? {} : { _meta: sent }) });
      const content = result.content as { type: string; text?: string }[];
      return {
        text: content.map((block) => block.text ?? "").join("\n"),
        isError: result.isError === true,
        data: (result.structuredContent ?? {}) as Record<string, unknown>,
      };
    },
    async tools() {
      return (await client.listTools()).tools.map((tool) => tool.name).sort();
    },
    instructions() {
      return client.getInstructions();
    },
    async close() {
      await client.close();
      await tools.close();
    },
  };
}

/** Run `body` with an agent, and close it afterwards. */
export async function withAgent(folder: string, options: AgentOptions, body: (agent: Agent) => Promise<void>): Promise<void> {
  const agent = await agentIn(folder, options);
  try {
    await body(agent);
  } finally {
    await agent.close();
  }
}

/** Claude Code, session `session`: its id in the server's environment. */
export function claudeCode(session: string, extra: AgentOptions = {}): AgentOptions {
  return { client: "claude-code", ...extra, env: { CLAUDE_CODE_SESSION_ID: session, ...extra.env } };
}

/** Codex, session `session`: its id on every call, as Codex 0.155 sends it. */
export function codex(session: string, extra: AgentOptions = {}): AgentOptions {
  return { client: "codex-mcp-client", meta: { threadId: session, sessionId: session }, ...extra };
}

/** The id a planning or writing tool handed back. */
export function idOf(answer: Answer): string {
  assert.equal(answer.isError, false, answer.text);
  const { id } = answer.data;
  assert.equal(typeof id, "string", `an id in ${JSON.stringify(answer.data)}`);
  return id as string;
}
