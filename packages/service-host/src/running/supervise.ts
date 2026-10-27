/**
 * Capability 1 · Running services, contracts 1.2 to 1.4 (ADR-1180 D4). The supervisor keeps each service the host runs
 * going by its rules: an always service that ends is started again after 10 seconds, the wait doubling with each end up
 * to 5 minutes (back to 10 seconds once a run outlasts 10 minutes); five ends within 10 minutes mark it failed, and it is
 * not started again until it is restarted by name. An every service is started on its cadence, never while its last run
 * still goes. Stopping sends each child the stop signal, then kills one still running 30 seconds later. Its clock and
 * how it starts a child are handed in, so its timing is the same on a test's hand-turned clock as on the real one.
 */
import type { ServiceRun } from "@storytree/plugin-loader";

/** Where the supervisor reads the time and sets a timer; `after` returns what cancels it. */
export interface Clock {
  now(): number;
  after(ms: number, fire: () => void): () => void;
}

/** The real clock. */
export const realClock: Clock = {
  now: () => Date.now(),
  after(ms, fire) {
    const timer = setTimeout(fire, ms);
    return () => clearTimeout(timer);
  },
};

/** How a child ended: its exit code, or the signal that ended it. */
export interface Ended {
  readonly code: number | null;
  readonly signal: string | null;
}

/** One running service's child process, as the supervisor sees it. */
export interface Child {
  readonly pid?: number;
  readonly ended: Promise<Ended>;
  signal(name: "SIGTERM" | "SIGKILL"): void;
  /** The last lines it printed. */
  lastLines(): readonly string[];
}

/** A service to run: `<part>/<service>`, and how it runs. */
export interface Service {
  readonly id: string;
  readonly run: ServiceRun;
}

/** How one service stands: running, waiting to start (`nextAt`), or failed, with how its last run ended and its last lines. */
export interface ServiceState {
  readonly id: string;
  readonly run: ServiceRun;
  readonly state: "running" | "waiting" | "failed";
  readonly pid?: number;
  readonly since: number;
  readonly nextAt?: number;
  readonly lastExit?: Ended;
  readonly lastLines: readonly string[];
}

export const FIRST_WAIT_MS = 10_000;
export const LONGEST_WAIT_MS = 5 * 60_000;
export const FAIL_WINDOW_MS = 10 * 60_000;
export const FAIL_ENDS = 5;
export const KILL_AFTER_MS = 30_000;

/** The minutes of an every service's cadence, in milliseconds. */
const cadence = (run: ServiceRun): number => (run === "always" ? 0 : Number.parseInt(run.every, 10) * 60_000);

interface Entry {
  readonly service: Service;
  child: Child | undefined;
  cancel: (() => void) | undefined;
  ends: number[];
  wait: number;
  failed: boolean;
  startedAt: number;
  since: number;
  nextAt: number | undefined;
  lastExit?: Ended;
  lastLines: readonly string[];
  /** Start it again as soon as its child ends: a restart by name of a running service. */
  relaunch?: boolean;
  removed?: boolean;
}

export interface SupervisorOptions {
  readonly clock?: Clock;
  readonly start: (service: Service) => Child;
  readonly log: (line: string) => void;
  /** Called after every change in how a service stands. */
  readonly changed?: () => void;
}

export class Supervisor {
  readonly #clock: Clock;
  readonly #start: (service: Service) => Child;
  readonly #log: (line: string) => void;
  readonly #changed: () => void;
  readonly #entries = new Map<string, Entry>();
  #stopped = false;

  constructor({ clock = realClock, start, log, changed = () => {} }: SupervisorOptions) {
    this.#clock = clock;
    this.#start = start;
    this.#log = log;
    this.#changed = changed;
  }

  /** Run exactly `services`: start each new one, and stop each no longer named. A service already run keeps its state. */
  set(services: readonly Service[]): void {
    if (this.#stopped) return;
    const named = new Set(services.map((service) => service.id));
    for (const [id, entry] of this.#entries) {
      if (named.has(id)) continue;
      this.#entries.delete(id);
      entry.removed = true;
      entry.cancel?.();
      if (entry.child !== undefined) {
        this.#log(`${id}: turned off; stopping it`);
        void this.#halt(entry.child);
      }
    }
    for (const service of services) {
      if (this.#entries.has(service.id)) continue;
      const entry: Entry = { service, child: undefined, cancel: undefined, nextAt: undefined, ends: [], wait: FIRST_WAIT_MS, failed: false, startedAt: 0, since: this.#clock.now(), lastLines: [] };
      this.#entries.set(service.id, entry);
      this.#launch(entry);
    }
    this.#changed();
  }

  /** Start `id` again, its ends and wait cleared: at once when it is not running, or once its stopped child ends. False when no service is called that. */
  restart(id: string): boolean {
    const entry = this.#entries.get(id);
    if (entry === undefined || this.#stopped) return false;
    entry.failed = false;
    entry.ends = [];
    entry.wait = FIRST_WAIT_MS;
    entry.cancel?.();
    entry.cancel = undefined;
    entry.nextAt = undefined;
    this.#log(`${id}: restarted by name`);
    if (entry.child === undefined) this.#launch(entry);
    else {
      entry.relaunch = true;
      void this.#halt(entry.child);
    }
    this.#changed();
    return true;
  }

  /** How each service stands, by name. */
  states(): ServiceState[] {
    return [...this.#entries.values()].sort((a, b) => a.service.id.localeCompare(b.service.id)).map((entry) => ({
      id: entry.service.id,
      run: entry.service.run,
      state: entry.child !== undefined ? "running" : entry.failed ? "failed" : "waiting",
      ...(entry.child?.pid === undefined ? {} : { pid: entry.child.pid }),
      since: entry.since,
      ...(entry.child === undefined && entry.nextAt !== undefined ? { nextAt: entry.nextAt } : {}),
      ...(entry.lastExit === undefined ? {} : { lastExit: entry.lastExit }),
      lastLines: entry.lastLines,
    }));
  }

  /** Stop every service and start none again: each child is sent the stop signal, and killed if it still runs 30 seconds later. */
  async stop(): Promise<void> {
    this.#stopped = true;
    const running: Promise<unknown>[] = [];
    for (const entry of this.#entries.values()) {
      entry.cancel?.();
      entry.cancel = undefined;
      entry.nextAt = undefined;
      if (entry.child !== undefined) running.push(this.#halt(entry.child));
    }
    await Promise.all(running);
    this.#changed();
  }

  /** Send `child` the stop signal, then kill it if it has not ended 30 seconds later; resolves when it has ended. */
  #halt(child: Child): Promise<Ended> {
    child.signal("SIGTERM");
    let ended = false;
    const cancel = this.#clock.after(KILL_AFTER_MS, () => {
      if (!ended) child.signal("SIGKILL");
    });
    return child.ended.then((how) => {
      ended = true;
      cancel();
      return how;
    });
  }

  #launch(entry: Entry): void {
    const { service } = entry;
    entry.cancel = undefined;
    entry.nextAt = undefined;
    if (service.run !== "always") this.#schedule(entry, cadence(service.run));
    if (entry.child !== undefined) {
      this.#log(`${service.id}: its last run still goes, so this turn is skipped`);
      return;
    }
    let child: Child;
    try {
      child = this.#start(service);
    } catch (error) {
      this.#log(`${service.id}: could not be started: ${(error as Error).message}`);
      this.#ended(entry, undefined, { code: null, signal: null });
      return;
    }
    entry.child = child;
    entry.startedAt = this.#clock.now();
    entry.since = entry.startedAt;
    this.#log(`${service.id}: started${child.pid === undefined ? "" : ` (process ${child.pid})`}`);
    void child.ended.then((how) => this.#ended(entry, child, how));
  }

  #schedule(entry: Entry, ms: number): void {
    entry.nextAt = this.#clock.now() + ms;
    entry.cancel = this.#clock.after(ms, () => {
      if (this.#stopped || entry.removed) return;
      this.#launch(entry);
      this.#changed();
    });
  }

  #ended(entry: Entry, child: Child | undefined, how: Ended): void {
    if (child !== undefined && entry.child !== child) return;
    const now = this.#clock.now();
    entry.child = undefined;
    entry.lastExit = how;
    if (child !== undefined) entry.lastLines = child.lastLines();
    entry.since = now;
    const said = how.signal === null ? `exit ${how.code}` : `signal ${how.signal}`;
    if (this.#stopped || entry.removed) {
      this.#log(`${entry.service.id}: stopped (${said})`);
    } else if (entry.relaunch === true) {
      entry.relaunch = false;
      this.#launch(entry);
    } else if (entry.service.run !== "always") {
      this.#log(`${entry.service.id}: ended (${said}); next run at its cadence`);
    } else {
      if (child !== undefined && now - entry.startedAt >= FAIL_WINDOW_MS) entry.wait = FIRST_WAIT_MS;
      entry.ends = [...entry.ends.filter((at) => now - at < FAIL_WINDOW_MS), now];
      if (entry.ends.length >= FAIL_ENDS) {
        entry.failed = true;
        this.#log(`${entry.service.id} failed: it ended ${entry.ends.length} times within 10 minutes (last ${said}); it starts again when its code moves or on \`storytree services restart ${entry.service.id}\``);
      } else {
        const wait = entry.wait;
        entry.wait = Math.min(wait * 2, LONGEST_WAIT_MS);
        this.#log(`${entry.service.id}: ended (${said}); starting it again in ${wait / 1000}s`);
        this.#schedule(entry, wait);
      }
    }
    this.#changed();
  }
}
