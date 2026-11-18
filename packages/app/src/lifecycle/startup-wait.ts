// Capability 1 · Lifecycle
import { libraryProblem } from "./open-where-set.js";

export const STARTUP_WAIT_MS = 120_000;

const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000];

export const RETRY_EVERY_MS = 30_000;

export const KEEPS_TRYING = "The app keeps trying, and opens your project once the library answers.";

export function libraryUnreachable(error: unknown): boolean {
  for (let at: unknown = error, depth = 0; at instanceof Error && depth < 8; at = at.cause, depth += 1) {
    const { problem, unreachable } = at as Error & { problem?: unknown; unreachable?: unknown };
    if (at.name === "ConnectionError" && (problem === "unreachable" || problem === "timeout")) return true;
    if (at.name === "KeyCommandError" && unreachable === true) return true;
  }
  return false;
}

export function waitingFor(error: unknown): string {
  return `The library cannot be reached yet: ${error instanceof Error ? error.message : String(error)}. The app tries again until it answers.`;
}

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export async function openPatiently<T>(options: Clock & {
  open(): Promise<T>;
  waiting(reason: string): void;
  within?: number;
}): Promise<T> {
  const deadline = options.now() + (options.within ?? STARTUP_WAIT_MS);
  for (let tries = 0; ; tries += 1) {
    try {
      return await options.open();
    } catch (error) {
      const delay = BACKOFF_MS[Math.min(tries, BACKOFF_MS.length - 1)]!;
      if (!libraryUnreachable(error) || options.now() + delay > deadline) throw error;
      options.waiting(waitingFor(error));
      await options.sleep(delay);
    }
  }
}

export async function keepTrying<T>(options: Clock & {
  open(): Promise<T>;
  opened(library: T): void;
  failed(error: unknown): void;
  stopped(): boolean;
  every?: number;
}): Promise<void> {
  for (;;) {
    await options.sleep(options.every ?? RETRY_EVERY_MS);
    if (options.stopped()) return;
    let library: T;
    try {
      library = await options.open();
    } catch (error) {
      if (options.stopped()) return;
      if (libraryUnreachable(error)) continue;
      options.failed(error);
      return;
    }
    options.opened(library);
    return;
  }
}

export type LibraryQuery = {
  readonly problem?: string;
  readonly waiting?: string;
};

export async function openAtStartup<T>(options: Clock & {
  open(): Promise<T>;
  show(query: LibraryQuery): void;
  log(line: string): void;
}): Promise<{ readonly opened: T } | { readonly problem: string; readonly unreachable: boolean }> {
  try {
    return {
      opened: await openPatiently({
        ...options,
        waiting: (reason) => {
          options.log(reason);
          options.show({ waiting: reason });
        },
      }),
    };
  } catch (error) {
    const unreachable = libraryUnreachable(error);
    const problem = unreachable ? `${libraryProblem(error)} ${KEEPS_TRYING}` : libraryProblem(error);
    options.log(problem);
    return { problem, unreachable };
  }
}

export function keepTryingBehind<T>(options: Clock & {
  open(): Promise<T>;
  opened(library: T): void;
  show(query: LibraryQuery): void;
  log(line: string): void;
  stopped(): boolean;
  every?: number;
}): Promise<void> {
  return keepTrying({
    ...options,
    opened: (library) => {
      options.log("library: answered after all");
      options.opened(library);
      options.show({});
    },
    failed: (error) => {
      const problem = libraryProblem(error);
      options.log(problem);
      options.show({ problem });
    },
  });
}
