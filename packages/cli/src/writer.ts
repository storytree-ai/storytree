/** Capability 2 · The shell's harness session, or the person at the computer (ADR-0645 A1/W1). */
import { userInfo } from "node:os";
import type { WriteOptions } from "@storytree/library";
import { SESSION_ENV, WATCHED_HARNESSES, type WatchedHarness } from "@storytree/session-management/readings";

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

/** How a shell names its session to storytree, for a refusal that needs one. */
export const NAME_A_SESSION = `run it from the agent's shell, or set ${SESSION_ENV} to the session id check_setup names`;

export function commandWriter(): WriteOptions {
  const caller = commandSession();
  return { actor: caller ? `session:${caller.session}` : `person:${person()}` };
}
