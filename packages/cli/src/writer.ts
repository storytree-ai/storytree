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

export function commandSession(): { session: string; harness: "claude-code" | "codex" } | undefined {
  const claude = process.env.CLAUDE_CODE_SESSION_ID?.trim();
  if (claude) return { session: claude, harness: "claude-code" };
  const codex = process.env.CODEX_THREAD_ID?.trim();
  return codex ? { session: codex, harness: "codex" } : undefined;
}

export function commandWriter(): WriteOptions {
  const caller = commandSession();
  return { actor: caller ? `session:${caller.session}` : `person:${person()}` };
}
