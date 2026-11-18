// Capability 3 · Hooks
import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import path from "node:path";

export interface HookFailure {
  readonly at: string;
  readonly harness: string;
  readonly event?: string;
  readonly session?: string;
  readonly toolUseId?: string;
  readonly stage: "reach" | "write" | "observe" | "hook";
  readonly error: { readonly class: string; readonly message: string };
}

export function hookFailuresFile(home: string): string {
  return path.join(home, "hook-failures.jsonl");
}

const MAX_BYTES = 64 * 1024;
const MAX_MESSAGE = 300;

export function hookIdentity(harness: string, input: unknown): Pick<HookFailure, "harness" | "event" | "session" | "toolUseId"> {
  const fields = typeof input === "object" && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);
  const event = text(fields.hook_event_name);
  const session = text(fields.session_id);
  const toolUseId = text(fields.tool_use_id) ?? text(fields.call_id);
  return { harness, ...(event === undefined ? {} : { event }), ...(session === undefined ? {} : { session }), ...(toolUseId === undefined ? {} : { toolUseId }) };
}

export function noteHookFailure(homeOf: () => string, who: Pick<HookFailure, "harness" | "event" | "session" | "toolUseId">, stage: HookFailure["stage"], error: unknown): void {
  try {
    const home = homeOf();
    const file = hookFailuresFile(home);
    mkdirSync(home, { recursive: true });
    try {
      if (statSync(file).size >= MAX_BYTES) renameSync(file, `${file}.old`);
    } catch {
    }
    const failure: HookFailure = { at: new Date().toISOString(), ...who, stage, error: describe(error) };
    appendFileSync(file, `${JSON.stringify(failure)}\n`);
  } catch {
  }
}

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
