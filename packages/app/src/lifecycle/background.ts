/**
 * Capability 1 · Lifecycle: the app keeps running in the background (contract 1.7, ADR-0636 D3).
 * Closing the window does not stop storytree or its database, so agents' activity is still
 * recorded while the window is closed. The tray icon's Quit is the one way to stop it: the database
 * is stopped once, and the app exits only after it has stopped. apps/desktop wires this to
 * Electron's events.
 */
export interface TrayItem {
  /** What the item does: `show` brings the window back, `quit` stops the app. */
  readonly id: "show" | "quit";
  readonly label: string;
  /** Whether choosing it stops the app and its database. */
  readonly stops: boolean;
}

/** The tray icon's menu. */
export const TRAY_MENU: readonly TrayItem[] = [
  { id: "show", label: "Open storytree 0.3", stops: false },
  { id: "quit", label: "Quit storytree 0.3", stops: true },
];

/** A build of the app to start: its program and arguments. */
export interface Launch {
  readonly execPath: string;
  readonly args: readonly string[];
}

export interface Background {
  /** The last window was closed: the app keeps running, and nothing is stopped. */
  windowClosed(): "keep-running";
  /** Stop the database, then exit. Asking again waits for the same stop. */
  quit(code?: number): Promise<void>;
  /**
   * Stop the database, then start `target` (a newer build) and exit. The new build shows its window
   * if this one's was `showing`, or if the app was started again meanwhile.
   */
  restart(target: Launch, showing: boolean): Promise<void>;
  /**
   * The app was started again. While it runs, its window is to be shown ("show"). While it is
   * stopping, the start is held, not lost ("reopen"): once the database has stopped, the app is
   * started again with its window. A start asking it to `quit` quits it, as the tray's Quit does
   * (ADR-0656 D1), and is never held for a reopen.
   */
  secondStart(request?: { quit?: boolean }): "show" | "reopen" | "quit";
}

export interface BackgroundOptions {
  /** Stops the database (and closes what reads it). */
  stopDatabase: () => Promise<void>;
  /** Ends the app. */
  exit: (code: number) => void;
  /**
   * Starts the app again once this one exits: `target`, or this same build when undefined, in the
   * background (tray only) or with its window.
   */
  relaunch?: (target: Launch | undefined, inBackground: boolean) => void;
}

export function background({ stopDatabase, exit, relaunch }: BackgroundOptions): Background {
  let quitting: Promise<void> | undefined;
  /** What to start once stopped: a restart's target, or this build again ("self"). */
  let next: { target: Launch | undefined; shown: boolean } | undefined;
  const stop = (code: number): Promise<void> => {
    quitting ??= stopDatabase()
      .catch(() => {})
      .then(() => {
        if (next !== undefined) relaunch?.(next.target, !next.shown);
        exit(code);
      });
    return quitting;
  };
  return {
    windowClosed: () => "keep-running",
    quit: (code = 0) => stop(code),
    restart(target, showing) {
      if (quitting === undefined) next = { target, shown: showing };
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
