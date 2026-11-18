// Capability 8 · Setup check.
import { tmpdir } from "node:os";
import path from "node:path";

import { watchedHarness } from "@storytree/project-and-caller/caller";
import type { Line } from "@storytree/library";

import { CODEX_TRUST_STEP } from "../connect/codex.js";

export const HOOK_TESTS = ["session start", "storytree tool call", "file edit", "command"] as const;
export type HookTest = (typeof HOOK_TESTS)[number];

export type Fix = "new-session" | "codex-approval" | "codex-elevated" | "edit-check-file" | "run-check-command";

const CHECK_FILE = "storytree-check-";
export function checkFile(session: string): string {
  return path.join(tmpdir(), `${CHECK_FILE}${session.replace(/[^A-Za-z0-9_-]/g, "-")}`);
}
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

export function verifyHooks(lines: readonly Line[], session: string, harness: string | undefined, machine: { readonly elevated?: boolean; readonly codexHooks?: "running" | "waiting" } = {}): Verification {
  const fired = new Set(lines.filter((line) => line.session === session && line.source === "hook").map((line) => line.kind));
  if (fired.size > 0 && watchedHarness(harness)?.startEvent === false) fired.add("session-started");
  const missing = HOOK_TESTS.filter((test) => !fired.has(KIND_OF[test]));
  const fixes: Fix[] = [];
  const codexWaits = harness === "codex" && machine.codexHooks !== "running";
  if (missing.includes("session start") || missing.includes("storytree tool call")) fixes.push(codexWaits ? "codex-approval" : "new-session");
  if (codexWaits && fired.size === 0) return { verified: false, missing, fixes: machine.elevated === true ? [...fixes, "codex-elevated"] : fixes };
  if (missing.includes("file edit")) fixes.push("edit-check-file");
  if (missing.includes("command")) fixes.push(harness === "codex" && machine.elevated === true ? "codex-elevated" : "run-check-command");
  return { verified: missing.length === 0, missing, fixes };
}

export function checkFilesWritten(lines: readonly Line[], session: string): string[] {
  const written = new Set<string>();
  for (const line of lines) {
    if (line.session !== session || line.source !== "hook" || line.kind !== "file-edited") continue;
    for (const file of line.files) {
      const where = line.folder === undefined ? file : path.resolve(line.folder, file);
      if (path.isAbsolute(where) && path.basename(where) === path.basename(checkFile(session))) written.add(where);
    }
  }
  return [...written];
}

export function fixSentence(fix: Fix, session: string): string {
  return fix === "edit-check-file"
    ? `To fire the edit hook, write any text to the file ${checkFile(session)} with your own file-editing tool, not a shell command, which storytree hears only as a command. It is in the system's temporary folder, outside this project, so your harness may ask the user to allow the write; check_setup deletes the file once storytree has received the edit.`
    : FIX_SENTENCES[fix];
}

export const FIX_SENTENCES: Readonly<Record<Exclude<Fix, "edit-check-file">, string>> = {
  "new-session":
    "A session's start reaches storytree only when the session starts in a storytree project with storytree's hooks already registered, so a session that set up its project or its hooks cannot show it. Once this session's work is done, start a new session here and call check_setup again. The hook before storytree's own tools fires only when its tool server is registered under the name storytree.",
  "codex-approval":
    `Codex runs storytree's hooks only once the user has trusted them, so until then storytree cannot see this session's work. Tell the user, in these words: ${CODEX_TRUST_STEP}`,
  "codex-elevated":
    "This Codex runs as administrator (it was started from an elevated terminal), and Codex cannot run commands there: its Windows sandbox times out on every one, so storytree never hears them. Tell the user: close this Codex, open a normal terminal (not \"Run as administrator\"), and start Codex from there.",
  "run-check-command": `To fire the command hook, run the command \`${CHECK_COMMAND}\`.`,
};
