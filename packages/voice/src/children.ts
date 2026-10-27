/**
 * Capability 1 · The address and its guards: every child the door starts is bounded in number (contract 1.7), time
 * (1.8) and output, stopped when its caller hangs up (1.9), and given an argument array with no shell (1.12).
 */
import { spawn } from "node:child_process";
import { childEnvFor, type VoiceConfig } from "./config.js";

export interface Limits {
  readonly bodyBytes: number;
  /** Text a command-line tool returns. */
  readonly outputChars: number;
  /** Standard output read from any child before it is stopped. */
  readonly childBytes: number;
  readonly cliMs: number;
  /** A library search computes an embedding (4-7 s measured on the box). */
  readonly searchMs: number;
  readonly gitMs: number;
  /** Longest wait for a free child slot before the call is refused as busy: one full command and its kill grace (ADR-1163 D3). */
  readonly queueMs: number;
  /** SIGTERM, then SIGKILL this long after, then stop waiting for the child's pipes this long after that. */
  readonly killGraceMs: number;
  readonly cliRunning: number;
  readonly cliWaiting: number;
  readonly gitRunning: number;
  readonly gitWaiting: number;
  /** Idle keep-alive: longer than Tailscale Funnel's 90 s pool, so the proxy always closes first. */
  readonly keepAliveMs: number;
}

/**
 * The limits with `overrides` over the defaults. Unless set itself, the wait for a free slot is the command limit plus
 * the kill grace, so a call queued behind a command that runs its full time is served, not refused as busy.
 */
export function limitsWith(overrides: Partial<Limits> = {}): Limits {
  const limits = { ...DEFAULTS, ...overrides };
  return { ...limits, queueMs: overrides.queueMs ?? limits.cliMs + limits.killGraceMs };
}

/**
 * Child timeouts stay under a client's 60 s request timeout (the MCP SDK's default) even after the longest queue
 * wait and the kill grace, so the caller hears the door's own message, not a generic timeout. A search runs to a
 * deadline that its queue waits count against, so it fits too.
 */
const DEFAULTS: Omit<Limits, "queueMs"> = {
  // A tool call's words are short; 64 KB leaves room for the longest note a write tool drafts.
  bodyBytes: 64_000,
  outputChars: 12_000,
  childBytes: 256_000,
  cliMs: 25_000,
  searchMs: 30_000,
  gitMs: 15_000,
  killGraceMs: 2_000,
  // One library search child peaks near 600 MB while it embeds.
  cliRunning: 2,
  cliWaiting: 4,
  gitRunning: 4,
  gitWaiting: 8,
  keepAliveMs: 100_000,
};

export const LIMITS: Limits = limitsWith();

export const BUSY = "the box is busy answering other requests; try again in a few seconds";
export const CANCELLED = "the request was cancelled";

/** A refusal said to the caller as a tool error: short, plain, no stack. */
export class Refusal extends Error {}

/**
 * At most `running` children of one kind at once. Up to `waiting` more calls wait for a slot (for at most
 * queueMs, or less when the caller says); the rest are refused at once. A waiting call whose caller hangs up leaves the queue.
 */
export class Gate {
  #active = 0;
  readonly #queue: Array<() => void> = [];

  constructor(
    readonly kind: string,
    private readonly running: number,
    private readonly waiting: number,
    private readonly queueMs: number,
    private readonly log: (line: string) => void,
  ) {}

  /** Resolves to a release function once a slot is free; rejects with a Refusal when busy or cancelled. */
  enter(signal: AbortSignal | undefined, waitMs = this.queueMs): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(new Refusal(CANCELLED));
    if (this.#active < this.running) {
      this.#active++;
      return Promise.resolve(this.#releaser());
    }
    if (this.#queue.length >= this.waiting) {
      this.log(`busy: a ${this.kind} call was refused (${this.#active} running, ${this.#queue.length} waiting)`);
      return Promise.reject(new Refusal(BUSY));
    }
    return new Promise((resolve, reject) => {
      const leave = (error: Error) => {
        const at = this.#queue.indexOf(grant);
        if (at !== -1) this.#queue.splice(at, 1);
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(error);
      };
      const onAbort = () => leave(new Refusal(CANCELLED));
      const timer = setTimeout(() => {
        this.log(`busy: a ${this.kind} call waited ${waitMs / 1000} s for a slot and was refused`);
        leave(new Refusal(BUSY));
      }, waitMs);
      const grant = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        this.#active++;
        resolve(this.#releaser());
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.#queue.push(grant);
    });
  }

  #releaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#active--;
      this.#queue.shift()?.();
    };
  }
}

export interface Ran {
  readonly code: number | null;
  readonly bytes: Buffer;
  readonly stdout: string;
  readonly stderr: string;
  readonly truncated: boolean;
  readonly timedOut: boolean;
  readonly aborted: boolean;
  readonly error?: NodeJS.ErrnoException;
}

export interface RunOptions {
  readonly gate: Gate;
  readonly signal: AbortSignal | undefined;
  readonly timeoutMs: number;
  /** Epoch ms by which the call ends, its wait for a slot included: neither the wait nor the child runs past it. */
  readonly deadline?: number;
  readonly maxBytes?: number;
  /** Keep only each output line's first clipLine bytes, so one huge line cannot use up maxBytes. */
  readonly clipLine?: number;
}

/** The door's children: where they run, what they inherit, and how long they may take. */
export class Children {
  readonly cli: Gate;
  readonly git: Gate;

  constructor(
    readonly config: VoiceConfig,
    readonly limits: Limits,
    log: (line: string) => void,
  ) {
    this.cli = new Gate("storytree", limits.cliRunning, limits.cliWaiting, limits.queueMs, log);
    this.git = new Gate("git", limits.gitRunning, limits.gitWaiting, limits.queueMs, log);
  }

  /** Run argv once a slot in its gate is free. Throws a Refusal when the gate is full or the call is cancelled. */
  async run(argv: readonly string[], options: RunOptions): Promise<Ran> {
    const left = () => (options.deadline === undefined ? Infinity : options.deadline - Date.now());
    const release = await options.gate.enter(options.signal, Math.max(0, Math.min(this.limits.queueMs, left())));
    try {
      const timeoutMs = Math.min(options.timeoutMs, left());
      if (timeoutMs <= 0) return { code: null, bytes: Buffer.alloc(0), stdout: "", stderr: "", truncated: false, timedOut: true, aborted: false };
      return await this.#spawn(argv, { ...options, timeoutMs });
    } finally {
      release();
    }
  }

  #spawn(argv: readonly string[], { signal, timeoutMs, maxBytes = this.limits.childBytes, clipLine }: RunOptions): Promise<Ran> {
    const grace = this.limits.killGraceMs;
    return new Promise((resolve) => {
      const out: Buffer[] = [];
      let outBytes = 0;
      let lineLen = 0;
      const clipChunk = (chunk: Buffer): Buffer => {
        if (clipLine === undefined) return chunk;
        const parts: Buffer[] = [];
        let start = 0;
        while (start < chunk.length) {
          const nl = chunk.indexOf(10, start);
          const end = nl === -1 ? chunk.length : nl;
          const take = Math.min(Math.max(0, clipLine - lineLen), end - start);
          if (take > 0) parts.push(chunk.subarray(start, start + take));
          lineLen += end - start;
          if (nl === -1) break;
          parts.push(chunk.subarray(nl, nl + 1));
          lineLen = 0;
          start = nl + 1;
        }
        return Buffer.concat(parts);
      };
      let truncated = false;
      let timedOut = false;
      let aborted = false;
      let stderr = "";
      let settled = false;
      let stopping = false;
      const timers: NodeJS.Timeout[] = [];
      const done = (extra: { code?: number | null; error?: NodeJS.ErrnoException } = {}) => {
        if (settled) return;
        settled = true;
        timers.forEach(clearTimeout);
        signal?.removeEventListener("abort", onAbort);
        const bytes = Buffer.concat(out);
        resolve({ code: null, bytes, stdout: bytes.toString("utf8"), stderr, truncated, timedOut, aborted, ...extra });
      };
      function onAbort() {
        aborted = true;
        stop();
      }
      if (signal?.aborted) {
        aborted = true;
        done();
        return;
      }
      const [command = "", ...args] = argv;
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(command, args, {
          cwd: this.config.repoDir,
          env: childEnvFor(this.config),
          shell: false,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error) {
        done({ error: error as NodeJS.ErrnoException });
        return;
      }
      // SIGTERM, then SIGKILL after a grace period; if the pipes still do not close (a grandchild holding them), stop waiting.
      const stop = () => {
        if (stopping) return;
        stopping = true;
        child.kill("SIGTERM");
        timers.push(setTimeout(() => {
          child.kill("SIGKILL");
          timers.push(setTimeout(() => done(), grace));
        }, grace));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      timers.push(setTimeout(() => {
        timedOut = true;
        stop();
      }, timeoutMs));
      child.stdout!.on("data", (raw: Buffer) => {
        if (truncated) return;
        const chunk = clipChunk(raw);
        if (chunk.length === 0) return;
        const room = maxBytes - outBytes;
        if (chunk.length > room) {
          out.push(chunk.subarray(0, room));
          outBytes = maxBytes;
          truncated = true;
          stop();
        } else {
          out.push(chunk);
          outBytes += chunk.length;
        }
      });
      child.stderr!.on("data", (chunk: Buffer) => {
        if (stderr.length < 8_000) stderr += chunk.toString("utf8");
      });
      child.on("error", (error) => done({ error }));
      child.on("close", (code) => done({ code }));
    });
  }
}
