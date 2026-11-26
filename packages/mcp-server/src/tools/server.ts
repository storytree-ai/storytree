// Capability 6 · Tool server (the MCP server)
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";

import { McpServer, type CallToolResult, type ServerContext } from "@modelcontextprotocol/server";
import { callLines, endMergedClaims, outsideTextReads, type ActivityLog, type MergeWatch } from "@storytree/session-management";
import { agentOf, harnessOfClient, SESSION_ENV, lineOf, requestOf, seenCaller, type Caller } from "@storytree/project-and-caller/caller";
import { factoryFolder, findProject, idleAfterMs, importsOf, machineOf, readPartsOff, readStandIns, route, storytreeHome, type ImportedFolder, type LocateOptions, type Route } from "@storytree/project-and-caller";
import { mount, offSaid, recordKinds, standIn, switchedOff } from "@storytree/plugin-loader";
import { unnamedPlugins } from "@storytree/plugin-loader/factory";
import { heldBack, type Agent, type HealthWorkItem, type Library, type Storytree, type WriteOptions } from "@storytree/library";
import { VerbRefusal, WHERE_INPUTS, whereOf, writtenLibrary, type Consumer } from "@storytree/library/verbs";
import { NOTE_TOOLS } from "@storytree/library/commands";
import { asReader } from "@storytree/library/reads";
import { z } from "zod";

import TOOL_PARTS from "#parts/tools";
import VERB_PARTS from "#parts/verbs";
import CLAIM_CHECK_PARTS from "#parts/claimChecks";
import ARM_CHECK_PARTS from "#parts/armChecks";
import PIPELINE_JOB_PARTS from "#parts/pipelineJobs";

import { habitsCard } from "../instructions/habits.js";
import { failureOf, isUnreachable, libraryDown, NOT_RUNNING_ANSWER, outcomeOf, refusalOf, result, type Answer, type DoorOutcome } from "./answers.js";
import { landingOf } from "./claim-tools.js";
import { Connections } from "./connections.js";
import { mountTools, verbsOf } from "./mount.js";
import { drainedBy, type DrainStep } from "./drain-step.js";
import { registerPlanTools } from "./plan-tools.js";
import { registerSetupTools, type SetupToolOptions } from "./setup-tools.js";
import { registerWorkTools } from "./work-tools.js";

export { NOT_RUNNING_ANSWER, lineOf };
export type { Answer, Caller };

export type ProtectionReader = (folder: string, repository: { owner: string; name: string }) => Promise<"allowed" | "refused by plan" | "unknown">;

export interface PipelineJob {
  readonly name: string;
  readonly needsHistory?: boolean;
  commands(ref: string, workspace: string): readonly string[];
}

export interface AgentToolOptions {
  readonly folder: string;
  readonly dataDir?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly quietMs?: number;
  readonly merges?: MergeWatch;
  readonly protection?: ProtectionReader;
  readonly setup?: SetupToolOptions;
  readonly extensions?: readonly ToolExtension[];
  readonly journey?: JourneyMilestones;
  readonly drain?: DrainStep;
}

export interface JourneyMilestones {
  hooksVerified?(): void;
  projectCreated?(): void;
  incrementClosed?(outcome: unknown): void;
}

export interface AgentTools {
  readonly server: McpServer;
  readonly tools: readonly string[];
  readonly harnessTools: readonly string[];
  consumers(tool: string): readonly Consumer[];
  close(): Promise<void>;
}

export const NOT_A_PROJECT_ANSWER = "this folder isn't a storytree project, so storytree has nothing to keep here; call check_setup to see what to do, or carry on without it";

export interface Call {
  readonly library: Library;
  readonly log: ActivityLog;
  readonly storytree: Storytree;
  readonly project: string;
  readonly caller: Caller;
  readonly writer: WriteOptions;
  readonly folder: string;
  readonly quietMs: number;
  readonly agent: Agent;
  readonly request?: number;
  readonly journey?: JourneyMilestones;
  progress(message: string): Promise<void>;
  readonly pluginKinds: readonly string[];
}

export interface DefineOptions {
  readonly consumers?: readonly Consumer[];
  readonly writes?: true;
}

export type Define = <S extends z.ZodObject>(name: string, description: string, input: S, act: (args: z.output<S>, call: Call) => Promise<Answer>, options?: DefineOptions) => void;

export interface HarnessCall {
  readonly reach: (where: Extract<Route, { status: "routed" }>) => Promise<ActivityLog>;
  readonly locate: LocateOptions;
}

export type DefineForHarness = <S extends z.ZodObject>(name: string, description: string, input: S, act: (args: z.output<S>, call: HarnessCall) => Promise<Answer>) => void;

export interface RunOwner {
  readonly session: string;
  readonly harness?: string;
  readonly agent?: "orchestrator" | "unknown" | { readonly subagent: string; readonly type?: string | undefined; readonly task?: string | undefined };
  readonly parentSession?: string;
}

export interface OwnerCall {
  readonly owner: RunOwner | undefined;
  readonly locate: LocateOptions;
}

export type DefineForOwner = <S extends z.ZodObject>(name: string, description: string, input: S, act: (args: z.output<S>, call: OwnerCall) => Promise<Answer>, options?: { readonly anyCaller?: boolean }) => void;

export interface ToolExtension {
  readonly registerTools?: (define: Define) => void;
  readonly registerOwnerTools?: (define: DefineForOwner) => void;
  readonly registerHarnessTools?: (define: DefineForHarness) => void;
  readonly instructions?: string;
  readonly landNext?: (capability: string, call: Call) => Promise<string | undefined> | string | undefined;
}

export interface ClaimCheck {
  readonly name: string;
  landing(capability: string, place: { readonly library: Library; readonly folder: string }): Promise<readonly string[]>;
}

export interface ArmCheck {
  readonly name: string;
  verdict(door: "tool" | "command", verb: string, home?: string): { readonly allowed: true } | { readonly allowed: false; readonly message: string };
}

export interface Landing {
  unplaced(capability: string, call: Call): Promise<readonly string[]>;
  untested(capability: string, call: Call): Promise<{ readonly titles: readonly string[]; readonly seen: boolean }>;
  next(capability: string, call: Call): Promise<readonly string[]>;
}

export interface ToolHost {
  readonly project: string | undefined;
  readonly tools: () => readonly string[];
  readonly home?: string;
  readonly ledger?: string;
  readonly merges?: MergeWatch;
  readonly landing?: Landing;
  readonly protection?: ProtectionReader;
  readonly pipelineJobs: readonly PipelineJob[];
  readonly imports: (storytree: Storytree, project: string) => Promise<readonly ImportedFolder[]>;
  readonly heldBack: (items: readonly HealthWorkItem[]) => string | undefined;
  readonly factory?: () => string | undefined;
}

export type ToolPart = (host: ToolHost) => ToolExtension | undefined;

export function createAgentTools(options: AgentToolOptions): AgentTools {
  const servedTools = ["check_setup", "set_up_project"];
  const consumers = new Map<string, readonly Consumer[]>([["set_up_project", ["user"]]]);
  const verbHome = options.dataDir === undefined ? undefined : path.dirname(path.resolve(options.dataDir));
  const home = options.setup?.storytreeHome ?? (options.dataDir === undefined ? storytreeHome() : path.dirname(path.resolve(options.dataDir)));
  const off = readPartsOff(home);
  const standIns = readStandIns(home);
  const claimChecks = mount(standIn(CLAIM_CHECK_PARTS, "claimChecks", standIns), off).mounted;
  const armChecks = mount(standIn(ARM_CHECK_PARTS, "armChecks", standIns), off).mounted;
  const imports: ToolHost["imports"] = (storytree, project) => importsOf(storytree, project, machineOf(storytreeHome()).id);
  const host: ToolHost = {
    project: findProject(options.folder).project, tools: () => servedTools,
    imports,
    heldBack,
    factory: () => factoryFolder(home).folder,
    landing: landingOf(() => claimChecks, () => extensions, imports),
    pipelineJobs: mount(standIn(PIPELINE_JOB_PARTS, "pipelineJobs", standIns), off).mounted,
    ...(verbHome === undefined ? {} : { home: verbHome, ledger: path.join(path.dirname(options.dataDir!), "own") }),
    ...(options.merges === undefined ? {} : { merges: options.merges }),
    ...(options.protection === undefined ? {} : { protection: options.protection }),
  };
  const extensions = [
    ...mount(standIn(TOOL_PARTS, "tools", standIns), off).mounted.flatMap((part) => part(host) ?? []),
    ...options.extensions ?? [],
  ];
  const graph = VERB_PARTS.graph;
  const kinds = recordKinds(graph, standIns, off);
  const because = switchedOff(graph, off);
  const kindsFailed = Object.entries(kinds.failed).map(([part, why]) => offSaid({ part, because: because.get(part) ?? part, failed: why }));
  const card = habitsCard(off, standIns);
  const instructions = [card, ...kindsFailed, ...extensions.flatMap((extension) => extension.instructions === undefined ? [] : [extension.instructions])].join("\n");
  const server = new McpServer({ name: "storytree", version: "0.3.0" }, { instructions });
  const connections = new Connections(kinds.kinds);
  const pluginKinds = kinds.kinds.map(({ kind }) => kind);
  const env = options.env ?? process.env;
  const ownSession = `storytree-mcp-${randomUUID()}`;
  const locate: LocateOptions = options.dataDir === undefined ? {} : { dataDir: options.dataDir };
  const callerOf = (context: ServerContext): Caller => callerFrom(server, context, env, ownSession);

  const define: Define = (name, description, input, act, defined = {}) => {
    servedTools.push(name);
    if (defined.consumers !== undefined) consumers.set(name, defined.consumers);
    const added = defined.writes === true ? Object.keys(WHERE_INPUTS).filter((key) => !(key in input.shape)) as (keyof typeof WHERE_INPUTS)[] : [];
    const schema = added.length === 0 ? input : input.extend(Object.fromEntries(added.map((key) => [key, z.string().min(1).optional().describe(WHERE_INPUTS[key].describe)])));
    const handle = async (args: unknown, context: ServerContext): Promise<CallToolResult> => {
      const where = route(options.folder, locate);
      if (where.status === "not-running") return result({ text: NOT_RUNNING_ANSWER });
      if (where.status === "not-a-project") return result({ text: NOT_A_PROJECT_ANSWER });
      const meta = metaOf(context);
      try {
        let quietMs = options.quietMs;
        const { library, log, storytree } = await connections.reach(where.library, where.project, where.identity, { folder: where.folder, home });
        const lines = await callLines(log, where.project, meta, { harness: callerOf(context).harness, tool: name });
        const caller = seenCaller(lines, callerOf(context), meta);
        const requested = requestOf(lines, meta);
        const request = requested?.seq;
        const cause = request === undefined ? {} : { causedBy: request };
        const folder = requested?.folder !== undefined && existsSync(requested.folder) && findProject(requested.folder).project === where.project ? requested.folder : options.folder;
        await log.append(where.project, { ...lineOf(caller), source: "tool", folder, kind: "tool-called", tool: name, ...cause });
        const answeredLine = (outcome: DoorOutcome) => log.append(where.project, { ...lineOf(caller), source: "tool", folder, kind: "door-answered", door: "tool", verb: name, ...outcome, ...cause }).catch(() => {});
        const verdict = armChecks.map((check) => check.verdict("tool", name, home)).find((one) => !one.allowed);
        if (verdict !== undefined && !verdict.allowed) {
          await answeredLine({ outcome: "denied-by-arm", next: [] });
          return result({ text: verdict.message, refused: true });
        }
        await endMergedClaims({ log, project: where.project, folder, ...lineOf(caller), source: "tool", library: async () => library }, options.merges).catch(() => []);
        const place = defined.writes === true ? await writePlace(library, args as Record<string, unknown>, added) : { library, args };
        const answered = "refusal" in place ? { text: place.refusal, refused: true } : await act(place.args as never, {
          library: place.library, log, storytree, project: where.project, caller,
          writer: { actor: `session:${caller.session}`, signal: context.mcpReq.signal, outsideRead: () => outsideTextReads(log, where.project, caller.session) },
          folder,
          get quietMs() { return quietMs ??= idleAfterMs(); },
          agent: agentOf(lines, meta),
          ...(request === undefined ? {} : { request }),
          ...(options.journey === undefined ? {} : { journey: options.journey }),
          progress: progressOf(context),
          pluginKinds,
        }).catch(async (error: unknown) => {
          if (!isUnreachable(error)) await answeredLine(failureOf(error));
          throw error;
        });
        await answeredLine(outcomeOf(answered));
        return result(answered);
      } catch (error) {
        if (isUnreachable(error)) {
          await connections.close();
          return result({ text: NOT_RUNNING_ANSWER });
        }
        return result({ text: refusalOf(error), refused: true });
      }
    };
    server.registerTool(name, { description, inputSchema: schema }, readAs(name, handle) as never);
  };

  const harnessTools: string[] = [];
  const defineForHarness: DefineForHarness = (name, description, input, act) => {
    harnessTools.push(name);
    const reach: HarnessCall["reach"] = async (where) => (await connections.reach(where.library, where.project, where.identity, { folder: where.folder, home })).log;
    const handle = async (args: unknown): Promise<CallToolResult> => {
      try {
        return result(await act(args as never, { reach, locate }));
      } catch (error) {
        if (isUnreachable(error)) {
          await connections.close();
          return result({ text: NOT_RUNNING_ANSWER });
        }
        return result({ text: refusalOf(error), refused: true });
      }
    };
    server.registerTool(name, { description, inputSchema: input }, readAs(name, handle) as never);
  };

  const ownerOf = async (context: ServerContext): Promise<RunOwner | undefined> => {
    let caller = callerOf(context);
    const meta = metaOf(context);
    let agent: Agent = caller.harness === "codex" ? agentOf([], meta) : "unknown";
    const where = route(options.folder, locate);
    if (where.status === 'routed') {
      try {
        const { log } = await connections.reach(where.library, where.project, where.identity, { folder: where.folder, home });
        const lines = await callLines(log, where.project, meta);
        caller = seenCaller(lines, caller, meta);
        agent = requestOf(lines, meta) || caller.harness === "codex" ? agentOf(lines, meta) : "unknown";
      } catch (error) {
        if (!libraryDown(error)) throw error;
        await connections.close();
      }
    }
    if (caller.session === ownSession || agent === "unknown") return undefined;
    return { ...caller, agent };
  };
  const defineForOwner: DefineForOwner = (name, description, input, act, defined = {}) => {
    servedTools.push(name);
    const handle = async (args: unknown, context: ServerContext): Promise<CallToolResult> => {
      try {
        return result(await act(args as never, { owner: defined.anyCaller === true ? undefined : await ownerOf(context), locate }));
      } catch (error) {
        return result({ text: refusalOf(error), refused: true });
      }
    };
    server.registerTool(name, { description, inputSchema: input }, readAs(name, handle) as never);
  };

  registerSetupTools({
    server,
    folder: options.folder,
    setup: { ...(options.dataDir === undefined ? {} : { storytreeHome: path.dirname(options.dataDir) }), unnamedPlugins: () => unnamedPlugins(standIns), ...options.setup },
    connections,
    callerOf,
    card,
    served: () => servedTools,
    ...(options.journey === undefined ? {} : { journey: options.journey }),
  });
  registerPlanTools(define);
  registerWorkTools(define);
  mountTools(define, NOTE_TOOLS);
  const verbs = mount(standIn(VERB_PARTS, "verbs", standIns), off).mounted.flatMap(verbsOf);
  mountTools(define, options.drain === undefined ? verbs : drainedBy(verbs, options.drain), verbHome, VERB_PARTS);
  for (const extension of extensions) extension.registerTools?.(define);
  for (const extension of extensions) extension.registerOwnerTools?.(defineForOwner);
  for (const extension of extensions) extension.registerHarnessTools?.(defineForHarness);

  return {
    server,
    tools: servedTools,
    harnessTools,
    consumers: (tool) => consumers.get(tool) ?? ["agent", "user"],
    async close() {
      await server.close();
      await connections.close();
    },
  };
}

export async function servedTools(folder: string, options: Omit<AgentToolOptions, "folder"> = {}): Promise<{ name: string; consumers: readonly Consumer[] }[]> {
  const tools = createAgentTools({ ...options, folder });
  try {
    return tools.tools.map((name) => ({ name, consumers: tools.consumers(name) }));
  } finally {
    await tools.close();
  }
}

function callerFrom(server: McpServer, context: ServerContext, env: Readonly<Record<string, string | undefined>>, ownSession: string): Caller {
  const harness = harnessOfClient(server.server.getClientVersion()?.name);
  const meta = metaOf(context);
  const fromMeta = text(meta.sessionId) ?? text(meta.threadId);
  const fromEnv = text(env.CLAUDE_CODE_SESSION_ID);
  const session = (harness === "claude-code" ? (fromEnv ?? fromMeta) : (fromMeta ?? fromEnv)) ?? text(env[SESSION_ENV]) ?? ownSession;
  return harness === undefined ? { session } : { session, harness };
}

function progressOf(context: ServerContext): (message: string) => Promise<void> {
  const token = context.mcpReq._meta?.progressToken;
  let progress = 0;
  return async (message) => {
    context.mcpReq.signal.throwIfAborted();
    if (token === undefined) return;
    await context.mcpReq.notify({ method: "notifications/progress", params: { progressToken: token, progress: ++progress, message } });
  };
}

export function metaOf(context: ServerContext): Readonly<Record<string, unknown>> {
  return (context.mcpReq._meta ?? {}) as Record<string, unknown>;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function readAs<A extends unknown[], R>(name: string, handle: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return (...args) => asReader(`tool ${name}`, () => handle(...args));
}

async function writePlace(library: Library, args: Record<string, unknown>, added: readonly string[]): Promise<{ library: Library; args: Record<string, unknown> } | { refusal: string }> {
  try {
    const target = await writtenLibrary(library, whereOf(args));
    return { library: target, args: Object.fromEntries(Object.entries(args).filter(([key]) => !added.includes(key))) };
  } catch (error) {
    if (error instanceof VerbRefusal) return { refusal: error.message };
    throw error;
  }
}
