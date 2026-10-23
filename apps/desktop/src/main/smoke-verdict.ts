/**
 * Capability 1 · Lifecycle. The smoke check's verdict counts the main process's own errors (contract 1.30): in a `--smoke`
 * run, any main-process error the app logs, one raised while it stops after the quit began included, turns its exit red,
 * whatever the page check chose; and it never shows an error box, which on a runner with no one to answer it would hold
 * the run until its timeout. Outside a smoke check errors are only logged, and the chosen code stands.
 */
import type { ErrorChoice, ErrorMessage } from "./main-errors.js";

export interface SmokeVerdict {
  /** Log a main-process error line; in a smoke check it also counts against the exit. */
  error(line: string): void;
  /** Run one step of stopping the app; a throw is logged as an error (and counted), and the step resolves. */
  stopping(what: string, step: () => void | Promise<void>): Promise<void>;
  /** The error box to show, or, in a smoke check, none: the person-less run keeps going. */
  asking(ask: (message: ErrorMessage) => Promise<ErrorChoice>): (message: ErrorMessage) => Promise<ErrorChoice>;
  /** The code to exit with: `chosen`, or 1 when a smoke check counted any error. */
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
