/**
 * Capability 6 · Agent tools, the MCP server (the MCP server story, ADR-0969 D1): the toolbox the agent calls
 * to plan work, see the plan and who is on what, claim, report red, green and landed, and search,
 * read and write notes. Each tool is a thin wrapper over the library's API and the claims, and
 * answers in a short plain sentence the agent can act on, with what it made or found as data too.
 * The habits card (capability 7) is handed to every session as the server's instructions, and the
 * setup check's two tools (capability 8) sit beside the others.
 *
 * Every call to a capability-6 tool:
 * - is routed from the folder the server works in (capability 1), afresh each time, so a project
 *   set up mid-session is found, and a storytree that has stopped is noticed;
 * - works in the folder the hook run just before the call was in, when that is in the same project:
 *   the harness starts the server where the session started, and a session that has since moved
 *   into a workspace claims on that workspace's branch, which its merge ends (6.34). A call no hook
 *   saw works in the server's own folder;
 * - answers "storytree isn't running, carry on without it" while it is not;
 * - is recorded in the agent activity log as a `tool-called` line on the calling session: Claude
 *   Code names it in the server's environment (`CLAUDE_CODE_SESSION_ID`), Codex on each call's
 *   `_meta` (`sessionId`, or `threadId` before Codex 0.155), the same ids their hooks see. When the
 *   hook run just before the call named another session, it is that one: after Claude Code's
 *   /clear the window is a new session, which only its hooks see (seenCaller);
 * - knows which of the session's agents made it (ADR-0629 D2), from what the harness revealed:
 *   the line the hook before the call left under the call's id, or, for Codex, the call's own
 *   thread (agentOf);
 * - names that hook's line as the cause of its `tool-called` line and of the reads it records
 *   (ADR-0746 D2); a call no hook saw names none;
 * - ends each claim whose pull request has merged since it was taken (ADR-0643 D3);
 * - can report each phase of its work as an MCP progress notification, when the client asked for
 *   progress, and stops at its next phase once the client has cancelled it (6.41);
 * - turns a refusal from the library or the claims into a readable answer marked as an error,
 *   never a crash.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";

import { McpServer, type CallToolResult, type ServerContext } from "@modelcontextprotocol/server";
import { agentOf, callLines, endMergedClaims, findProject, idleAfterMs, lineOf, locateStorytree, requestOf, route, seenCaller, storytreeHome, type ActivityLog, type Agent, type Caller, type MergeWatch } from "@storytree/session-management";
import { type SetupOptions } from "@storytree/app-setup/setup";
import type { ProtectionReader } from "@storytree/app-setup/pipeline";
import { type Library, type Storytree, type WriteOptions } from "@storytree/library";
import { librarianTools } from "@storytree/librarian";
import { qualityTools } from "@storytree/quality-assurance";
import { appDatabaseWork } from "@storytree/processes/listing";
import type { z } from "zod";

import { habitsCard } from "../instructions/habits.js";
import { isUnreachable, libraryDown, NOT_RUNNING_ANSWER, refusalOf, result, type Answer } from "./answers.js";
import { registerClaimTools } from "./claim-tools.js";
import { registerContextTools } from "./context-tools.js";
import { Connections } from "./connections.js";
import { registerNoteTools } from "./note-tools.js";
import { registerPlanTools } from "./plan-tools.js";
import { registerMapTools } from "./map-tools.js";
import { registerSetupTools } from "./setup-tools.js";
import { registerWorkTools } from "./work-tools.js";
import { OWN_TOOLS, registerOwnTools } from "./own-tools.js";
import { registerPipelineTools } from "./pipeline-tools.js";

export { NOT_RUNNING_ANSWER, lineOf };
export type { Answer, Caller };

/** What the tool server needs to know about where it runs. */
export interface AgentToolOptions {
  /** The folder the agent works in: where the harness started the server. */
  readonly folder: string;
  /** The app's Postgres data directory, beside which its owner record is kept (as project routing reads it). */
  readonly dataDir?: string;
  /** The server's environment, where Claude Code puts its session id. By default, the process's. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** How long a claim's holder may be quiet before it can be taken over. By default, the current idle-after setting. */
  readonly quietMs?: number;
  /** How merges that end claims are watched for (ADR-0643 D3). By default, through `gh`. */
  readonly merges?: MergeWatch;
  /** How wire_pipeline reads whether a repository's plan allows branch protection (capability 11). By default, through `gh`. */
  readonly protection?: ProtectionReader;
  /** What the setup check (capability 8) works with: by default, the user's own homes and no hook command. */
  readonly setup?: Omit<SetupOptions, "folder">;
  /** Other stories' tools, served through the same routing, session attribution and refusals. */
  readonly extensions?: readonly ToolExtension[];
  /** Optional observations owned by the journey story; no tool content is passed. */
  readonly journey?: JourneyMilestones;
}

/** The completed operations the journey story may observe. */
export interface JourneyMilestones {
  hooksVerified?(): void;
  projectCreated?(): void;
  incrementClosed?(outcome: unknown): void;
}

/** A tool server, and how to close it with every connection it opened. */
export interface AgentTools {
  readonly server: McpServer;
  close(): Promise<void>;
}

/** What every tool answers in a folder that is not a storytree project. */
export const NOT_A_PROJECT_ANSWER = "this folder isn't a storytree project, so storytree has nothing to keep here; call check_setup to see what to do, or carry on without it";

/** What a tool has to work with for one call. */
export interface Call {
  readonly library: Library;
  readonly log: ActivityLog;
  /** The connection the library and log were opened on, which hands out a story's own database (ADR-0973). */
  readonly storytree: Storytree;
  readonly project: string;
  readonly caller: Caller;
  /** Library history names the resolved session; cancellation stops writes still waiting to start. */
  readonly writer: WriteOptions;
  /** The folder the agent works in. */
  readonly folder: string;
  readonly quietMs: number;
  /** Which of the session's agents made this call, as the harness revealed it (ADR-0629 D2). */
  readonly agent: Agent;
  /** The hook's `tool-requested` line for this call, by the harness's call id: the cause of the lines the call writes (ADR-0746 D2). */
  readonly request?: number;
  readonly journey?: JourneyMilestones;
  /**
   * Names the phase the call is starting, as a progress notification the client receives before
   * the answer; nothing is sent when the client asked for no progress. Rejects once the client has
   * cancelled the call, so a tool working in phases starts no further one (6.41).
   */
  progress(message: string): Promise<void>;
}

/** Registers one tool: its name, what it is for, its arguments, and what it does with them. */
export type Define = <S extends z.ZodObject>(name: string, description: string, input: S, act: (args: z.output<S>, call: Call) => Promise<Answer>) => void;

/** Another story's contribution to the one tool server (ADR-0643 D6). */
export interface ToolExtension {
  readonly registerTools?: (define: Define) => void;
  /** A short addition to the habits card, naming the added tools in backticks. */
  readonly instructions?: string;
  /** Suggest the next step after a successful landing; undefined means nothing is due. */
  readonly landNext?: (capability: string, call: Call) => Promise<string | undefined> | string | undefined;
}

export function createAgentTools(options: AgentToolOptions): AgentTools {
  // ADR-0644 U1: enable the librarian for storytree's own library first, and quality assurance's checks
  // reading with it (ADR-0956). Their behaviour stays in their packages; this is the shared registration
  // point for other stories (ADR-0643 D6).
  const servedTools = ["check_setup", "set_up_project", ...OWN_TOOLS];
  const extensions = [
    ...(findProject(options.folder).project === "storytree" ? [librarianTools({ tools: () => servedTools }), qualityTools()] : []),
    ...options.extensions ?? [],
  ];
  const instructions = [habitsCard(), ...extensions.flatMap((extension) => extension.instructions === undefined ? [] : [extension.instructions])].join("\n");
  const server = new McpServer({ name: "storytree", version: "0.3.0" }, { instructions });
  const connections = new Connections();
  const env = options.env ?? process.env;
  // A session id of its own, for a harness that names none: one server process serves one session.
  const ownSession = `storytree-mcp-${randomUUID()}`;
  const locate = options.dataDir === undefined ? {} : { dataDir: options.dataDir };
  const callerOf = (context: ServerContext): Caller => callerFrom(server, context, env, ownSession);
  // The machine whose approved trunks let this folder reach its project (ADR-0942): the home setup records them in.
  const home = options.setup?.storytreeHome ?? (options.dataDir === undefined ? storytreeHome() : path.dirname(path.resolve(options.dataDir)));

  const define: Define = (name, description, input, act) => {
    servedTools.push(name);
    const handle = async (args: unknown, context: ServerContext): Promise<CallToolResult> => {
      const where = route(options.folder, locate);
      if (where.status === "not-running") return result({ text: NOT_RUNNING_ANSWER });
      if (where.status === "not-a-project") return result({ text: NOT_A_PROJECT_ANSWER });
      const meta = metaOf(context);
      try {
        let quietMs = options.quietMs;
        const { library, log, storytree } = await connections.reach(where.library, where.project, where.identity, { folder: where.folder, home });
        // What the hooks wrote of this very call, the one run just before it (ADR-0629 D2): only those lines (contract 2.7).
        const lines = await callLines(log, where.project, meta);
        const caller = seenCaller(lines, callerOf(context), meta);
        // The hook's line for this very call, joined by the id the harness gave it: never a guess by time.
        const requested = requestOf(lines, meta);
        const request = requested?.seq;
        const cause = request === undefined ? {} : { causedBy: request };
        const folder = requested?.folder !== undefined && existsSync(requested.folder) && findProject(requested.folder).project === where.project ? requested.folder : options.folder;
        await log.append(where.project, { ...lineOf(caller), source: "tool", folder, kind: "tool-called", tool: name, ...cause });
        // A claim whose pull request has merged ends before the tool sees who holds what (ADR-0643 D3).
        await endMergedClaims({ log, project: where.project, folder, ...lineOf(caller), source: "tool", library: async () => library }, options.merges).catch(() => []);
        return result(await act(args as never, {
          library, log, storytree, project: where.project, caller,
          writer: { actor: `session:${caller.session}`, signal: context.mcpReq.signal },
          folder,
          // Read once for this call, only if it needs liveness. Independent context readings
          // still return tokens and explain unusable settings (9.7), as routing's readLibrary does.
          get quietMs() { return quietMs ??= idleAfterMs(); },
          agent: agentOf(lines, meta),
          ...(request === undefined ? {} : { request }),
          ...(options.journey === undefined ? {} : { journey: options.journey }),
          progress: progressOf(context),
        }));
      } catch (error) {
        if (isUnreachable(error)) {
          await connections.close();
          return result({ text: NOT_RUNNING_ANSWER });
        }
        return result({ text: refusalOf(error), refused: true });
      }
    };
    // The SDK checks the arguments against `input` before `handle` runs; its callback type is
    // written per schema, which a wrapper serving every tool cannot name, hence the cast.
    server.registerTool(name, { description, inputSchema: input }, handle as never);
  };

  registerSetupTools({
    server,
    folder: options.folder,
    // The storytree home is where the data directory routing reads sits, unless it is named.
    setup: { ...(options.dataDir === undefined ? {} : { storytreeHome: path.dirname(options.dataDir) }), ...options.setup },
    connections,
    callerOf,
    ...(options.journey === undefined ? {} : { journey: options.journey }),
  });
  registerPlanTools(define);
  registerMapTools(define);
  registerOwnTools({
    server,
    ...(options.dataDir === undefined ? {} : { home: path.join(path.dirname(options.dataDir), 'own') }),
    async owner(context) {
      let caller = callerOf(context);
      const meta = metaOf(context);
      let agent: Agent = caller.harness === 'codex' ? agentOf([], meta) : 'unknown';
      const where = route(options.folder, locate);
      if (where.status === 'routed') {
        try {
          const { log } = await connections.reach(where.library, where.project, where.identity, { folder: where.folder, home });
          const lines = await callLines(log, where.project, meta);
          caller = seenCaller(lines, caller, meta);
          agent = requestOf(lines, meta) || caller.harness === 'codex' ? agentOf(lines, meta) : 'unknown';
        } catch (error) {
          if (!libraryDown(error)) throw error;
          await connections.close();
        }
      }
      // Claude shares one MCP server with subagents: only a correlated hook identifies a call.
      // Codex carries its caller thread on the request, including while the app is down.
      if (caller.session === ownSession || agent === 'unknown') return undefined;
      return { ...caller, agent };
    },
    shared() {
      return [appDatabaseWork(locateStorytree(locate).running)];
    },
  });
  registerClaimTools(define, extensions, options.merges);
  registerWorkTools(define);
  registerNoteTools(define);
  registerPipelineTools(define, options.protection);
  registerContextTools(define, options.dataDir === undefined ? undefined : path.dirname(path.resolve(options.dataDir)));
  for (const extension of extensions) extension.registerTools?.(define);

  return {
    server,
    async close() {
      await server.close();
      await connections.close();
    },
  };
}

/**
 * Who is calling. The harness from the client's name (Claude Code calls itself `claude-code`, Codex
 * `codex-mcp-client`); the session from where that harness puts it.
 */
function callerFrom(server: McpServer, context: ServerContext, env: Readonly<Record<string, string | undefined>>, ownSession: string): Caller {
  const client = server.server.getClientVersion()?.name;
  const harness = client === "codex-mcp-client" ? "codex" : client;
  const meta = metaOf(context);
  const fromMeta = text(meta.sessionId) ?? text(meta.threadId);
  const fromEnv = text(env.CLAUDE_CODE_SESSION_ID);
  const session = (harness === "claude-code" ? (fromEnv ?? fromMeta) : (fromMeta ?? fromEnv)) ?? ownSession;
  return harness === undefined ? { session } : { session, harness };
}

/** A call's progress reporter: a numbered notification per phase, under the token the client sent. */
function progressOf(context: ServerContext): (message: string) => Promise<void> {
  const token = context.mcpReq._meta?.progressToken;
  let progress = 0;
  return async (message) => {
    context.mcpReq.signal.throwIfAborted();
    if (token === undefined) return;
    await context.mcpReq.notify({ method: "notifications/progress", params: { progressToken: token, progress: ++progress, message } });
  };
}

/** What the harness sent with a call beside its arguments. */
export function metaOf(context: ServerContext): Readonly<Record<string, unknown>> {
  return (context.mcpReq._meta ?? {}) as Record<string, unknown>;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}
