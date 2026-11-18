// Capability 3 · The caller

export interface WatchedHarness {
  readonly id: string;
  readonly label: string;
  readonly client: string;
  readonly shellSession?: string;
  readonly transcript?: "claude-code" | "codex" | "pi";
  readonly callIds?: false;
  readonly startEvent?: false;
}

export const WATCHED_HARNESSES = [
  { id: "claude-code", label: "Claude Code", client: "claude-code", shellSession: "CLAUDE_CODE_SESSION_ID", transcript: "claude-code" },
  { id: "codex", label: "Codex", client: "codex-mcp-client", shellSession: "CODEX_THREAD_ID", transcript: "codex" },
  { id: "cursor", label: "Cursor", client: "Cursor", shellSession: "CURSOR_CONVERSATION_ID", callIds: false },
  { id: "pi", label: "Pi", client: "pi", shellSession: "PI_SESSION_ID", transcript: "pi", callIds: false },
  { id: "antigravity", label: "Antigravity CLI", client: "antigravity-client", callIds: false, startEvent: false },
] as const satisfies readonly WatchedHarness[];

export type Harness = (typeof WATCHED_HARNESSES)[number]["id"];

export const HARNESS_IDS: readonly Harness[] = WATCHED_HARNESSES.map((harness) => harness.id);

export const SESSION_ENV = "STORYTREE_SESSION_ID";

export const NAME_A_SESSION = `run it from the agent's shell, or set ${SESSION_ENV} to the session id check_setup names`;

export type Tier = "watched" | "connected";

export function watchedHarness(harness: string | undefined): WatchedHarness | undefined {
  return WATCHED_HARNESSES.find((one) => one.id === harness);
}

export function harnessOfClient(client: string | undefined): string | undefined {
  return WATCHED_HARNESSES.find((one) => one.client === client)?.id ?? client;
}

export function tierOf(harness: string | undefined): Tier {
  return watchedHarness(harness) === undefined ? "connected" : "watched";
}
