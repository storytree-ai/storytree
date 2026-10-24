/**
 * Capability 5 · Drafted writes with read-back and undo (contract 5.9) and capability 4 · The box service (contract 4.8):
 * the box's listener. Run as the owner's account by a user service (box/voice-listen.service), it LISTENs on the door's
 * database, which notifies voice_run when a manager run is confirmed (box/door-database.sql), and runs one committer tick
 * per wake-up, so a confirmed run starts within seconds (ADR-1155 D3). A run's end mark appearing in the runs folder wakes
 * it too, so the reply is recorded at once. It ticks once on every (re)connection, catching up on what it missed while
 * down, and reconnects after losing its connection; voice-commit.timer stays as a slow fallback.
 */
import { mkdirSync, watch, type FSWatcher } from "node:fs";
import pg from "pg";

export const CHANNEL = "voice_run";

export interface ListenerOptions {
  /** The door's database, as an account that may connect to it. */
  readonly connectionString: string;
  /** One committer tick; never two at once. */
  readonly tick: () => Promise<void>;
  /** The runs folder: a run's end mark (voice-run-N.ended) appearing there wakes a tick. */
  readonly runsDir: string;
  readonly log: (line: string) => void;
  /** How long to wait before reconnecting after the connection is lost. */
  readonly retryMs?: number | undefined;
}

export interface Listener {
  /** Settles once the first LISTEN has been taken. */
  readonly ready: Promise<void>;
  close(): Promise<void>;
}

const message = (error: unknown) => (error as Error | undefined)?.message ?? String(error);

export function listen(options: ListenerOptions): Listener {
  const { connectionString, tick, runsDir, log, retryMs = 5_000 } = options;
  let closed = false;
  let client: pg.Client | null = null;
  let retry: NodeJS.Timeout | undefined;
  let running: Promise<void> | null = null;
  let again = false;
  let listened: () => void = () => {};
  const ready = new Promise<void>((done) => (listened = done));

  // A wake-up while a tick runs asks for one more after it, never a second at once.
  const wake = () => {
    if (closed) return;
    if (running) {
      again = true;
      return;
    }
    running = (async () => {
      do {
        again = false;
        try {
          await tick();
        } catch (error) {
          log(`tick failed: ${message(error)}`);
        }
      } while (again && !closed);
      running = null;
    })();
  };

  const connect = async () => {
    if (closed) return;
    const next = new pg.Client({ connectionString });
    let gone = false;
    const lost = (why: string) => {
      if (gone) return;
      gone = true;
      if (client === next) client = null;
      next.end().catch(() => {});
      if (closed) return;
      log(`connection lost (${why}); reconnecting in ${retryMs} ms`);
      retry = setTimeout(() => {
        retry = undefined;
        void connect();
      }, retryMs);
    };
    next.on("notification", () => wake());
    next.on("error", (error) => lost(message(error)));
    next.on("end", () => lost("it ended"));
    try {
      await next.connect();
      await next.query(`LISTEN ${CHANNEL}`);
    } catch (error) {
      lost(message(error));
      return;
    }
    if (closed || gone) return void next.end().catch(() => {});
    client = next;
    log(`listening on ${CHANNEL}`);
    listened();
    wake();
  };

  mkdirSync(runsDir, { recursive: true });
  const watcher: FSWatcher = watch(runsDir, (_event, name) => {
    if (name?.toString().endsWith(".ended")) wake();
  });
  void connect();

  return {
    ready,
    async close() {
      closed = true;
      if (retry) clearTimeout(retry);
      watcher.close();
      const open = client;
      client = null;
      await open?.end().catch(() => {});
      await running;
    },
  };
}
