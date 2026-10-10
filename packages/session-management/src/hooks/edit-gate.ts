/**
 * Capability 3 · Hooks. The hook before each file-edit tool (`--edit-gate`, ADR-0949 D3), which the
 * harness waits for: it asks claims/edit-gate.ts whether the session may edit the files the tool names,
 * and when it may not, answers the harness with a refusal the agent reads, so the edit never happens.
 * Claude Code's Write, Edit, MultiEdit and NotebookEdit name their file; Write gives the file's whole new
 * text, read for its declaration since a new file has none on disk. Codex's apply_patch names its files
 * in the patch, and gives an added file's text there.
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
import { withDeadline } from "./deadlines.js";
import type { HookFailure } from "./failures.js";

/** The flag of the hook before each file-edit tool. */
export const EDIT_GATE = "--edit-gate";

/** How long the gate may take before the edit goes ahead unasked: the harness waits on it. */
const GATE_MS = 3_000;

/** The edit a pre-tool hook's input from `harness` is about to make, or undefined when it is not a file edit. */
export function editIn(harness: string, input: unknown): { session: string; folder: string; files: { path: string; text?: string }[] } | undefined {
  if (typeof input !== "object" || input === null) return undefined;
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

/** The gate's answer for the harness: a refusal when the edit may not happen, else undefined. Never throws; `failed` keeps why it gave up. */
export async function editGate(harness: string, input: unknown, declared: DeclaredCapabilities | undefined, locate: LocateOptions | undefined, home: string, failed: (stage: HookFailure["stage"], error: unknown) => void): Promise<string | undefined> {
  const edit = editIn(harness, input);
  if (edit === undefined || declared === undefined) return undefined;
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<undefined>((resolve) => (timer = setTimeout(() => resolve(undefined), GATE_MS)));
  try {
    const reason = await Promise.race([refusalFor(harness, edit, declared, locate, home), late]);
    if (reason === undefined) return undefined;
    // Claude Code reads the pre-tool decision; Codex reads the block it reads from a Stop hook.
    return JSON.stringify({ decision: "block", reason, hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } });
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
