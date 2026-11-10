/**
 * Capability 1 · Lifecycle, contracts 1.46 and 1.47: an app opened just after the computer starts, before its network
 * is up (Tailscale not yet connected, say), waits for a library it cannot reach yet instead of stopping on "The library
 * could not be opened". At startup it tries again with growing waits for about two minutes, saying it waits and why;
 * past that the error page shows, and the app keeps trying behind it and opens the project once the library answers.
 * A failure that will not fix itself (a refused password, a key command refused for any other reason) stands at once.
 */
import { libraryProblem } from "./open-where-set.js";

/** How long startup waits for a library it cannot reach yet before its error page shows. */
export const STARTUP_WAIT_MS = 120_000;

/** How long to wait before each try at startup: growing, then every 15 s. */
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000];

/** How often the app tries again behind its error page. */
export const RETRY_EVERY_MS = 30_000;

/** What the error page adds when the app keeps trying behind it. */
export const KEEPS_TRYING = "The app keeps trying, and opens your project once the library answers.";

/**
 * Whether `error`, or a failure it explains, says the library could not be reached at all: the library's own refusal
 * (a host it cannot reach, or one that did not answer in time), or a key command that could not reach its host
 * (@storytree/keys's KeyCommandError, known by its name). Both may pass once the network is up.
 */
export function libraryUnreachable(error: unknown): boolean {
  for (let at: unknown = error, depth = 0; at instanceof Error && depth < 8; at = at.cause, depth += 1) {
    const { problem, unreachable } = at as Error & { problem?: unknown; unreachable?: unknown };
    if (at.name === "ConnectionError" && (problem === "unreachable" || problem === "timeout")) return true;
    if (at.name === "KeyCommandError" && unreachable === true) return true;
  }
  return false;
}

/** What the page says while the app waits for the library: that it cannot be reached yet, and why. */
export function waitingFor(error: unknown): string {
  return `The library cannot be reached yet: ${error instanceof Error ? error.message : String(error)}. The app tries again until it answers.`;
}

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

/**
 * Open the library with `open`, trying again with growing waits while it cannot be reached, for `within` ms; each wait
 * is said first through `waiting`. Any other failure, or the last one once the time is up, is thrown.
 */
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

/**
 * Behind the error page, try the library again every `every` ms until it opens, handed to `opened`. A failure that is
 * not the library being unreachable ends the trying and goes to `failed`; a stopping app (`stopped`) ends it quietly.
 */
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

/** What the window's page is opened with while the library is not open: why, and whether the app is still waiting. */
export type LibraryQuery = {
  readonly problem?: string;
  readonly waiting?: string;
};

/**
 * The app's start: open the library with `open`, showing the page `{ waiting }` while it waits (1.46). Once it gives up,
 * the page's problem says why, and that the app keeps trying when the library could not be reached (1.47).
 */
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

/**
 * Behind the error page, keep trying the library (1.47): once it answers, `opened` takes it and the page is shown with
 * no problem, reading the project itself; a failure that will not fix itself is shown as the page's problem instead.
 */
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
