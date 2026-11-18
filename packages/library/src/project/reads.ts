// Capability 28 · Shared server
import { AsyncLocalStorage } from "node:async_hooks";
import { win32 } from "node:path";

import type { Pool, PoolClient } from "pg";

export interface ReadTotal {
  readonly reader: string;
  readonly bytes: number;
  readonly statements: number;
}

export function scriptReader(argv: readonly string[]): string {
  const [executable = "", script = ""] = argv;
  if (script !== "" && !script.startsWith("-")) return win32.basename(script);
  return executable === "" ? "no script" : `no script (${win32.basename(executable)})`;
}

let processReader = scriptReader(process.argv);
const calling = new AsyncLocalStorage<string>();
const counted = new Map<string, { bytes: number; statements: number }>();

export function nameReader(name: string): void {
  processReader = name;
}

export function processReaderName(): string {
  return processReader;
}

export function asReader<T>(name: string, call: () => T): T {
  return calling.run(name, call);
}

export function readerName(): string {
  return calling.getStore() ?? processReader;
}

export function takeReads(): ReadTotal[] {
  const totals = [...counted].map(([reader, total]) => ({ reader, ...total })).sort((a, b) => b.bytes - a.bytes);
  counted.clear();
  return totals;
}

export function giveBackReads(totals: readonly ReadTotal[]): void {
  for (const { reader, bytes, statements } of totals) add(reader, bytes, statements);
}

function add(reader: string, bytes: number, statements: number): void {
  if (bytes <= 0 && statements <= 0) return;
  const total = counted.get(reader) ?? { bytes: 0, statements: 0 };
  counted.set(reader, { bytes: total.bytes + bytes, statements: total.statements + statements });
}

const lastWords = new WeakMap<Pool, () => Promise<unknown>>();

export function atEnd(pool: Pool, last: () => Promise<unknown>): void {
  lastWords.set(pool, last);
}

export function lastWordsOf(pool: Pool): (() => Promise<unknown>) | undefined {
  const last = lastWords.get(pool);
  lastWords.delete(pool);
  return last;
}

interface Streamed {
  readonly connection?: { readonly stream?: { readonly bytesRead?: number; readonly _parent?: { readonly bytesRead?: number } } };
}

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
