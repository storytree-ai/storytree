/**
 * Capability 1 · Lifecycle. The smoke check's short stress (contract 1.30, `--stress <rounds>`): the window is closed, opened
 * again as a second start or the tray would, closed again while its page is still loading, then opened and let load, and
 * after the last round closed and opened once more, left loading so the quit lands during its load. These are the moments a
 * destroyed window was touched before (PR #1637); any main-process error they raise turns the smoke check red (./smoke-verdict.ts).
 */
export interface StressSteps<W> {
  /** Open the window again, as the app's own reopening does. */
  open(): W;
  /** Resolve once the window's page has loaded. */
  loaded(window: W): Promise<void>;
  /** Close the window as the person would, resolving once it is gone. */
  close(window: W): Promise<void>;
  log(line: string): void;
}

/** Run `rounds` rounds from `first`, and return the window left loading (`first` itself when no round is asked). */
export async function stressWindow<W>(first: W, rounds: number, { open, loaded, close, log }: StressSteps<W>): Promise<W> {
  if (rounds <= 0) return first;
  let current = first;
  for (let round = 1; round <= rounds; round++) {
    await close(current);
    await close(open());
    current = open();
    await loaded(current);
    log(`smoke: stress round ${round} of ${rounds}: closed, reopened, closed while loading, reopened`);
  }
  await close(current);
  return open();
}

/** What the stress touches of an Electron window. */
export interface StressedWindow {
  isDestroyed(): boolean;
  once(event: "closed", listener: () => void): unknown;
  close(): void;
}

/**
 * The stress's steps on Electron's windows: `reopen` brings the window back as a second start does, and the window it
 * opened is the one still alive; closing resolves once it is gone, at once for one already destroyed, which is never touched.
 */
export function windowSteps<W extends StressedWindow>({ windows, reopen, loaded, log }: {
  windows: () => readonly W[];
  reopen: () => void;
  loaded: (window: W) => Promise<unknown>;
  log: (line: string) => void;
}): StressSteps<W> {
  return {
    open() {
      reopen();
      const opened = windows().find((one) => !one.isDestroyed());
      if (opened === undefined) throw new Error("the window did not open again");
      return opened;
    },
    loaded: async (window) => { if (!window.isDestroyed()) await loaded(window); },
    close: (window) => new Promise<void>((resolve) => {
      if (window.isDestroyed()) return resolve();
      window.once("closed", () => resolve());
      window.close();
    }),
    log,
  };
}
