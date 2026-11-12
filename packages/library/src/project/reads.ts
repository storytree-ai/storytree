/**
 * Capability 28 · Shared server. Who reads the library, and how much (contract 28.12, increment_28a5cea44ef7): every
 * byte the server sends a library connection, its handshake and TLS included, is counted against the reader that asked
 * for it, so a shared server's egress can be ranked by reader rather than guessed from socket counters.
 *
 * - The reader is the process's (a command names it, `arc show`, before it connects; by default the script it runs, or
 *   "no script (<executable>)" when it runs none, contract 28.13), or, for a call made inside asReader, that call's (a
 *   tool server names each tool's call, the desktop app each page operation's).
 * - A connection's application_name names the process's reader (server.ts), so pg_stat_activity says who holds it.
 * - The counts stay in this process until takeReads hands them over: the activity log records them as a bounded
 *   total per machine, reader and day, never a line per statement, last as the pool it records through ends (atEnd).
 * - A connection whose socket keeps no byte count (one over a WebSocket) is not counted.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { win32 } from "node:path";

import type { Pool, PoolClient } from "pg";

/** What one reader received: its bytes, and how many statements it sent. */
export interface ReadTotal {
  readonly reader: string;
  readonly bytes: number;
  readonly statements: number;
}

/**
 * The reader a process is before it names one: the script it runs (argv[1]'s file name), or, when argv[1] is empty or a
 * flag (a packaged Electron app, one its updater relaunched with --updated), that it runs none, with its executable.
 */
export function scriptReader(argv: readonly string[]): string {
  const [executable = "", script = ""] = argv;
  if (script !== "" && !script.startsWith("-")) return win32.basename(script);
  return executable === "" ? "no script" : `no script (${win32.basename(executable)})`;
}

let processReader = scriptReader(process.argv);
const calling = new AsyncLocalStorage<string>();
const counted = new Map<string, { bytes: number; statements: number }>();

/** Name this process's reader: what it reads from now on, outside an asReader call, is counted as `name`'s. */
export function nameReader(name: string): void {
  processReader = name;
}

/** This process's reader, as nameReader last named it. */
export function processReaderName(): string {
  return processReader;
}

/** Run `call` as reader `name`: what it reads, however long it runs, is counted as `name`'s. */
export function asReader<T>(name: string, call: () => T): T {
  return calling.run(name, call);
}

/** The reader a read made here is counted against: the asReader call's it runs in, else the process's. */
export function readerName(): string {
  return calling.getStore() ?? processReader;
}

/** What each reader received since the last take, the most first; taking it starts the counts again. */
export function takeReads(): ReadTotal[] {
  const totals = [...counted].map(([reader, total]) => ({ reader, ...total })).sort((a, b) => b.bytes - a.bytes);
  counted.clear();
  return totals;
}

/** Give back totals taken but not recorded (a write that failed), so the next take carries them. */
export function giveBackReads(totals: readonly ReadTotal[]): void {
  for (const { reader, bytes, statements } of totals) add(reader, bytes, statements);
}

function add(reader: string, bytes: number, statements: number): void {
  if (bytes <= 0 && statements <= 0) return;
  const total = counted.get(reader) ?? { bytes: 0, statements: 0 };
  counted.set(reader, { bytes: total.bytes + bytes, statements: total.statements + statements });
}

const lastWords = new WeakMap<Pool, () => Promise<unknown>>();

/**
 * Run `last` (a record of what was read) as `pool`'s last statements, when it is asked to end and before it does: a
 * pool's closer and its recorder may close side by side, and a statement asked for once the pool is ending is never
 * answered. The latest given for a pool is the one run; a failure in it never stops the pool ending.
 */
export function atEnd(pool: Pool, last: () => Promise<unknown>): void {
  lastWords.set(pool, last);
}

/** What `pool` was given to run before it ends, taken so it runs once; none if it was given nothing. */
export function lastWordsOf(pool: Pool): (() => Promise<unknown>) | undefined {
  const last = lastWords.get(pool);
  lastWords.delete(pool);
  return last;
}

/** The pg 8 internals a count reads: the connection's stream, a TLS socket over the raw one once TLS is on. */
interface Streamed {
  readonly connection?: { readonly stream?: { readonly bytesRead?: number; readonly _parent?: { readonly bytesRead?: number } } };
}

/**
 * Count what `client` receives from now on: what it received opening (the handshake) against the reader now, and after
 * each statement settles, what arrived since against the reader that sent it: a statement given a callback (pg-pool's
 * pool.query) or answering with a promise; storytree sends no other kind. The raw socket's bytes are read, under
 * TLS, so the count is what the network carried.
 */
export function countReads(client: PoolClient): void {
  const received = (): number | undefined => {
    const stream = (client as unknown as Streamed).connection?.stream;
    const bytes = stream?._parent?.bytesRead ?? stream?.bytesRead;
    return typeof bytes === "number" ? bytes : undefined;
  };
  let charged = 0;
  const charge = (reader: string, statements: number) => {
    const now = received();
    if (now === undefined) return;
    add(reader, now - charged, statements);
    charged = now;
  };
  charge(readerName(), 0);
  const query = client.query as (...args: unknown[]) => unknown;
  (client as { query: unknown }).query = function counting(this: unknown, ...args: unknown[]): unknown {
    const reader = readerName();
    const settled = () => charge(reader, 1);
    const last = args.length - 1;
    const callback = args[last];
    if (typeof callback === "function") {
      args[last] = function (this: unknown, ...results: unknown[]) {
        settled();
        return callback.apply(this, results);
      };
      return query.apply(this, args);
    }
    const result = query.apply(this, args) as { then?: unknown } | undefined;
    if (typeof result?.then === "function") (result as Promise<unknown>).then(settled, settled);
    return result;
  };
}
