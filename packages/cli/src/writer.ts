// Capability 2 · Who wrote it
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

export function commandSession(): { session: string; harness?: string } | undefined {
  for (const harness of WATCHED_HARNESSES as readonly WatchedHarness[]) {
    const session = harness.shellSession === undefined ? undefined : process.env[harness.shellSession]?.trim();
    if (session) return { session, harness: harness.id };
  }
  const named = process.env[SESSION_ENV]?.trim();
  return named ? { session: named } : undefined;
}

export function soleSession(): { session: string; harness?: string } | undefined {
  const naming = (WATCHED_HARNESSES as readonly WatchedHarness[]).filter((harness) => harness.shellSession !== undefined && process.env[harness.shellSession]?.trim());
  return naming.length > 1 ? undefined : commandSession();
}

export function commandWriter(): WriteOptions {
  const caller = commandSession();
  return { actor: caller ? `session:${caller.session}` : `person:${person()}` };
}
