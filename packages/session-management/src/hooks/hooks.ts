// Capability 3 · Hooks
import type { Harness } from "@storytree/project-and-caller/caller";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";

import type { NewLine, Storytree } from "@storytree/library";
import { nameReader } from "@storytree/library/reads";

import type { ActivityLog, DeliveredEvent } from "../activity/index.js";
import { runGit, type Git } from "../activity/git.js";
import type { MergeContext, MergeWatch } from "../claims/index.js";
import type { DeclaredCapabilities, ReadsCode } from "../claims/edit-gate.js";
import { approvedHere, findProject, openNamedProject, ProjectFolderError, requireApproval, route, storytreeHome, type LocateOptions, type Route } from "@storytree/project-and-caller";
import { claudeCodeLines } from "./claude-code.js";
import { CLOSE_OUT_REMINDER, closeOutReminder } from "./close-out-reminder.js";
import { codexLines } from "./codex.js";
import { codexLaneMessages, withFollowUps, withSteers } from "./codex-lane.js";
import { cursorLines, cursorSession } from "./cursor.js";
import { piLines, piSession } from "./pi.js";
import { antigravityLines } from "./antigravity.js";
import { EDIT_GATE, editGate, recordYesAfterEdit, yesSaid } from "./edit-gate.js";
import { UPKEEP_DEADLINE_MS, withDeadline } from "./deadlines.js";
import { remoteAddress, takeTurn } from "./remote-turn.js";
import { noteCodexHookRan } from "./codex-trust.js";
import { BACKGROUND } from "./at-once.js";
import { AFTER_TOOL, deliveredByTool, deliveredInput, noteDelivered, TOOL_GRACE_MS } from "./codex-delivery.js";
import { contextNudge, START_FRESH } from "./context-nudge.js";
import { bigInjectionReport, definitionsContext, definitionsNamedIn, isHarnessNotice, notYetGiven, type InjectionReport } from "./definitions.js";
import { hookIdentity, noteHookFailure, type HookFailure } from "./failures.js";
import { markGiven, type Given } from "./given-once.js";
import { isSelfNamed, selfNamedLines } from "./self-named.js";
import { shellEdits } from "./shell-edits.js";
import type { HookClock } from "./timing.js";
import { rememberedImports, SHELL_GUARD, shellGuard, watchImports, watchWorktree } from "./shell-guard.js";
import { TEST_GUARD, testGuard } from "./test-guard.js";
import { noteSessionStart, toolsStoppedAtTurnEnd, toolsStoppedNotice } from "./tools-stopped.js";

export interface HookInput {
  readonly argv: readonly string[];
  readonly input: string;
  readonly handOff?: (harness: string, input: string, flags?: readonly string[]) => Promise<void>;
  readonly merges?: MergeWatch;
  readonly locate?: LocateOptions;
  readonly declaredCapabilities?: DeclaredCapabilities;
  readonly readsCode?: ReadsCode;
  readonly isCode?: ReadsCode;
  readonly guardMs?: number;
  readonly clock?: HookClock;
  readonly git?: Git;
}

export { BACKGROUND };
export const UPKEEP = "--upkeep";
export const BIG_INJECTION = "--big-injection";
export const ASK_SETUP = "--ask-setup";

export interface HookLines {
  readonly folder: string;
  readonly lines: NewLine[];
}

const CONNECT_TIMEOUT_MS = 2_000;

export function hookLines(harness: string, input: unknown): HookLines | undefined {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return undefined;
  switch (harness) {
    case "claude-code":
      return inCursor(input) ? undefined : claudeCodeLines(input as Record<string, unknown>);
    case "codex":
      return codexLines(input as Record<string, unknown>);
    case "cursor":
      return cursorLines(input as Record<string, unknown>);
    case "pi":
      return piLines(input as Record<string, unknown>);
    case "antigravity":
      return antigravityLines(input as Record<string, unknown>);
    default:
      return isSelfNamed(harness) ? selfNamedLines(harness, input as Record<string, unknown>) : undefined;
  }
}

export function inCursor(input: unknown): boolean {
  return typeof input === "object" && input !== null && typeof (input as Record<string, unknown>).cursor_version === "string";
}

export function promptAnswer(harness: string, context: readonly string[] | undefined, input: unknown, shown?: string): string | undefined {
  if (context === undefined || context.length === 0 || (harness !== "cursor" && inCursor(input))) return undefined;
  const added = context.join("\n\n");
  if (harness === "pi") return JSON.stringify({ message: { customType: "storytree", content: added, display: false } });
  if (harness === "cursor") return JSON.stringify({ continue: true, additional_context: added });
  return JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: added }, ...(shown !== undefined && harness === "claude-code" ? { systemMessage: shown } : {}) });
}

interface Prompted {
  readonly harness: Harness;
  readonly session: string;
  readonly folder: string;
  readonly prompt: string;
}

export async function runHook(hook: HookInput): Promise<string | undefined> {
  const said = await answerHook(hook);
  return said === undefined && hook.argv[0] === "antigravity" ? "{}" : said;
}

export const EVENT = "--event=";

async function answerHook({ argv, input: given, handOff: handing, merges, locate, declaredCapabilities, readsCode, isCode, guardMs, clock, git = runGit }: HookInput): Promise<string | undefined> {
  const [harness = "", ...flags] = argv;
  const read = parse(given);
  const parsed = withEvent(read, flags);
  const event = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>).hook_event_name : undefined;
  if (clock !== undefined && typeof event === "string" && event !== "") clock.event = event;
  if (typeof event === "string" && event !== "") nameReader(`hook ${event}`);
  const handOff: HookInput["handOff"] = handing === undefined || clock === undefined ? handing : (to, input, more) => clock.time("handoff", () => handing(to, input, more));
  const input = parsed === read ? given : JSON.stringify(parsed);
  const failed = (stage: HookFailure["stage"], error: unknown) => noteHookFailure(storytreeHome, hookIdentity(harness, parsed), stage, error);
  const delivered: DeliveredEvent = { key: eventKey(harness, parsed), via: "command" };
  try {
    if (harness === "codex" && typeof parsed === "object" && parsed !== null) {
      noteCodexHookRan({ storytreeHome: storytreeHome(), codexHome: process.env.CODEX_HOME || path.join(homedir(), ".codex") });
    }
    if (event === "SessionStart") noteSessionStart(harness, parsed);
    if (flags.includes(ASK_SETUP)) return;
    if (flags.includes(BIG_INJECTION)) return void (await fileBigInjection(parsed));
    if (flags.includes(CLOSE_OUT_REMINDER)) {
      const lane = event === "Stop" ? codexLaneMessages(harness, parsed, "stop", { locate, home: homeOf(locate), connectMs: CONNECT_TIMEOUT_MS }) : undefined;
      return withFollowUps(toolsStoppedAtTurnEnd(harness, parsed, storytreeHome()) ?? closeOutReminder(harness, parsed, git), await lane);
    }
    if (flags.includes(TEST_GUARD)) return testGuard(harness, parsed, flags);
    if (flags.includes(EDIT_GATE)) return await editGate(harness, parsed, declaredCapabilities, locate, homeOf(locate), failed, guardMs, readsCode, isCode);
    if (flags.includes(SHELL_GUARD)) {
      const lane = event === "PostToolUse" ? codexLaneMessages(harness, parsed, "tool", { locate, home: homeOf(locate), connectMs: CONNECT_TIMEOUT_MS }) : undefined;
      const guarded = await shellGuard(harness, parsed, hookLines(harness, parsed), locate, homeOf(locate), storytreeHome(), failed, declaredCapabilities, guardMs, git, isCode);
      return withSteers(guarded, await lane);
    }
    const made = hookLines(harness, parsed);
    if (flags.includes(UPKEEP)) return void (made === undefined ? undefined : await upkeep(made, merges, locate));
    const asked = promptIn(harness, parsed);
    if (asked !== undefined) {
      const said = isHarnessNotice(asked.prompt) ? undefined : yesSaid(harness, asked, locate, homeOf(locate), failed, guardMs);
      const [looked, yes] = await Promise.all([givenWithinTime(asked.session, contextForPrompt(asked), guardMs), said, made === undefined ? undefined : writeLines(harness, input, flags, made, delivered, handOff, merges, locate, failed, declaredCapabilities !== undefined, clock, git)]);
      const context = looked?.context;
      if (looked?.report !== undefined) {
        const handed = JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: asked.session, cwd: asked.folder, report: looked.report });
        await (handOff === undefined ? fileBigInjection(JSON.parse(handed)).catch((error: unknown) => failed("hook", error)) : handOff(harness, handed, [BIG_INJECTION]));
      }
      const stopped = toolsStoppedNotice(harness, parsed, storytreeHome());
      return promptAnswer(harness, [...(stopped === undefined ? [] : [stopped.agent]), ...(yes ?? []), ...(context ?? [])], parsed, stopped?.user);
    }
    if (made === undefined) return;
    await Promise.all([writeLines(harness, input, flags, made, delivered, handOff, merges, locate, failed, declaredCapabilities !== undefined, clock, git), recordYesAfterEdit(harness, parsed, locate, homeOf(locate), failed, guardMs, isCode)]);
  } catch (error) {
    failed("hook", error);
  }
  return undefined;
}

export function eventKey(harness: string, input: unknown): string {
  return createHash("sha256").update(JSON.stringify([harness, inOrder(deliveredInput(harness, input))])).digest("hex");
}

function inOrder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(inOrder);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, inOrder((value as Record<string, unknown>)[key])]));
}

interface Placed {
  readonly where: Exclude<Route, { status: "not-a-project" }>;
  readonly made: HookLines;
  readonly root: string | undefined;
}

interface Prepared {
  readonly where: Exclude<Route, { status: "not-a-project" }>;
  readonly made: HookLines;
  readonly firstLine: NewLine | undefined;
}

async function place(made: HookLines, locate: LocateOptions | undefined): Promise<Placed | undefined> {
  const where = route(made.folder, locate);
  if (where.status === "not-a-project") return undefined;
  const { worktreeRoot } = await import("../activity/branch.js");
  const root = worktreeRoot(made.folder);
  const marker = root === undefined ? findProject(made.folder) : undefined;
  const recordAt = root ?? (marker?.project === undefined ? undefined : marker.folder);
  if (recordAt !== undefined && recordAt !== path.resolve(made.folder)) made = { ...made, lines: made.lines.map((line) => (line.folder === made.folder ? { ...line, folder: recordAt } : line)) };
  return { where, made, root };
}

async function prepare({ where, made, root }: Placed, locate: LocateOptions | undefined, failed: (stage: HookFailure["stage"], error: unknown) => void, guarded: boolean, git: Git = runGit): Promise<Prepared> {
  const trusted = await mayRunGit(where, made.folder, locate);
  const { currentBranch } = await import("../activity/branch.js");
  const branch = trusted ? currentBranch(made.folder, git) : undefined;
  if (branch !== undefined) made = { ...made, lines: made.lines.map((line) => (line.branch === undefined ? { ...line, branch } : line)) };
  const home = storytreeHome();
  const firstLine = made.lines[0];
  if (trusted && root !== undefined && firstLine !== undefined) made = { ...made, lines: [...made.lines, ...shellEdits(home, root, firstLine, (error) => failed("observe", error), git)] };
  if (trusted && guarded && root !== undefined && firstLine !== undefined) watchWorktree(home, root, firstLine, failed, git);
  return { where, made, firstLine };
}

async function mayRunGit(where: Exclude<Route, { status: "not-a-project" }>, folder: string, locate: LocateOptions | undefined): Promise<boolean> {
  if (approvedHere(where.project, folder, homeOf(locate))) return true;
  if (where.status !== "routed") return false;
  try {
    const { connect } = await import("@storytree/library");
    const storytree = await connect(withDeadline(where.library, CONNECT_TIMEOUT_MS));
    try {
      return await approved(storytree, where.project, folder, homeOf(locate));
    } finally {
      await storytree.close();
    }
  } catch {
    return false;
  }
}

async function appendEvent(log: ActivityLog, project: string, lines: readonly NewLine[], delivered: DeliveredEvent, written: { count: number }): Promise<void> {
  for (const line of lines) {
    await log.append(project, line, { event: delivered });
    written.count += 1;
  }
}

export type ReachLog = (where: Extract<Route, { status: "routed" }>) => Promise<ActivityLog>;

export interface DeliveredLines {
  readonly recorded: number;
  readonly waiting: number;
}

export async function recordHookEvent(harness: string, input: unknown, reach: ReachLog, locate?: LocateOptions): Promise<DeliveredLines> {
  const failed = (stage: HookFailure["stage"], error: unknown) => noteHookFailure(storytreeHome, hookIdentity(harness, input), stage, error);
  const made = hookLines(harness, input);
  const placed = made === undefined || made.lines.length === 0 ? undefined : await place(made, locate);
  if (placed === undefined) return { recorded: 0, waiting: 0 };
  const { where, made: lines } = await prepare(placed, locate, failed, false);
  const delivered: DeliveredEvent = { key: eventKey(harness, input), via: "tool" };
  const { enqueue } = await import("./queue.js");
  const waits = (from: number): DeliveredLines => {
    enqueue(storytreeHome(), where.project, lines.lines.slice(from), delivered);
    return { recorded: from, waiting: lines.lines.length - from };
  };
  if (where.status === "not-running") return waits(0);
  let log: ActivityLog;
  try {
    log = await reach(where);
  } catch (error) {
    if (error instanceof ProjectFolderError) return { recorded: 0, waiting: 0 };
    failed("reach", error);
    return waits(0);
  }
  const written = { count: 0 };
  try {
    await appendEvent(log, where.project, lines.lines, delivered, written);
    noteDelivered(storytreeHome(), delivered.key);
    return { recorded: written.count, waiting: 0 };
  } catch (error) {
    failed("write", error);
    return waits(written.count);
  }
}

let leaveWaiting: (() => void) | undefined;

export function atDeadline(): void {
  const leave = leaveWaiting;
  leaveWaiting = undefined;
  try {
    leave?.();
  } catch {
  }
}

async function writeLines(harness: string, input: string, flags: readonly string[], made: HookLines, delivered: DeliveredEvent, handOff: HookInput["handOff"], merges: MergeWatch | undefined, locate: LocateOptions | undefined, failed: (stage: HookFailure["stage"], error: unknown) => void, guarded = false, clock?: HookClock, git: Git = runGit): Promise<void> {
  let turn: (() => void) | undefined;
  try {
    if (made.lines.length === 0) return;
    const grace = flags.includes(AFTER_TOOL) ? TOOL_GRACE_MS : harness === "claude-code" ? 0 : undefined;
    if (grace !== undefined && (await deliveredByTool(storytreeHome(), delivered.key, grace))) {
      const where = route(made.folder, locate);
      const { due } = await import("../claims/merges.js");
      if (where.status !== "routed" || !due(`${where.project}-after-tool`, UPKEEP_EVERY_MS)) {
        const { worktreeRoot } = await import("../activity/branch.js");
        const [root, first] = [worktreeRoot(made.folder), made.lines[0]];
        if (guarded && root !== undefined && first !== undefined && where.status !== "not-a-project" && approvedHere(where.project, made.folder, homeOf(locate))) watchWorktree(storytreeHome(), root, first, failed, git);
        return;
      }
    }
    const placed = await place(made, locate);
    if (placed === undefined) return;
    const { where } = placed;
    made = placed.made;
    const home = storytreeHome();
    const { enqueue, uploadQueued } = await import("./queue.js");
    const written = { count: 0 };
    leaveWaiting = () => {
      failed("write", new Error(`cut off at its deadline with ${made.lines.length - written.count} of its ${made.lines.length} lines unwritten`));
      enqueue(home, where.project, made.lines.slice(written.count), delivered);
    };
    const ready = await prepare(placed, locate, failed, guarded, git);
    const { firstLine } = ready;
    made = ready.made;
    if (where.status === "not-running") {
      enqueue(home, where.project, made.lines, delivered);
      return;
    }
    if (flags.includes(BACKGROUND) && handOff !== undefined) {
      await handOff(harness, input);
      return undefined;
    }
    const remote = remoteAddress(where.library.address);
    turn = remote ? takeTurn(home) : undefined;
    if (remote && turn === undefined) {
      leaveWaiting = undefined;
      enqueue(home, where.project, made.lines, delivered);
      return;
    }
    const [{ openActivityLog, thisMachine, currentBranch }, { connect }] = await Promise.all([import("../activity/index.js"), import("@storytree/library")]);
    const machine = thisMachine();
    let opened;
    const connecting = performance.now();
    try {
      const storytree = await connect(withDeadline(where.library, CONNECT_TIMEOUT_MS));
      const log = await (async () => {
        await requireApproval(storytree, where.project, where.folder, homeOf(locate));
        return openActivityLog(storytree, { connectTimeoutMs: CONNECT_TIMEOUT_MS, branchOf: currentBranch, ...(machine === undefined ? {} : { machine }) });
      })().catch(async (error: unknown) => {
        await storytree.close();
        throw error;
      });
      opened = { storytree, log };
    } catch (error) {
      leaveWaiting = undefined;
      if (error instanceof ProjectFolderError) return;
      failed("reach", error);
      enqueue(home, where.project, made.lines, delivered);
      return;
    } finally {
      clock?.add("connect", performance.now() - connecting);
    }
    const { storytree, log } = opened;
    const writing = performance.now();
    const handing = clock?.spent("handoff") ?? 0;
    try {
      if (where.identity !== undefined && (await storytree.projectIdentities())[where.project] !== where.identity) return void (leaveWaiting = undefined);
      if (firstLine !== undefined) await watchImports(storytree, where.project, homeOf(locate), home, firstLine, failed, git);
      await uploadQueued(home, log, async (project, folder) => rememberedImports(home, project).some((place) => place.folder === folder) || approved(storytree, project, folder, homeOf(locate)));
      const [by] = made.lines;
      if (by !== undefined) {
        const { recordMachineStart } = await import("../sessions/machine-start.js");
        await recordMachineStart(home, log, where.project, { session: by.session, ...(by.harness === undefined ? {} : { harness: by.harness }) }).catch(() => undefined);
      }
      await appendEvent(log, where.project, made.lines, delivered, written);
      leaveWaiting = undefined;
      const [first] = made.lines;
      if (first !== undefined && first.kind !== "tool-requested" && first.kind !== "prompt-submitted") {
        const library = () => openNamedProject(storytree, where.project, where.identity);
        const watcher = { log, project: where.project, folder: made.folder, session: first.session, ...(first.harness === undefined ? {} : { harness: first.harness }), source: "hook", library } as const;
        const looks = first.kind !== "session-ended";
        if (looks && handOff !== undefined) {
          const { due } = await import("../claims/merges.js");
          if (due(`${where.project}-upkeep`, merges?.everyMs ?? UPKEEP_EVERY_MS)) await handOff(harness, input, [UPKEEP]);
        }
        const { endMergedClaims } = await import("../claims/index.js");
        await endMergedClaims(watcher, merges);
        if (first.transcript !== undefined) {
          const { shipTranscript } = await import("../transcripts/index.js");
          await shipTranscript(log, where.project, first.session, first.transcript);
        }
        if (looks && handOff === undefined) await lookAround(watcher, merges);
      }
    } catch (error) {
      leaveWaiting = undefined;
      failed("write", error);
      enqueue(home, where.project, made.lines.slice(written.count), delivered);
    } finally {
      clock?.add("write", performance.now() - writing - ((clock?.spent("handoff") ?? 0) - handing));
      await log.close();
      await storytree.close();
    }
  } catch (error) {
    failed("write", error);
  } finally {
    leaveWaiting = undefined;
    turn?.();
  }
}

const UPKEEP_EVERY_MS = 60_000;

async function upkeep(made: HookLines, merges: MergeWatch | undefined, locate: LocateOptions | undefined): Promise<void> {
  const [first] = made.lines;
  const where = route(made.folder, locate);
  if (first === undefined || where.status !== "routed") return;
  const [{ openActivityLog, currentBranch, thisMachine }, { connect }] = await Promise.all([import("../activity/index.js"), import("@storytree/library")]);
  const machine = thisMachine();
  const storytree = await connect(withDeadline(where.library, CONNECT_TIMEOUT_MS, UPKEEP_DEADLINE_MS));
  try {
    if (!(await approved(storytree, where.project, where.folder, homeOf(locate)))) return;
    const log = await openActivityLog(storytree, { connectTimeoutMs: CONNECT_TIMEOUT_MS, branchOf: currentBranch, ...(machine === undefined ? {} : { machine }) });
    try {
      const { uploadHookTimes } = await import("./timing.js");
      await uploadHookTimes(storytreeHome(), log, where.project, { session: first.session, ...(first.harness === undefined ? {} : { harness: first.harness }) });
      await lookAround({ log, project: where.project, folder: made.folder, session: first.session, ...(first.harness === undefined ? {} : { harness: first.harness }), source: "hook" }, { ...merges, everyMs: 0 });
    } finally {
      await log.close();
    }
  } finally {
    await storytree.close();
  }
}

async function lookAround(watcher: MergeContext, watch: MergeWatch | undefined): Promise<void> {
  const { resolveBranches } = await import("../sessions/branch-states.js");
  await resolveBranches(watcher, watch).catch(() => []);
  const { reapWorktrees } = await import("../sessions/worktree-reaper.js");
  await reapWorktrees(watcher, watch?.everyMs === undefined ? {} : { everyMs: watch.everyMs }).catch(() => []);
  const { pruneBaselinesWhenDue } = await import("./shell-edits.js");
  pruneBaselinesWhenDue(storytreeHome());
  const { recordAppStates } = await import("../sessions/app-records.js");
  await recordAppStates(watcher, watch?.everyMs === undefined ? {} : { everyMs: watch.everyMs }).catch(() => []);
}

function promptIn(harness: string, input: unknown): Prompted | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  if (harness === "cursor") {
    const { hook_event_name: event, prompt } = input as Record<string, unknown>;
    const about = cursorSession(input as Record<string, unknown>);
    return event !== "beforeSubmitPrompt" || about === undefined || typeof prompt !== "string" ? undefined : { harness, ...about, prompt };
  }
  if (harness === "pi") {
    const { hook_event_name: event, prompt } = input as Record<string, unknown>;
    const about = piSession(input as Record<string, unknown>);
    return event !== "before_agent_start" || about === undefined || typeof prompt !== "string" ? undefined : { harness, ...about, prompt };
  }
  if ((harness !== "claude-code" && harness !== "codex") || inCursor(input)) return undefined;
  const { hook_event_name: event, session_id: session, cwd: folder, prompt } = input as Record<string, unknown>;
  if (event !== "UserPromptSubmit" || typeof session !== "string" || typeof folder !== "string" || folder === "" || typeof prompt !== "string") return undefined;
  return { harness, session, folder, prompt };
}

async function contextForPrompt({ harness, session, folder, prompt }: Prompted): Promise<{ context?: string[]; report?: InjectionReport; given: Given[] } | undefined> {
  if (isHarnessNotice(prompt)) return undefined;
  const where = route(folder);
  if (where.status !== "routed") return undefined;
  const { connect } = await import("@storytree/library");
  const storytree = await connect(withDeadline(where.library, CONNECT_TIMEOUT_MS));
  try {
    if (!(await approved(storytree, where.project, where.folder, storytreeHome()))) return undefined;
    const library = await openNamedProject(storytree, where.project, where.identity);
    const named = definitionsNamedIn(prompt, (await library.definitions()).map(({ id, fields }) => ({ id, ...fields })));
    const fresh = notYetGiven(session, named);
    const [nudge, lapsed] = await Promise.all([harness === "claude-code" ? contextNudge(storytree, where.project, session) : undefined, lapsedAtPrompt(storytree, where.project, session)]);
    const definitions = fresh.length === 0 ? undefined : definitionsContext(fresh);
    const context = [...(lapsed === undefined ? [] : [lapsed]), ...(definitions === undefined ? [] : [definitions]), ...(nudge === undefined ? [] : [nudge])];
    const report = definitions === undefined ? undefined : bigInjectionReport(session, fresh, definitions);
    const given: Given[] = [
      ...(fresh.length === 0 ? [] : [{ ledger: "definitions" as const, ids: fresh.map(({ id }) => id) }]),
      ...(nudge === undefined ? [] : [{ ledger: "context-nudges" as const, ids: [START_FRESH] }]),
    ];
    return { ...(context.length === 0 ? {} : { context }), ...(report === undefined ? {} : { report }), given };
  } finally {
    await storytree.close();
  }
}

async function lapsedAtPrompt(storytree: Storytree, project: string, session: string): Promise<string | undefined> {
  const [{ openActivityLog }, { lapseNotice }] = await Promise.all([import("../activity/index.js"), import("../claims/lapses.js")]);
  const log = await openActivityLog(storytree);
  try {
    return await lapseNotice(log, project, session);
  } finally {
    await log.close();
  }
}

async function fileBigInjection(handed: unknown): Promise<void> {
  const { session_id: session, cwd: folder, report } = (handed ?? {}) as { session_id?: unknown; cwd?: unknown; report?: InjectionReport };
  if (typeof session !== "string" || typeof folder !== "string" || report === undefined) return;
  const where = route(folder);
  if (where.status !== "routed") return;
  const [{ recordFriction }, { currentBranch }, { connect }] = await Promise.all([import("../friction/index.js"), import("../activity/branch.js"), import("@storytree/library")]);
  const storytree = await connect(withDeadline(where.library, CONNECT_TIMEOUT_MS));
  try {
    if (!(await approved(storytree, where.project, where.folder, storytreeHome()))) return;
    const library = await openNamedProject(storytree, where.project, where.identity);
    const branch = currentBranch(folder);
    await recordFriction(library, { ...report, ...(branch === undefined ? {} : { branch }) }, { actor: `session:${session}` });
  } finally {
    await storytree.close();
  }
}

function homeOf(locate: LocateOptions | undefined): string {
  return locate?.home ?? (locate?.dataDir === undefined ? storytreeHome() : path.dirname(path.resolve(locate.dataDir)));
}

async function approved(storytree: Storytree, project: string, folder: string, home: string): Promise<boolean> {
  try {
    await requireApproval(storytree, project, folder, home);
    return true;
  } catch (error) {
    if (error instanceof ProjectFolderError) return false;
    throw error;
  }
}

function withinTime<T>(work: Promise<T | undefined>, limitMs = CONNECT_TIMEOUT_MS): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<undefined>((resolve) => (timer = setTimeout(() => resolve(undefined), limitMs)));
  return Promise.race([work.catch(() => undefined), late]).finally(() => clearTimeout(timer));
}

export async function givenWithinTime<L extends { readonly given?: readonly Given[] }>(session: string, lookup: Promise<L | undefined>, limitMs?: number): Promise<L | undefined> {
  const looked = await withinTime(lookup, limitMs);
  try {
    for (const given of looked?.given ?? []) markGiven(session, given);
  } catch {
  }
  return looked;
}

function withEvent(parsed: unknown, flags: readonly string[]): unknown {
  const event = flags.find((flag) => flag.startsWith(EVENT))?.slice(EVENT.length);
  return event === undefined || typeof parsed !== "object" || parsed === null || Array.isArray(parsed) ? parsed : { ...parsed, hook_event_name: event };
}

function parse(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return undefined;
  }
}
