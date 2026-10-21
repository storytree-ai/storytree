/** Capability 1 · Lifecycle. What goes wrong in the main process itself, kept in the app's log so it can be read after the fact (contract 1.22). */
export interface MainProcess {
  on(event: "uncaughtException" | "unhandledRejection", listener: (reason: unknown) => void): unknown;
}

/**
 * Write each uncaught exception and unhandled rejection to `log` with its stack. Handling the exception takes Electron's
 * own dialog away, so `showError` shows one in its place, worded as Electron's was; whether the app keeps running is unchanged.
 */
export function logMainErrors(main: MainProcess, { log, showError }: { log: (line: string) => void; showError: (title: string, content: string) => void }): void {
  main.on("uncaughtException", error => {
    log(`main process uncaught exception: ${described(error)}`);
    showError("A JavaScript error occurred in the main process", `Uncaught Exception:\n${described(error)}`);
  });
  main.on("unhandledRejection", reason => log(`main process unhandled rejection: ${described(reason)}`));
}

function described(reason: unknown): string {
  return reason instanceof Error ? (reason.stack ?? String(reason)) : String(reason);
}
