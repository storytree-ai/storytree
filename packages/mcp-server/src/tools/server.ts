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
 *
 * A harness's own tools (ADR-1056 D2: a hook event handed over with no process started for it) are served beside
 * these through the same connections, but none of the above records them: their calls are not an agent's.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";

import { McpServer, type CallToolResult, type ServerContext } from "@modelcontextprotocol/server";
import { callLines, endMergedClaims, outsideTextReads, type ActivityLog, type MergeWatch } from "@storytree/session-management";
import { agentOf, harnessOfClient, SESSION_ENV, lineOf, requestOf, seenCaller, type Caller } from "@storytree/project-and-caller/caller";
import { findProject, idleAfterMs, importsOf, machineOf, readPartsOff, readStandIns, route, storytreeHome, type ImportedFolder, type LocateOptions, type Route } from "@storytree/project-and-caller";
import { mount, offSaid, recordKinds, standIn, switchedOff } from "@storytree/plugin-loader";
import { heldBack, type Agent, type HealthWorkItem, type Library, type Storytree, type WriteOptions } from "@storytree/library";
import type { Consumer } from "@storytree/library/verbs";
import { NOTE_TOOLS } from "@storytree/library/commands";
import type { z } from "zod";

// The other stories' tools (ADR-0643 D6), in their manifests' order: the plugin loader composes them from the
// manifests of the story packages this server depends on (ADR-1021).
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

/**
 * How wire_pipeline reads whether a repository's plan allows branch protection (App setup's capability 11): the shape
 * App setup reads, declared here rather than imported, as the tool parts are (ADR-1017 D2).
 */
export type ProtectionReader = (folder: string, repository: { owner: string; name: string }) => Promise<"allowed" | "refused by plan" | "unknown">;

/**
 * A job another story contributes to a user's pipeline (ADR-1170 D2), as its manifest's `pipelineJobs` names it, which
 * the server hands to App setup's wire_pipeline: its name is the status check's, and its commands run at `workspace`.
 * Guardrails contributes `storytree check`; a part switched off contributes none. Declared here, as the reader above is.
 */
export interface PipelineJob {
  readonly name: string;
  readonly needsHistory?: boolean;
  commands(ref: string, workspace: string): readonly string[];
}

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
  readonly setup?: SetupToolOptions;
  /** Other stories' tools, served through the same routing, session attribution and refusals. */
  readonly extensions?: readonly ToolExtension[];
  /** Optional observations owned by the journey story; no tool content is passed. */
  readonly journey?: JourneyMilestones;
  /** What friction_drain runs after the drain: the doors learner, which only the command line can run (ADR-1045 D7). By default, nothing. */
  readonly drain?: DrainStep;
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
  /** The name of every tool it serves an agent or a person, as its client lists them. */
  readonly tools: readonly string[];
  /** The name of every tool it serves a harness instead (ADR-1056 D2): listed to the client too, but off the card, with no call recorded. */
  readonly harnessTools: readonly string[];
  /** Who calls the tool named (ADR-1045 D1): as it was defined, else both an agent and a person. */
  consumers(tool: string): readonly Consumer[];
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
  /** The kinds the factory plugins mounted here declare, each `<plugin>.<kind>` (ADR-1178 D3): the librarian offers their guidance. */
  readonly pluginKinds: readonly string[];
}

/** What else a tool is defined with: who calls it (ADR-1045 D1), both an agent and a person when left out. */
export interface DefineOptions {
  readonly consumers?: readonly Consumer[];
}

/** Registers one tool: its name, what it is for, its arguments, what it does with them, and who calls it. */
export type Define = <S extends z.ZodObject>(name: string, description: string, input: S, act: (args: z.output<S>, call: Call) => Promise<Answer>, options?: DefineOptions) => void;

/** What a harness's tool has for one call (ADR-1056 D2): the server's own connections to storytree, and where it looks for storytree. */
export interface HarnessCall {
  /** The activity log of the project `where` routes to, through the server's connection; refused (a ProjectFolderError) for a checkout not approved for it. */
  readonly reach: (where: Extract<Route, { status: "routed" }>) => Promise<ActivityLog>;
  readonly locate: LocateOptions;
}

/** Registers one harness's tool: its name, what it is for, its arguments and what it does with them. */
export type DefineForHarness = <S extends z.ZodObject>(name: string, description: string, input: S, act: (args: z.output<S>, call: HarnessCall) => Promise<Answer>) => void;

/** Who started a run, as the process ledger is handed it (ADR-1017 D2). */
export interface RunOwner {
  readonly session: string;
  readonly harness?: string;
  readonly agent?: "orchestrator" | "unknown" | { readonly subagent: string; readonly type?: string | undefined; readonly task?: string | undefined };
  readonly parentSession?: string;
}

/** What a process ledger's tool has for one call: the calling agent, when it could be resolved, and where it looks for storytree. */
export interface OwnerCall {
  readonly owner: RunOwner | undefined;
  readonly locate: LocateOptions;
}

/**
 * Registers one tool of the process ledger, answered offline with no library needed: the calling agent is resolved
 * first, from its hooks when the library is up, unless the tool reads every session's (`anyCaller`).
 */
export type DefineForOwner = <S extends z.ZodObject>(name: string, description: string, input: S, act: (args: z.output<S>, call: OwnerCall) => Promise<Answer>, options?: { readonly anyCaller?: boolean }) => void;

/** Another story's contribution to the one tool server (ADR-0643 D6). */
export interface ToolExtension {
  readonly registerTools?: (define: Define) => void;
  /** Tools of the process ledger, answered offline: no call recorded, and the caller resolved without needing the library. */
  readonly registerOwnerTools?: (define: DefineForOwner) => void;
  /** Tools a harness calls rather than the model (ADR-1056 D2): served apart from the agent's, recording no call, and off the card. */
  readonly registerHarnessTools?: (define: DefineForHarness) => void;
  /** A short addition to the habits card, naming the added tools in backticks. */
  readonly instructions?: string;
  /** Suggest the next step after a successful landing; undefined means nothing is due. */
  readonly landNext?: (capability: string, call: Call) => Promise<string | undefined> | string | undefined;
}

/**
 * A check another story contributes to the claim front doors (ADR-1170 D2), as its manifest's `claimChecks` names it:
 * run as a claim on `capability` lands, in the checkout `folder` is in, it gives the problems that hold the landing,
 * none to let it land. Guardrails contributes its allocation rule (ADR-0911 D4); a part switched off contributes none.
 */
export interface ClaimCheck {
  readonly name: string;
  landing(capability: string, place: { readonly library: Library; readonly folder: string }): Promise<readonly string[]>;
}

/**
 * A check another story contributes to the doors, as its manifest's `armChecks` names it: whether a door may run a verb
 * for a caller whose storytree home is `home`, or the experiment arm that denies it, with why (ADR-1064 D2). Experiments
 * contributes its arm switch; with no check mounted, every tool runs.
 */
export interface ArmCheck {
  readonly name: string;
  verdict(door: "tool" | "command", verb: string, home?: string): { readonly allowed: true } | { readonly allowed: false; readonly message: string };
}

/**
 * What a landing is checked against, of the parts the server mounts (the claim checks they contribute, the map's survey,
 * the next steps the extensions suggest), so Session management's land tool runs them without standing on those parts.
 */
export interface Landing {
  unplaced(capability: string, call: Call): Promise<readonly string[]>;
  untested(capability: string, call: Call): Promise<readonly string[]>;
  next(capability: string, call: Call): Promise<readonly string[]>;
}

/**
 * What a story's tool part is given: the project the server serves (none outside a project), the tools it serves, the
 * storytree home its readings use and where its run ledger is kept, when not the usual ones, how merges are watched, and
 * what a landing is checked against.
 */
export interface ToolHost {
  readonly project: string | undefined;
  readonly tools: () => readonly string[];
  readonly home?: string;
  readonly ledger?: string;
  readonly merges?: MergeWatch;
  /** What a landing is checked against; the server always gives it, and a part given none lands unchecked. */
  readonly landing?: Landing;
  /** How wire_pipeline reads whether a repository's plan allows branch protection, when not through `gh`. */
  readonly protection?: ProtectionReader;
  /** The jobs the parts the server mounts contribute to a user's pipeline (ADR-1170 D2): none from a part switched off. */
  readonly pipelineJobs: readonly PipelineJob[];
  /** The folders this machine imports for a project, which the core keeps: the map reads mapped stories there (ADR-0993 D2). */
  readonly imports: (storytree: Storytree, project: string) => Promise<readonly ImportedFolder[]>;
  /** What the health worklist says of the capabilities a test run holds back, as the library words it. */
  readonly heldBack: (items: readonly HealthWorkItem[]) => string | undefined;
}

/** A story's tool part, as its manifest's `tools` names it: its extension for this server, or none where it serves nothing. */
export type ToolPart = (host: ToolHost) => ToolExtension | undefined;

export function createAgentTools(options: AgentToolOptions): AgentTools {
  // Which project each part serves is the part's own call (the librarian's is storytree's own library first, ADR-0644 U1);
  // their behaviour stays in their packages, and this is the shared registration point for other stories (ADR-0643 D6).
  const servedTools = ["check_setup", "set_up_project"];
  // Who calls each tool, where it is not both: setting up a project is the user's ask (the habits card's).
  const consumers = new Map<string, readonly Consumer[]>([["set_up_project", ["user"]]]);
  const verbHome = options.dataDir === undefined ? undefined : path.dirname(path.resolve(options.dataDir));
  // The machine whose approved trunks let this folder reach its project (ADR-0942): the home setup records them in.
  const home = options.setup?.storytreeHome ?? (options.dataDir === undefined ? storytreeHome() : path.dirname(path.resolve(options.dataDir)));
  // The parts this computer switches off (ADR-1095), read as the server starts: their tools are not served, and the card
  // leaves out their sections and names them, so an agent asks for none of them. A plugin in this computer's factory
  // folder named to stand in for a part switched off is served in its place (the plugin loader's capability 5).
  const off = readPartsOff(home);
  const standIns = readStandIns(home);
  const claimChecks = mount(standIn(CLAIM_CHECK_PARTS, "claimChecks", standIns), off).mounted;
  const armChecks = mount(standIn(ARM_CHECK_PARTS, "armChecks", standIns), off).mounted;
  const host: ToolHost = {
    project: findProject(options.folder).project, tools: () => servedTools,
    imports: (storytree, project) => importsOf(storytree, project, machineOf(storytreeHome()).id),
    heldBack,
    // Read when a capability lands, after every part has mounted: the next steps come from all of them.
    landing: landingOf(() => claimChecks, () => extensions),
    pipelineJobs: mount(standIn(PIPELINE_JOB_PARTS, "pipelineJobs", standIns), off).mounted,
    ...(verbHome === undefined ? {} : { home: verbHome, ledger: path.join(path.dirname(options.dataDir!), "own") }),
    ...(options.merges === undefined ? {} : { merges: options.merges }),
    ...(options.protection === undefined ? {} : { protection: options.protection }),
  };
  const extensions = [
    ...mount(standIn(TOOL_PARTS, "tools", standIns), off).mounted.flatMap((part) => part(host) ?? []),
    ...options.extensions ?? [],
  ];
  // The kinds of record the plugins mounted here declare, which each project is opened with (ADR-1178 D3); a plugin whose
  // kinds could not be read is named on the card, as a stand-in that failed is.
  const graph = VERB_PARTS.graph;
  const kinds = recordKinds(graph, standIns, off);
  const because = switchedOff(graph, off);
  const kindsFailed = Object.entries(kinds.failed).map(([part, why]) => offSaid({ part, because: because.get(part) ?? part, failed: why }));
  const card = habitsCard(off);
  const instructions = [card, ...kindsFailed, ...extensions.flatMap((extension) => extension.instructions === undefined ? [] : [extension.instructions])].join("\n");
  const server = new McpServer({ name: "storytree", version: "0.3.0" }, { instructions });
  const connections = new Connections(kinds.kinds);
  const pluginKinds = kinds.kinds.map(({ kind }) => kind);
  const env = options.env ?? process.env;
  // A session id of its own, for a harness that names none: one server process serves one session.
  const ownSession = `storytree-mcp-${randomUUID()}`;
  const locate: LocateOptions = options.dataDir === undefined ? {} : { dataDir: options.dataDir };
  const callerOf = (context: ServerContext): Caller => callerFrom(server, context, env, ownSession);

  const define: Define = (name, description, input, act, defined = {}) => {
    servedTools.push(name);
    if (defined.consumers !== undefined) consumers.set(name, defined.consumers);
    const handle = async (args: unknown, context: ServerContext): Promise<CallToolResult> => {
      const where = route(options.folder, locate);
      if (where.status === "not-running") return result({ text: NOT_RUNNING_ANSWER });
      if (where.status === "not-a-project") return result({ text: NOT_A_PROJECT_ANSWER });
      const meta = metaOf(context);
      try {
        let quietMs = options.quietMs;
        const { library, log, storytree } = await connections.reach(where.library, where.project, where.identity, { folder: where.folder, home });
        // What the hooks wrote of this very call, the one run just before it (ADR-0629 D2): only those lines (contract 2.7).
        const lines = await callLines(log, where.project, meta, { harness: callerOf(context).harness, tool: name });
        const caller = seenCaller(lines, callerOf(context), meta);
        // The hook's line for this very call, joined by the id the harness gave it: never a guess by time.
        const requested = requestOf(lines, meta);
        const request = requested?.seq;
        const cause = request === undefined ? {} : { causedBy: request };
        const folder = requested?.folder !== undefined && existsSync(requested.folder) && findProject(requested.folder).project === where.project ? requested.folder : options.folder;
        await log.append(where.project, { ...lineOf(caller), source: "tool", folder, kind: "tool-called", tool: name, ...cause });
        // How the call was answered, after the tool has answered and never in its way (ADR-0983 D1).
        const answeredLine = (outcome: DoorOutcome) => log.append(where.project, { ...lineOf(caller), source: "tool", folder, kind: "door-answered", door: "tool", verb: name, ...outcome, ...cause }).catch(() => {});
        // A tool an arm check the mounted parts contribute denies is refused before it runs, and logged so the attempt is a
        // measure (ADR-1064 D2); with none mounted, every tool runs.
        const verdict = armChecks.map((check) => check.verdict("tool", name, home)).find((one) => !one.allowed);
        if (verdict !== undefined && !verdict.allowed) {
          await answeredLine({ outcome: "denied-by-arm", next: [] });
          return result({ text: verdict.message, refused: true });
        }
        // A claim whose pull request has merged ends before the tool sees who holds what (ADR-0643 D3).
        await endMergedClaims({ log, project: where.project, folder, ...lineOf(caller), source: "tool", library: async () => library }, options.merges).catch(() => []);
        const answered = await act(args as never, {
          library, log, storytree, project: where.project, caller,
          // What the session's hooks saw it read from outside, asked for only by a write to a marked knowledge kind (6.106).
          writer: { actor: `session:${caller.session}`, signal: context.mcpReq.signal, outsideRead: () => outsideTextReads(log, where.project, caller.session) },
          folder,
          // Read once for this call, only if it needs liveness. Independent context readings
          // still return tokens and explain unusable settings (9.7), as routing's readLibrary does.
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
    // The SDK checks the arguments against `input` before `handle` runs; its callback type is
    // written per schema, which a wrapper serving every tool cannot name, hence the cast.
    server.registerTool(name, { description, inputSchema: input }, handle as never);
  };

  // A harness's tool is answered through the same connections, but its call is not an agent's: no tool-called or
  // door-answered line, no claims ended, no session looked for (ADR-1056 D2).
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
    server.registerTool(name, { description, inputSchema: input }, handle as never);
  };

  // A process ledger's tool answers offline (ADR-1017 D2): its caller is resolved from the hooks when the library is up,
  // from the harness alone when it is down, and its call is not recorded.
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
    // Claude shares one MCP server with subagents: only a correlated hook identifies a call.
    // Codex carries its caller thread on the request, including while the app is down.
    if (caller.session === ownSession || agent === "unknown") return undefined;
    return { ...caller, agent };
  };
  const defineForOwner: DefineForOwner = (name, description, input, act, defined = {}) => {
    servedTools.push(name);
    const handle = async (args: unknown, context: ServerContext): Promise<CallToolResult> => {
      try {
        // All-session inspection is available even if the library cannot resolve this caller.
        return result(await act(args as never, { owner: defined.anyCaller === true ? undefined : await ownerOf(context), locate }));
      } catch (error) {
        return result({ text: refusalOf(error), refused: true });
      }
    };
    server.registerTool(name, { description, inputSchema: input }, handle as never);
  };

  registerSetupTools({
    server,
    folder: options.folder,
    // The storytree home is where the data directory routing reads sits, unless it is named.
    setup: { ...(options.dataDir === undefined ? {} : { storytreeHome: path.dirname(options.dataDir) }), ...options.setup },
    connections,
    callerOf,
    card,
    served: () => servedTools,
    ...(options.journey === undefined ? {} : { journey: options.journey }),
  });
  registerPlanTools(define);
  registerWorkTools(define);
  // The library's artifact tools, declared in The library (ADR-1035 D3), which is core.
  mountTools(define, NOTE_TOOLS);
  // Every verb a mounted part's command families declare a tool for (Friction's, Session management's), from their
  // manifests: a part switched off takes its tools with it (ADR-1095).
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

/**
 * The name of every tool a server in `folder` serves (6.63), with who calls it (ADR-1045 D1), read from the server
 * itself rather than listed by hand: a reading of the front doors counts the tools with no call against it (ADR-0998 D1).
 * Making the server connects to nothing; only a call does.
 */
export async function servedTools(folder: string, options: Omit<AgentToolOptions, "folder"> = {}): Promise<{ name: string; consumers: readonly Consumer[] }[]> {
  const tools = createAgentTools({ ...options, folder });
  try {
    return tools.tools.map((name) => ({ name, consumers: tools.consumers(name) }));
  } finally {
    await tools.close();
  }
}

/**
 * Who is calling. The harness from the client's name (Claude Code calls itself `claude-code`, Codex
 * `codex-mcp-client`, any other client by its own name); the session from where that harness puts it.
 * A client that names none is the session STORYTREE_SESSION_ID names in the server's environment, or
 * else the server's own id, one for the server's life (6.65): its shell names it the same way.
 */
function callerFrom(server: McpServer, context: ServerContext, env: Readonly<Record<string, string | undefined>>, ownSession: string): Caller {
  const harness = harnessOfClient(server.server.getClientVersion()?.name);
  const meta = metaOf(context);
  const fromMeta = text(meta.sessionId) ?? text(meta.threadId);
  const fromEnv = text(env.CLAUDE_CODE_SESSION_ID);
  const session = (harness === "claude-code" ? (fromEnv ?? fromMeta) : (fromMeta ?? fromEnv)) ?? text(env[SESSION_ENV]) ?? ownSession;
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
