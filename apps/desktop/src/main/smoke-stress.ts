// Capability 1 · Lifecycle
export interface StressSteps<W> {
  open(): W;
  loaded(window: W): Promise<void>;
  close(window: W): Promise<void>;
  log(line: string): void;
}

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

export interface StressedWindow {
  isDestroyed(): boolean;
  once(event: "closed", listener: () => void): unknown;
  close(): void;
}

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
