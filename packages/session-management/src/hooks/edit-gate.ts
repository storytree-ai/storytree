// Capability 3 · Hooks
import path from "node:path";

import type { DeclaredCapabilities, GateContext, ImportedFolderPlace, ReadsCode } from "../claims/edit-gate.js";
import type { LocateOptions } from "@storytree/project-and-caller";
import { patchEdits } from "./codex.js";
import { cursorSession } from "./cursor.js";
import { piEdit, piSession } from "./pi.js";
import { antigravityEdit, antigravitySession } from "./antigravity.js";
import { withDeadline } from "./deadlines.js";
import { limitOf, withinLimit, type Step } from "./learned-limits.js";
import { isSelfNamed, selfNamedEdit } from "./self-named.js";
import type { HookFailure } from "./failures.js";

export const EDIT_GATE = "--edit-gate";

export const EDIT_GATE_STEP: Step = { name: "edit-gate", floorMs: 3_000, ceilingMs: 8_000 };

export function editIn(harness: string, input: unknown): { session: string; folder: string; files: { path: string; text?: string }[] } | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  if (harness === "cursor") return cursorEditIn(input as Record<string, unknown>);
  if (harness === "pi") return piEditIn(input as Record<string, unknown>);
  if (harness === "antigravity") return antigravityEditIn(input as Record<string, unknown>);
  if (isSelfNamed(harness)) return selfNamedEditIn(input as Record<string, unknown>);
  if (typeof (input as Record<string, unknown>).cursor_version === "string") return undefined;
  const { hook_event_name: event, session_id: session, cwd: folder, tool_name: tool, tool_input: toolInput } = input as Record<string, unknown>;
  if (event !== "PreToolUse" || !isText(session) || !isText(folder) || typeof toolInput !== "object" || toolInput === null) return undefined;
  const given = toolInput as Record<string, unknown>;
  const files =
    harness === "claude-code" && (tool === "Write" || tool === "Edit" || tool === "MultiEdit") && isText(given.file_path)
      ? [{ path: given.file_path, ...(tool === "Write" && typeof given.content === "string" ? { text: given.content } : {}) }]
      : harness === "claude-code" && tool === "NotebookEdit" && isText(given.notebook_path)
        ? [{ path: given.notebook_path }]
        : harness === "codex" && tool === "apply_patch" && typeof given.command === "string"
          ? patchEdits(given.command)
          : [];
  return files.length === 0 ? undefined : { session, folder, files };
}

function selfNamedEditIn(input: Record<string, unknown>): ReturnType<typeof editIn> {
  const { hook_event_name: event, session_id: session, cwd: folder } = input;
  const file = selfNamedEdit(input);
  return event !== "PreToolUse" || !isText(session) || !isText(folder) || file === undefined ? undefined : { session, folder, files: [file] };
}

function piEditIn(input: Record<string, unknown>): ReturnType<typeof editIn> {
  const about = piSession(input);
  const file = about === undefined ? undefined : piEdit(input, about.folder);
  return input.hook_event_name !== "tool_call" || about === undefined || file === undefined ? undefined : { ...about, files: [file] };
}

function antigravityEditIn(input: Record<string, unknown>): ReturnType<typeof editIn> {
  const about = antigravitySession(input);
  const file = about === undefined ? undefined : antigravityEdit(input, about.folder);
  return input.hook_event_name !== "PreToolUse" || about === undefined || file === undefined ? undefined : { ...about, files: [file] };
}

const CURSOR_EDITS = new Set(["Write", "StrReplace", "Delete", "MultiEdit", "Edit"]);

function cursorEditIn(input: Record<string, unknown>): ReturnType<typeof editIn> {
  const about = cursorSession(input);
  const { hook_event_name: event, tool_name: tool, tool_input: toolInput } = input;
  if (event !== "preToolUse" || about === undefined || !isText(tool)) return undefined;
  if (tool === "ApplyPatch") {
    const files = typeof toolInput === "string" ? patchEdits(toolInput) : [];
    return files.length === 0 ? undefined : { ...about, files };
  }
  if (!CURSOR_EDITS.has(tool) || typeof toolInput !== "object" || toolInput === null) return undefined;
  const given = toolInput as Record<string, unknown>;
  const file = isText(given.file_path) ? given.file_path : given.path;
  const text = typeof given.content === "string" ? given.content : given.contents;
  return !isText(file) ? undefined : { ...about, files: [{ path: file, ...(tool === "Write" && typeof text === "string" ? { text } : {}) }] };
}

export function refusalAnswer(harness: string, reason: string, ask = false): string {
  if (ask && harness === "claude-code") return JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: reason } });
  if (ask) reason = `${reason} This harness cannot ask the user at the edit, so it is refused: ask the user in the conversation, and if they say yes, they send that command on its own line as their own message (you cannot send it for them), or run it at their own terminal (an agent's shell is refused it), then edit again.`;
  if (harness === "pi") return JSON.stringify({ block: true, reason });
  if (harness === "antigravity") return JSON.stringify({ decision: "deny", reason });
  if (harness === "cursor") return JSON.stringify({ permission: "deny", user_message: reason, agent_message: reason });
  return JSON.stringify({ decision: "block", reason, hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } });
}

export async function editGate(harness: string, input: unknown, declared: DeclaredCapabilities | undefined, locate: LocateOptions | undefined, home: string, failed: (stage: HookFailure["stage"], error: unknown) => void, gateMs?: number, readsCode?: ReadsCode, isCode?: ReadsCode): Promise<string | undefined> {
  const edit = editIn(harness, input);
  if (edit === undefined || declared === undefined) return undefined;
  const limit = gateMs ?? limitOf(home, EDIT_GATE_STEP);
  try {
    const result = await withinLimit(EDIT_GATE_STEP, limit, gateMs === undefined ? home : undefined, (limitMs) => refusalFor(harness, edit, declared, locate, home, limitMs, readsCode, isCode));
    const refusal = result.late ? undefined : result.answer;
    if (refusal === undefined) return undefined;
    return refusalAnswer(harness, refusal.reason, refusal.ask);
  } catch (error) {
    failed("hook", error);
    return undefined;
  }
}

async function refusalFor(harness: string, edit: NonNullable<ReturnType<typeof editIn>>, declared: DeclaredCapabilities, locate: LocateOptions | undefined, home: string, limitMs: number, readsCode?: ReadsCode, isCode?: ReadsCode): Promise<{ reason: string; ask: boolean } | undefined> {
  const { editRefusal, refusalMessage } = await import("../claims/edit-gate.js");
  return gated(harness, edit, locate, home, async (context, checkout, imports) => {
    const refusal = await editRefusal(context, checkout, edit.files, declared, imports, readsCode, isCode);
    return refusal === undefined ? undefined : { reason: refusalMessage(refusal), ask: refusal.refused === "ask" };
  }, limitMs);
}

export async function recordYesAfterEdit(harness: string, input: unknown, locate: LocateOptions | undefined, home: string, failed: (stage: HookFailure["stage"], error: unknown) => void, guardMs?: number, isCode?: ReadsCode): Promise<void> {
  if (harness !== "claude-code" || typeof input !== "object" || input === null || (input as Record<string, unknown>).hook_event_name !== "PostToolUse") return;
  const edit = editIn(harness, { ...input, hook_event_name: "PreToolUse" });
  if (edit === undefined) return;
  const limit = guardMs ?? limitOf(home, EDIT_GATE_STEP);
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<undefined>((resolve) => (timer = setTimeout(() => resolve(undefined), limit)));
  try {
    const { recordPromptYes } = await import("../claims/edit-gate.js");
    await Promise.race([gated(harness, edit, locate, home, (context, checkout, imports) => recordPromptYes(context, checkout, edit.files, imports, isCode), limit), late]);
  } catch (error) {
    failed("hook", error);
  } finally {
    clearTimeout(timer);
  }
}

const SAID_ALLOW = /^`?(?:(?:pnpm|npx)\s+(?:-s\s+)?)?storytree\s+workspace\s+allow\s+(\S+?)`?$/;

export function allowsSaidIn(prompt: string): string[] {
  return [...new Set(prompt.split(/\r?\n/).flatMap((line) => SAID_ALLOW.exec(line.trim())?.[1] ?? []))];
}

export async function yesSaid(harness: string, prompted: { session: string; folder: string; prompt: string }, locate: LocateOptions | undefined, home: string, failed: (stage: HookFailure["stage"], error: unknown) => void, guardMs?: number): Promise<string[] | undefined> {
  const increments = allowsSaidIn(prompted.prompt);
  if (increments.length === 0) return undefined;
  const limit = guardMs ?? limitOf(home, EDIT_GATE_STEP);
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<undefined>((resolve) => (timer = setTimeout(() => resolve(undefined), limit)));
  try {
    const { allowSaid } = await import("../claims/edit-gate.js");
    const told = await Promise.race([gated(harness, { session: prompted.session, folder: prompted.folder, files: [] }, locate, home, async (context) => {
      const answers: string[] = [];
      for (const increment of increments) {
        const allowed = await allowSaid(context, increment);
        answers.push(allowed.ok
          ? `[storytree] The user's yes to changing imported code for increment ${increment} is recorded for this session: it covers what the increment lists now (${allowed.capabilities.map(({ capability }) => capability).join(", ")}). Make the edit again.`
          : `[storytree] The user said yes for ${increment}, but nothing was recorded: ${allowed.reason}`);
      }
      return answers;
    }, limit), late]);
    return told === undefined || told.length === 0 ? undefined : told;
  } catch (error) {
    failed("hook", error);
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

export async function gated<T>(harness: string, edit: NonNullable<ReturnType<typeof editIn>>, locate: LocateOptions | undefined, home: string, work: (context: GateContext, checkout: string, imports: readonly ImportedFolderPlace[]) => Promise<T>, limitMs = EDIT_GATE_STEP.floorMs): Promise<T | undefined> {
  const { route, requireApproval, openNamedProject, ProjectFolderError, importsOf, machineOf } = await import("@storytree/project-and-caller");
  const where = route(edit.folder, locate);
  if (where.status !== "routed") return undefined;
  const [{ openActivityLog, thisMachine }, { worktreeRoot }, { connect }] = await Promise.all([
    import("../activity/index.js"), import("../activity/branch.js"), import("@storytree/library"),
  ]);
  const checkout = worktreeRoot(edit.folder) ?? path.resolve(edit.folder);
  const storytree = await connect(withDeadline(where.library, limitMs, limitMs));
  try {
    try {
      await requireApproval(storytree, where.project, where.folder, home);
    } catch (error) {
      if (error instanceof ProjectFolderError) return undefined;
      throw error;
    }
    const machine = thisMachine();
    const log = await openActivityLog(storytree, { connectTimeoutMs: limitMs, ...(machine === undefined ? {} : { machine }) });
    try {
      const library = await openNamedProject(storytree, where.project, where.identity);
      const imports = await importsOf(storytree, where.project, machineOf(home).id);
      return await work({ log, library, project: where.project, session: edit.session, harness, folder: checkout }, checkout, imports);
    } finally {
      await log.close();
    }
  } finally {
    await storytree.close();
  }
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}
