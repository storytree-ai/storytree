/** Capability 2 · The shell's harness session, or the person at the computer (ADR-0645 A1/W1). */
import { userInfo } from "node:os";
import type { WriteOptions } from "@storytree/library";
import { SESSION_ENV, WATCHED_HARNESSES, type WatchedHarness } from "@storytree/project-and-caller/caller";

export function person(): string {
  try {
    return userInfo().username;
  } catch {
    return process.env.USER ?? process.env.USERNAME ?? "unknown";
  }
}

/**
 * The session a watched harness names in the shell, or else the one STORYTREE_SESSION_ID names: a connected
 * session's, whose check_setup gives the id (contract 2.7). Its harness is unknown to the shell.
 */
export function commandSession(): { session: string; harness?: string } | undefined {
  for (const harness of WATCHED_HARNESSES as readonly WatchedHarness[]) {
    // Antigravity CLI names its session in no shell: its commands are the person's, or STORYTREE_SESSION_ID's.
    const session = harness.shellSession === undefined ? undefined : process.env[harness.shellSession]?.trim();
    if (session) return { session, harness: harness.id };
  }
  const named = process.env[SESSION_ENV]?.trim();
  return named ? { session: named } : undefined;
}

/** The shell's session for a verb that opens no library: none when two watched harnesses each name one, so neither is picked. */
export function soleSession(): { session: string; harness?: string } | undefined {
  const naming = (WATCHED_HARNESSES as readonly WatchedHarness[]).filter((harness) => harness.shellSession !== undefined && process.env[harness.shellSession]?.trim());
  return naming.length > 1 ? undefined : commandSession();
}

export function commandWriter(): WriteOptions {
  const caller = commandSession();
  return { actor: caller ? `session:${caller.session}` : `person:${person()}` };
}
