/**
 * Capability 3 · Hooks. What a hook that failed leaves on this machine (contract 3.23). A hook never breaks the agent, so a
 * failure writes nothing to the log and says nothing; without a trace, a gap in a session's lines
 * cannot be read afterwards (2026-10-06: no `tool-requested` line for any storytree call on the
 * laptop for seven minutes, and no way to tell why). So a hook that throws, cannot reach storytree,
 * or loses lines it made appends one line here, under the storytree home: when, which harness,
 * event, session and tool call, and the error's class and message. The file is capped: past
 * MAX_BYTES it becomes `.old` (the one before it goes), so it never holds more than twice that. A
 * healthy hook writes nothing here. Writing the trace never throws.
 */
import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import path from "node:path";

/** One failed hook run, as this machine recorded it. */
export interface HookFailure {
  readonly at: string;
  readonly harness: string;
  readonly event?: string;
  readonly session?: string;
  readonly toolUseId?: string;
  /** Where in the hook it failed: reaching storytree, writing to its log, observing shell writes (3.22), or anywhere else. */
  readonly stage: "reach" | "write" | "observe" | "hook";
  readonly error: { readonly class: string; readonly message: string };
}

/** The file failed hooks are traced to, under the storytree home `home`. */
export function hookFailuresFile(home: string): string {
  return path.join(home, "hook-failures.jsonl");
}

/** The most the trace file grows to before it is set aside. */
const MAX_BYTES = 64 * 1024;
/** The most of an error's message kept. */
const MAX_MESSAGE = 300;

/** Who a hook's input says it ran for: its harness, event, session and tool call, as far as the input says. */
export function hookIdentity(harness: string, input: unknown): Pick<HookFailure, "harness" | "event" | "session" | "toolUseId"> {
  const fields = typeof input === "object" && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);
  const event = text(fields.hook_event_name);
  const session = text(fields.session_id);
  const toolUseId = text(fields.tool_use_id) ?? text(fields.call_id);
  return { harness, ...(event === undefined ? {} : { event }), ...(session === undefined ? {} : { session }), ...(toolUseId === undefined ? {} : { toolUseId }) };
}

/** Record, under the storytree home `homeOf` gives, that a hook run for `who` failed at `stage` with `error`. Never throws. */
export function noteHookFailure(homeOf: () => string, who: Pick<HookFailure, "harness" | "event" | "session" | "toolUseId">, stage: HookFailure["stage"], error: unknown): void {
  try {
    const home = homeOf();
    const file = hookFailuresFile(home);
    mkdirSync(home, { recursive: true });
    try {
      if (statSync(file).size >= MAX_BYTES) renameSync(file, `${file}.old`);
    } catch {
      // No trace yet.
    }
    const failure: HookFailure = { at: new Date().toISOString(), ...who, stage, error: describe(error) };
    appendFileSync(file, `${JSON.stringify(failure)}\n`);
  } catch {
    // A trace that cannot be written is not worth breaking the agent for.
  }
}

/** The failed hook runs this machine recorded for `session`, oldest first: the set-aside file's, then the current one's. */
export function hookFailures(home: string, session: string): HookFailure[] {
  const file = hookFailuresFile(home);
  return [`${file}.old`, file].flatMap((name) => {
    let text: string;
    try {
      text = readFileSync(name, "utf8");
    } catch {
      return [];
    }
    return text.split("\n").flatMap((line): HookFailure[] => {
      try {
        const failure = JSON.parse(line) as HookFailure;
        return failure.session === session ? [failure] : [];
      } catch {
        return [];
      }
    });
  });
}

function describe(error: unknown): HookFailure["error"] {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    return { class: typeof code === "string" ? `${error.name} ${code}` : error.name, message: error.message.slice(0, MAX_MESSAGE) };
  }
  return { class: typeof error, message: String(error).slice(0, MAX_MESSAGE) };
}
