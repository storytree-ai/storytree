/** Capability 2 · The shell's harness session, or the person at the computer (ADR-0645 A1/W1). */
import { userInfo } from "node:os";
import type { WriteOptions } from "@storytree/library";

export function person(): string {
  try {
    return userInfo().username;
  } catch {
    return process.env.USER ?? process.env.USERNAME ?? "unknown";
  }
}

export function commandWriter(): WriteOptions {
  const session = process.env.CLAUDE_CODE_SESSION_ID?.trim() || process.env.CODEX_THREAD_ID?.trim();
  return { actor: session ? `session:${session}` : `person:${person()}` };
}
