/**
 * Capability 3 · Hooks. The hook before each file-edit tool (`--edit-gate`, ADR-0949 D3), which the
 * harness waits for: it asks claims/edit-gate.ts whether the session may edit the files the tool names,
 * and when it may not, answers the harness with a refusal the agent reads, so the edit never happens.
 * Claude Code's Write, Edit, MultiEdit and NotebookEdit name their file; Write gives the file's whole new
 * text, read for its declaration since a new file has none on disk. Codex's apply_patch names its files
 * in the patch, and gives an added file's text there. Cursor's Write, StrReplace and Delete name their file
 * (`file_path` from its command line, `path` in its editor's transcripts) and its ApplyPatch is the patch text;
 * a Claude Code hook that Cursor runs gates nothing, since Cursor's own entry does (3.28). A harness that names
 * itself sends a published Edit or Write (self-named.ts), and reads the refusal in Claude Code's shape. Pi's
 * write and edit name their file by `path` (pi.ts), and its extension hands Pi the `{block, reason}` refusal.
 *
 * Which capability a file declares is the map's rule, given by the hook command that runs this (the app
 * setup's, ADR-0969); a hook given none refuses nothing. A file in a folder the project imports on this machine is
 * placed by the gate itself (claims/edit-gate.ts); when its edit may go ahead only on the user's yes (ADR-1015), Claude
 * Code is answered "ask", so the harness asks its user, and a harness with no such answer is refused, naming the command
 * the user types at their own terminal to say yes, or sends as their own message. After Claude Code runs an edit it was
 * told to ask about, the user allowed it: the hook after the edit records that yes on the increment (recordPromptYes),
 * so its next edits go through unasked (contract 5.41). A user who sends that command on its own line of a message has
 * said yes in the conversation: the prompt hook, which sees the user's words and never the agent's, records it for its
 * session (yesSaid, contract 5.42).
 *
 * Like every hook it never breaks the agent: outside a storytree project, in a checkout whose trunk is
 * not approved, when storytree cannot be reached in time, or on any failure, it says nothing and the
 * edit goes ahead.
 */
import path from "node:path";

import type { DeclaredCapabilities, GateContext, ImportedFolderPlace } from "../claims/edit-gate.js";
import type { LocateOptions } from "../routing/index.js";
import { patchEdits } from "./codex.js";
import { cursorSession } from "./cursor.js";
import { piEdit, piSession } from "./pi.js";
import { antigravityEdit, antigravitySession } from "./antigravity.js";
import { withDeadline } from "./deadlines.js";
import { isSelfNamed, selfNamedEdit } from "./self-named.js";
import type { HookFailure } from "./failures.js";

/** The flag of the hook before each file-edit tool. */
export const EDIT_GATE = "--edit-gate";

/** How long the gate may take before the edit goes ahead unasked: the harness waits on it. */
const GATE_MS = 3_000;

/** The edit a pre-tool hook's input from `harness` is about to make, or undefined when it is not a file edit. */
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

/** The file edit a self-named harness's pre-tool input is about to make: its published Edit or Write (ADR-1007 D4). */
function selfNamedEditIn(input: Record<string, unknown>): ReturnType<typeof editIn> {
  const { hook_event_name: event, session_id: session, cwd: folder } = input;
  const file = selfNamedEdit(input);
  return event !== "PreToolUse" || !isText(session) || !isText(folder) || file === undefined ? undefined : { session, folder, files: [file] };
}

/** The file edit a Pi tool call is about to make. */
function piEditIn(input: Record<string, unknown>): ReturnType<typeof editIn> {
  const about = piSession(input);
  const file = about === undefined ? undefined : piEdit(input, about.folder);
  return input.hook_event_name !== "tool_call" || about === undefined || file === undefined ? undefined : { ...about, files: [file] };
}

/** The file edit an Antigravity pre-tool input is about to make. */
function antigravityEditIn(input: Record<string, unknown>): ReturnType<typeof editIn> {
  const about = antigravitySession(input);
  const file = about === undefined ? undefined : antigravityEdit(input, about.folder);
  return input.hook_event_name !== "PreToolUse" || about === undefined || file === undefined ? undefined : { ...about, files: [file] };
}

/** Cursor's tools that write one named file. */
const CURSOR_EDITS = new Set(["Write", "StrReplace", "Delete", "MultiEdit", "Edit"]);

/** The file edit a Cursor pre-tool input is about to make. */
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

/**
 * A refusal in the shape `harness` reads. Claude Code reads the pre-tool decision and Codex the block it reads
 * from a Stop hook; Cursor reads a denied permission, and blocks the tool on any answer it cannot parse.
 * Pi's extension returns the answer from its tool_call handler, and the model reads `reason` as the tool's result.
 * With `ask`, Claude Code is told to ask its user, who alone may allow the edit; every other harness is refused.
 */
export function refusalAnswer(harness: string, reason: string, ask = false): string {
  if (ask && harness === "claude-code") return JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: reason } });
  if (ask) reason = `${reason} This harness cannot ask the user at the edit, so it is refused: ask the user in the conversation, and if they say yes, they send that command on its own line as their own message (you cannot send it for them), or run it at their own terminal (an agent's shell is refused it), then edit again.`;
  if (harness === "pi") return JSON.stringify({ block: true, reason });
  if (harness === "antigravity") return JSON.stringify({ decision: "deny", reason });
  if (harness === "cursor") return JSON.stringify({ permission: "deny", user_message: reason, agent_message: reason });
  return JSON.stringify({ decision: "block", reason, hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } });
}

/** The gate's answer for the harness: a refusal when the edit may not happen, else undefined. Never throws; `failed` keeps why it gave up. */
export async function editGate(harness: string, input: unknown, declared: DeclaredCapabilities | undefined, locate: LocateOptions | undefined, home: string, failed: (stage: HookFailure["stage"], error: unknown) => void): Promise<string | undefined> {
  const edit = editIn(harness, input);
  if (edit === undefined || declared === undefined) return undefined;
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<undefined>((resolve) => (timer = setTimeout(() => resolve(undefined), GATE_MS)));
  try {
    const refusal = await Promise.race([refusalFor(harness, edit, declared, locate, home), late]);
    if (refusal === undefined) return undefined;
    return refusalAnswer(harness, refusal.reason, refusal.ask);
  } catch (error) {
    failed("hook", error);
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

async function refusalFor(harness: string, edit: NonNullable<ReturnType<typeof editIn>>, declared: DeclaredCapabilities, locate: LocateOptions | undefined, home: string): Promise<{ reason: string; ask: boolean } | undefined> {
  const { editRefusal, refusalMessage } = await import("../claims/edit-gate.js");
  return gated(harness, edit, locate, home, async (context, checkout, imports) => {
    const refusal = await editRefusal(context, checkout, edit.files, declared, imports);
    return refusal === undefined ? undefined : { reason: refusalMessage(refusal), ask: refusal.refused === "ask" };
  });
}

/**
 * After a Claude Code edit tool ran (its PostToolUse): record the user's yes when the gate would have asked for the
 * edit, which the harness then asked its user and they allowed (contract 5.41). Never throws; `failed` keeps why it gave up.
 */
export async function recordYesAfterEdit(harness: string, input: unknown, locate: LocateOptions | undefined, home: string, failed: (stage: HookFailure["stage"], error: unknown) => void): Promise<void> {
  if (harness !== "claude-code" || typeof input !== "object" || input === null || (input as Record<string, unknown>).hook_event_name !== "PostToolUse") return;
  const edit = editIn(harness, { ...input, hook_event_name: "PreToolUse" });
  if (edit === undefined) return;
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<undefined>((resolve) => (timer = setTimeout(() => resolve(undefined), GATE_MS)));
  try {
    const { recordPromptYes } = await import("../claims/edit-gate.js");
    await Promise.race([gated(harness, edit, locate, home, (context, checkout, imports) => recordPromptYes(context, checkout, edit.files, imports)), late]);
  } catch (error) {
    failed("hook", error);
  } finally {
    clearTimeout(timer);
  }
}

/** The allow command on a line of its own, as the user types it at a terminal or sends it, perhaps in backticks or led by pnpm or npx. */
const SAID_ALLOW = /^`?(?:(?:pnpm|npx)\s+(?:-s\s+)?)?storytree\s+workspace\s+allow\s+(\S+?)`?$/;

/** The increments a user's prompt says yes to: each line that is, trimmed, the allow command. A sentence that mentions it says nothing. */
export function allowsSaidIn(prompt: string): string[] {
  return [...new Set(prompt.split(/\r?\n/).flatMap((line) => SAID_ALLOW.exec(line.trim())?.[1] ?? []))];
}

/**
 * At a prompt: record the yes the user said for each increment the prompt names with the allow command on its own line
 * (contract 5.42), and what to tell the agent of each; undefined when it names none. Never throws; `failed` keeps why it gave up.
 */
export async function yesSaid(harness: string, prompted: { session: string; folder: string; prompt: string }, locate: LocateOptions | undefined, home: string, failed: (stage: HookFailure["stage"], error: unknown) => void): Promise<string[] | undefined> {
  const increments = allowsSaidIn(prompted.prompt);
  if (increments.length === 0) return undefined;
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<undefined>((resolve) => (timer = setTimeout(() => resolve(undefined), GATE_MS)));
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
    }), late]);
    return told === undefined || told.length === 0 ? undefined : told;
  } catch (error) {
    failed("hook", error);
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** Run `work` with the gate's view of the session's project, when its folder is an approved project on a reachable storytree (also the shell guard's, shell-guard.ts). */
export async function gated<T>(harness: string, edit: NonNullable<ReturnType<typeof editIn>>, locate: LocateOptions | undefined, home: string, work: (context: GateContext, checkout: string, imports: readonly ImportedFolderPlace[]) => Promise<T>): Promise<T | undefined> {
  const { route, requireApproval, openNamedProject, ProjectFolderError, importsOf, machineOf } = await import("../routing/index.js");
  const where = route(edit.folder, locate);
  if (where.status !== "routed") return undefined;
  const [{ openActivityLog, thisMachine }, { worktreeRoot }, { connect }] = await Promise.all([
    import("../activity/index.js"), import("../activity/branch.js"), import("@storytree/library"),
  ]);
  const checkout = worktreeRoot(edit.folder) ?? path.resolve(edit.folder);
  const storytree = await connect(withDeadline(where.library, GATE_MS, GATE_MS));
  try {
    try {
      await requireApproval(storytree, where.project, where.folder, home);
    } catch (error) {
      if (error instanceof ProjectFolderError) return undefined;
      throw error;
    }
    const machine = thisMachine();
    const log = await openActivityLog(storytree, { connectTimeoutMs: GATE_MS, ...(machine === undefined ? {} : { machine }) });
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
