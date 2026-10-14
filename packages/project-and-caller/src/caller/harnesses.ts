/**
 * Capability 3 · The caller. The one place a harness storytree watches is described (decision_057bc7ad0a8c D1):
 * its id, the name people call it, the name its MCP client gives itself, where it names the session in
 * its shells, and which transcript reader reads it. A harness with hooks storytree knows is watched; any
 * other MCP client is connected: storytree serves its tools and commands, and sees nothing else of it.
 * Browser-safe: nothing here reads a file or the environment.
 */

/** A harness storytree registers hooks in and reads the transcripts of. */
export interface WatchedHarness {
  readonly id: string;
  /** As people call it. */
  readonly label: string;
  /** The name its MCP client gives itself. */
  readonly client: string;
  /** The environment variable naming the session in the shells it runs; none where its shells are given no session (Antigravity CLI). */
  readonly shellSession?: string;
  /** Which reader reads its transcript; none where its transcript carries no token usage, so it has no context reading. */
  readonly transcript?: "claude-code" | "codex" | "pi";
  /** False where its MCP client sends a tool call with no id of the call, so its hook's line is found by tool and time (6.66). */
  readonly callIds?: false;
  /** False where its hooks have no session-start event, so a session's row opens on its first line (8.30). */
  readonly startEvent?: false;
}

export const WATCHED_HARNESSES = [
  { id: "claude-code", label: "Claude Code", client: "claude-code", shellSession: "CLAUDE_CODE_SESSION_ID", transcript: "claude-code" },
  { id: "codex", label: "Codex", client: "codex-mcp-client", shellSession: "CODEX_THREAD_ID", transcript: "codex" },
  // From Cursor's installed code (command line 2026.07.09), not a live session; its transcripts (106 read, 2026-10-12) hold no usage.
  { id: "cursor", label: "Cursor", client: "Cursor", shellSession: "CURSOR_CONVERSATION_ID", callIds: false },
  // Measured in Pi 1.1.0 (2026-10-12): its MCP client's clientInfo.name, and the variable its bash tool's shells get.
  { id: "pi", label: "Pi", client: "pi", shellSession: "PI_SESSION_ID", transcript: "pi", callIds: false },
  // Measured in Antigravity CLI 1.3.3 (2026-10-12, no sign-in): its MCP client's clientInfo.name, and no session variable
  // in its tool server's environment; its shells' is not documented. Its transcript holds no token usage (documentation).
  { id: "antigravity", label: "Antigravity CLI", client: "antigravity-client", callIds: false, startEvent: false },
] as const satisfies readonly WatchedHarness[];

/** A watched harness's id. */
export type Harness = (typeof WATCHED_HARNESSES)[number]["id"];

/** The ids of the watched harnesses, in the order they are described. */
export const HARNESS_IDS: readonly Harness[] = WATCHED_HARNESSES.map((harness) => harness.id);

/**
 * The variable any harness or user sets to name a connected session to storytree: the tool server reads it
 * from its environment and the command line from the shell's, so a tool call and a command are one session.
 */
export const SESSION_ENV = "STORYTREE_SESSION_ID";

/** Watched: storytree's hooks report the session. Connected: it reaches storytree only through tools and commands. */
export type Tier = "watched" | "connected";

/** The watched harness `harness` names, or undefined for any other. */
export function watchedHarness(harness: string | undefined): WatchedHarness | undefined {
  return WATCHED_HARNESSES.find((one) => one.id === harness);
}

/** The harness an MCP client is: a watched one's id by its client name, any other by its own name. */
export function harnessOfClient(client: string | undefined): string | undefined {
  return WATCHED_HARNESSES.find((one) => one.client === client)?.id ?? client;
}

/** The tier a session in `harness` is in: watched only in a harness storytree has hooks for. */
export function tierOf(harness: string | undefined): Tier {
  return watchedHarness(harness) === undefined ? "connected" : "watched";
}
