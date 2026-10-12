/**
 * Capability 3 · Hooks. The hook before each file-edit tool (`--edit-gate`, ADR-0949 D3), which the
 * harness waits for: it asks claims/edit-gate.ts whether the session may edit the files the tool names,
 * and when it may not, answers the harness with a refusal the agent reads, so the edit never happens.
 * Claude Code's Write, Edit, MultiEdit and NotebookEdit name their file; Write gives the file's whole new
 * text, read for its declaration since a new file has none on disk. Codex's apply_patch names its files
 * in the patch, and gives an added file's text there. Cursor's Write, StrReplace and Delete name their file
 * (`file_path` from its command line, `path` in its editor's transcripts) and its ApplyPatch is the patch text;
 * a Claude Code hook that Cursor runs gates nothing, since Cursor's own entry does (3.28). A harness that names
 * itself sends a published Edit or Write (self-named.ts), and reads the refusal in Claude Code's shape.
 *
 * Which capability a file declares is the map's rule, given by the hook command that runs this (the app
 * setup's, ADR-0969); a hook given none refuses nothing.
 *
 * Like every hook it never breaks the agent: outside a storytree project, in a checkout whose trunk is
 * not approved, when storytree cannot be reached in time, or on any failure, it says nothing and the
 * edit goes ahead.
 */
import path from "node:path";

import type { DeclaredCapabilities } from "../claims/edit-gate.js";
import type { LocateOptions } from "../routing/index.js";
import { patchEdits } from "./codex.js";
import { cursorSession } from "./cursor.js";
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
 */
export function refusalAnswer(harness: string, reason: string): string {
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
    const reason = await Promise.race([refusalFor(harness, edit, declared, locate, home), late]);
    if (reason === undefined) return undefined;
    return refusalAnswer(harness, reason);
  } catch (error) {
    failed("hook", error);
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

async function refusalFor(harness: string, edit: NonNullable<ReturnType<typeof editIn>>, declared: DeclaredCapabilities, locate: LocateOptions | undefined, home: string): Promise<string | undefined> {
  const { route, requireApproval, openNamedProject, ProjectFolderError } = await import("../routing/index.js");
  const where = route(edit.folder, locate);
  if (where.status !== "routed") return undefined;
  const [{ openActivityLog, thisMachine }, { worktreeRoot }, { connect }, { editRefusal, refusalMessage }] = await Promise.all([
    import("../activity/index.js"), import("../activity/branch.js"), import("@storytree/library"), import("../claims/edit-gate.js"),
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
      const refusal = await editRefusal({ log, library, project: where.project, session: edit.session, harness, folder: checkout }, checkout, edit.files, declared);
      return refusal === undefined ? undefined : refusalMessage(refusal);
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
