/**
 * Capability 1 · Lifecycle. What goes wrong in the main process itself, kept in the app's log so it can be read after the
 * fact (contract 1.22), then put to the person using the app: ask their agent to file a GitHub issue, and keep going or
 * restart (contract 1.23, the owner's answer to question_8a7d4b27a8d6; the message is ADR-1119's). Each is also handed
 * to `record`, which keeps it in the user's own library (contract 1.25, ./main-error-records.ts).
 */
export interface MainProcess {
  on(event: "uncaughtException" | "unhandledRejection", listener: (reason: unknown) => void): unknown;
}

/** What an uncaught error's box says, and the two ways out of it, in that order. */
export interface ErrorMessage {
  readonly title: string;
  readonly message: string;
  readonly detail: string;
  readonly buttons: readonly ["Keep going", "Restart"];
}

export type ErrorChoice = "keep-going" | "restart";

/**
 * Write each uncaught exception and unhandled rejection to `log` with its stack. Handling the exception takes Electron's
 * own dialog away, so `ask` shows ours: it says the error was logged and lets the person keep going (the default) or
 * restart, which `restart` does. One box at a time: an error while it is open is only logged. A rejection is only logged.
 */
export function logMainErrors(
  main: MainProcess,
  { log, ask, restart, record = () => {} }: {
    log: (line: string) => void;
    ask: (message: ErrorMessage) => Promise<ErrorChoice>;
    restart: () => void;
    record?: (kind: "uncaught-exception" | "unhandled-rejection", stack: string) => void;
  },
): void {
  let asking = false;
  main.on("uncaughtException", error => {
    log(`main process uncaught exception: ${described(error)}`);
    record("uncaught-exception", described(error));
    if (asking) return;
    asking = true;
    void ask(errorMessage(error))
      .then(choice => { if (choice === "restart") restart(); }, () => {})
      .finally(() => { asking = false; });
  });
  main.on("unhandledRejection", reason => {
    log(`main process unhandled rejection: ${described(reason)}`);
    record("unhandled-rejection", described(reason));
  });
}

function errorMessage(error: unknown): ErrorMessage {
  const firstLine = described(error).split("\n")[0];
  return {
    title: "storytree 0.3",
    message: "Something went wrong, and it has been written to the app's log.",
    detail: `Please ask your agent to submit a GitHub issue on github.com/storytree-ai/storytree, and we'll work on it. Keep going if storytree still works for you, or restart it to start clean.\n\nWhat went wrong: ${firstLine}`,
    buttons: ["Keep going", "Restart"],
  };
}

function described(reason: unknown): string {
  return reason instanceof Error ? (reason.stack ?? String(reason)) : String(reason);
}
