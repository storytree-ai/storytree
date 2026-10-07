/**
 * Capability 8 · Setup check. Whether a session's hooks are proven to fire (ADR-0625 D9, ADR-0626 D5): the connection shows as
 * verified only once storytree has received all four from that session, a session start, a call to
 * a storytree tool (check_setup's own call fires it), a file edit and a command, each written by a
 * hook. Until then each missing one is named, with its fix.
 */
import path from "node:path";

import type { Line } from "../activity/index.js";

/** The four hooks a session's setup is verified by, in the order they fire. */
export const HOOK_TESTS = ["session start", "storytree tool call", "file edit", "command"] as const;
export type HookTest = (typeof HOOK_TESTS)[number];

/** A fix the agent can act on: each has a sentence of its own in check_setup's answer. */
export type Fix = "new-session" | "codex-approval" | "codex-elevated" | "edit-check-file" | "run-check-command";

/** The file the agent writes to fire the edit hook, in the session's folder. */
export const CHECK_FILE = ".storytree-check";
/** The command the agent runs to fire the command hook. */
export const CHECK_COMMAND = "echo storytree-check";

const KIND_OF: Readonly<Record<HookTest, Line["kind"]>> = {
  "session start": "session-started",
  "storytree tool call": "tool-requested",
  "file edit": "file-edited",
  command: "command-run",
};

export interface Verification {
  verified: boolean;
  missing: HookTest[];
  fixes: Fix[];
}

/**
 * Which of `session`'s hooks storytree has received, from `lines`, and the fix for each still missing.
 * `codexHooks` is whether Codex's hooks are known to run on this machine (contract 8.16).
 */
export function verifyHooks(lines: readonly Line[], session: string, harness: string | undefined, machine: { readonly elevated?: boolean; readonly codexHooks?: "running" | "waiting" } = {}): Verification {
  const fired = new Set(lines.filter((line) => line.session === session && line.source === "hook").map((line) => line.kind));
  const missing = HOOK_TESTS.filter((test) => !fired.has(KIND_OF[test]));
  const fixes: Fix[] = [];
  // Codex runs none of storytree's hooks until the user trusts them once. Once one has run here, a start or a
  // call that did not arrive is this session's own, as with Claude Code: it set its project up after it started (8.21).
  const codexWaits = harness === "codex" && machine.codexHooks !== "running";
  // Hooks that fire without the agent doing anything: missing, they need a new session or Codex's approval.
  if (missing.includes("session start") || missing.includes("storytree tool call")) fixes.push(codexWaits ? "codex-approval" : "new-session");
  // Until the user trusts them, an edit or a command the agent made now could not reach storytree, and would
  // only leave the check file in the user's folder.
  if (codexWaits && fired.size === 0) return { verified: false, missing, fixes: machine.elevated === true ? [...fixes, "codex-elevated"] : fixes };
  if (missing.includes("file edit")) fixes.push("edit-check-file");
  // Codex in an administrator terminal cannot run any command (its sandbox times out), so the test cannot fire (8.17).
  if (missing.includes("command")) fixes.push(harness === "codex" && machine.elevated === true ? "codex-elevated" : "run-check-command");
  return { verified: missing.length === 0, missing, fixes };
}

/**
 * Where `session`'s agent wrote the check file, as its edit hook reported it (8.20): its own folder,
 * which in a worktree is not the tool server's. A path the harness gave relative is to that folder.
 */
export function checkFilesWritten(lines: readonly Line[], session: string): string[] {
  const written = new Set<string>();
  for (const line of lines) {
    if (line.session !== session || line.source !== "hook" || line.kind !== "file-edited") continue;
    for (const file of line.files) {
      const where = line.folder === undefined ? file : path.resolve(line.folder, file);
      if (path.isAbsolute(where) && path.basename(where) === CHECK_FILE) written.add(where);
    }
  }
  return [...written];
}

/**
 * The one step that lets Codex run storytree's hooks, in words for the user: shown at connect, in the
 * app and by the setup check alike (8.16). Codex asks by itself when it starts; /hooks asks again.
 */
export const CODEX_TRUST_STEP =
  'In Codex, type /hooks and trust storytree\'s hooks (Codex also asks by itself when it starts, as "Hooks need review"), then start a new Codex session.';

/** What each fix says to do. */
export const FIX_SENTENCES: Readonly<Record<Fix, string>> = {
  "new-session":
    "A session's start reaches storytree only when the session starts in a storytree project with storytree's hooks already registered, so a session that set up its project or its hooks cannot show it. Once this session's work is done, start a new session here and call check_setup again. The hook before storytree's own tools fires only when its tool server is registered under the name storytree.",
  "codex-approval":
    `Codex runs storytree's hooks only once the user has trusted them, so until then storytree cannot see this session's work. Tell the user, in these words: ${CODEX_TRUST_STEP}`,
  "codex-elevated":
    "This Codex runs as administrator (it was started from an elevated terminal), and Codex cannot run commands there: its Windows sandbox times out on every one, so storytree never hears them. Tell the user: close this Codex, open a normal terminal (not \"Run as administrator\"), and start Codex from there.",
  "edit-check-file": `To fire the edit hook, write any text to the file ${CHECK_FILE} in this folder with your own file-editing tool, not a shell command, which storytree hears only as a command; check_setup deletes the file once storytree has received the edit.`,
  "run-check-command": `To fire the command hook, run the command \`${CHECK_COMMAND}\`.`,
};
