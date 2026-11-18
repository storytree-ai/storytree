import assert from "node:assert/strict";

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";

import { findProject } from "@storytree/project-and-caller/routing";

import { createAgentTools, type AgentToolOptions } from "../tools/index.js";
import { testServerDataDir } from "@storytree/project-and-caller/testing/pg";

export interface Answer {
  text: string;
  isError: boolean;
  data: Record<string, unknown>;
}

export interface Agent {
  call(tool: string, args?: Record<string, unknown>, meta?: Record<string, unknown>): Promise<Answer>;
  callExactly(tool: string, args?: Record<string, unknown>, meta?: Record<string, unknown>): Promise<Answer>;
  tools(): Promise<string[]>;
  inputSchema(tool: string): Promise<Record<string, unknown>>;
  instructions(): string | undefined;
  close(): Promise<void>;
}

export interface AgentOptions extends Partial<Omit<AgentToolOptions, "folder">> {
  readonly client?: string;
  readonly meta?: Record<string, unknown>;
}

const PLACE = ["project", "arc", "increment"] as const;

export async function agentIn(folder: string, options: AgentOptions = {}): Promise<Agent> {
  const { client: clientName, meta, ...serverOptions } = options;
  const tools = createAgentTools({ dataDir: testServerDataDir(), env: {}, ...serverOptions, folder });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await tools.server.connect(serverSide);
  const client = new Client({ name: clientName ?? "claude-code", version: "test" });
  await client.connect(clientSide);
  let writes: Set<string> | undefined;
  const writing = async (tool: string): Promise<boolean> => {
    writes ??= new Set((await client.listTools()).tools.filter(({ inputSchema }) => PLACE.every((key) => key in (inputSchema.properties ?? {}))).map(({ name }) => name));
    return writes.has(tool);
  };
  const callExactly: Agent["callExactly"] = async (tool, args = {}, perCall) => {
    const sent = perCall ?? meta;
    const result = await client.callTool({ name: tool, arguments: args, ...(sent === undefined ? {} : { _meta: sent }) });
    const content = result.content as { type: string; text?: string }[];
    return {
      text: content.map((block) => block.text ?? "").join("\n"),
      isError: result.isError === true,
      data: (result.structuredContent ?? {}) as Record<string, unknown>,
    };
  };
  return {
    async call(tool, args = {}, perCall) {
      if (PLACE.some((key) => key in args) || !(await writing(tool))) return callExactly(tool, args, perCall);
      const found = findProject(folder);
      return callExactly(tool, found.project === undefined ? args : { ...args, project: found.project }, perCall);
    },
    callExactly,
    async tools() {
      return (await client.listTools()).tools.map((tool) => tool.name).sort();
    },
    async inputSchema(tool) {
      const listed = (await client.listTools()).tools.find((each) => each.name === tool);
      assert.ok(listed, `${tool} is listed`);
      return listed.inputSchema as Record<string, unknown>;
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

export async function withAgent(folder: string, options: AgentOptions, body: (agent: Agent) => Promise<void>): Promise<void> {
  const agent = await agentIn(folder, options);
  try {
    await body(agent);
  } finally {
    await agent.close();
  }
}

export function claudeCode(session: string, extra: AgentOptions = {}): AgentOptions {
  return { client: "claude-code", ...extra, env: { CLAUDE_CODE_SESSION_ID: session, ...extra.env } };
}

export function codex(session: string, extra: AgentOptions = {}): AgentOptions {
  return { client: "codex-mcp-client", meta: { threadId: session, sessionId: session }, ...extra };
}

export function idOf(answer: Answer): string {
  assert.equal(answer.isError, false, answer.text);
  const { id } = answer.data;
  assert.equal(typeof id, "string", `an id in ${JSON.stringify(answer.data)}`);
  return id as string;
}
