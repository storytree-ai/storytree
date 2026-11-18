// Capability 1 · Lifecycle
import { RestartsStopped, type RestartLimit } from "../updates/restart-limit.js";

export interface TrayItem {
  readonly id: "show" | "quit";
  readonly label: string;
  readonly stops: boolean;
}

export const TRAY_MENU: readonly TrayItem[] = [
  { id: "show", label: "Open storytree 0.3", stops: false },
  { id: "quit", label: "Quit storytree 0.3", stops: true },
];

export interface Launch {
  readonly execPath: string;
  readonly args: readonly string[];
}

export function thisBuild({ execPath, argv, appImage }: { execPath: string; argv: readonly string[]; appImage?: string }): Launch {
  return { execPath: appImage ?? execPath, args: argv.slice(1).filter((arg) => arg !== "--background") };
}

export interface Background {
  windowClosed(): "keep-running";
  quit(code?: number): Promise<void>;
  restart(target: Launch, showing: boolean): Promise<void>;
  secondStart(request?: { quit?: boolean }): "show" | "reopen" | "quit";
}

export interface BackgroundOptions {
  stopPages?: () => void;
  stopDatabase: () => Promise<void>;
  exit: (code: number) => void;
  relaunch?: (target: Launch | undefined, inBackground: boolean) => void;
  limit?: Pick<RestartLimit, "mayRestart">;
  stopWithin?: number;
  error?: (line: string) => void;
}

const STOP_WITHIN_MS = 150_000;

export function background({ stopPages, stopDatabase, exit, relaunch, limit, stopWithin = STOP_WITHIN_MS, error }: BackgroundOptions): Background {
  let quitting: Promise<void> | undefined;
  let next: { target: Launch | undefined; shown: boolean } | undefined;
  const stop = (code: number): Promise<void> => {
    quitting ??= (async () => {
      let bound: ReturnType<typeof setTimeout> | undefined;
      const outlasted = new Promise<void>((resolve) => {
        bound = setTimeout(() => {
          error?.(`stopping the app took longer than ${stopWithin / 1000} s, so it exits without waiting`);
          resolve();
        }, stopWithin);
      });
      const stopped = (async () => {
        stopPages?.();
        await stopDatabase();
      })().catch(() => {});
      await Promise.race([stopped, outlasted]);
      clearTimeout(bound);
      try {
        if (next !== undefined) relaunch?.(next.target, !next.shown);
      } finally {
        exit(code);
      }
    })();
    return quitting;
  };
  return {
    windowClosed: () => "keep-running",
    quit: (code = 0) => stop(code),
    restart(target, showing) {
      if (quitting === undefined) {
        if (limit?.mayRestart() === false) return Promise.reject(new RestartsStopped());
        next = { target, shown: showing };
      }
      return stop(0);
    },
    secondStart(request) {
      if (request?.quit === true) {
        void stop(0);
        return "quit";
      }
      if (quitting === undefined) return "show";
      next = { target: next?.target, shown: true };
      return "reopen";
    },
  };
}
