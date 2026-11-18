// Capability 9 · Errors and app.log
export interface MainProcess {
  on(event: "uncaughtException" | "unhandledRejection", listener: (reason: unknown) => void): unknown;
}

export interface ErrorMessage {
  readonly title: string;
  readonly message: string;
  readonly detail: string;
  readonly buttons: readonly ["Keep going", "Restart"];
}

export type ErrorChoice = "keep-going" | "restart";

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
