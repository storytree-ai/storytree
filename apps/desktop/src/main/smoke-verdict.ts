// Capability 1 · Lifecycle
import type { ErrorChoice, ErrorMessage } from "./main-errors.js";

export interface SmokeVerdict {
  error(line: string): void;
  stopping(what: string, step: () => void | Promise<void>): Promise<void>;
  asking(ask: (message: ErrorMessage) => Promise<ErrorChoice>): (message: ErrorMessage) => Promise<ErrorChoice>;
  exitCode(chosen: number): number;
}

export function smokeVerdict({ smoke, log }: { smoke: boolean; log: (line: string) => void }): SmokeVerdict {
  let errors = 0;
  const error = (line: string): void => {
    log(line);
    if (smoke) errors++;
  };
  return {
    error,
    async stopping(what, step) {
      try {
        await step();
      } catch (thrown) {
        error(`main process error stopping ${what}: ${thrown instanceof Error ? (thrown.stack ?? thrown.message) : String(thrown)}`);
      }
    },
    asking: (ask) => (smoke ? async () => "keep-going" : ask),
    exitCode(chosen) {
      if (errors === 0) return chosen;
      log(`smoke: ${errors} main-process error(s) logged, so the check fails`);
      return 1;
    },
  };
}
