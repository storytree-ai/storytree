// Capability 28 · Shared server
import { AsyncLocalStorage } from "node:async_hooks";
import type { Duplex } from "node:stream";

import type { Client, ClientBase, Pool } from "pg";

export interface ReadTotal {
  readonly reader: string;
  readonly bytes: number;
  readonly statements: number;
}

const calls = new AsyncLocalStorage<string>();
const totals = new Map<string, { bytes: number; statements: number }>();
const lastWords = new WeakMap<Pool, () => Promise<unknown>>();
let named: string | undefined;

function fileName(file: string): string {
  return file.split(/[\\/]/).pop() ?? file;
}

export function scriptReader(argv: readonly string[]): string {
  const script = argv[1];
  if (script !== undefined && script !== "" && !script.startsWith("-")) return fileName(script);
  return argv[0] === undefined ? "no script" : `no script (${fileName(argv[0])})`;
}

export function nameReader(name: string): void {
  named = name;
}

export function processReaderName(): string {
  return named ?? scriptReader(process.argv);
}

export function asReader<T>(name: string, call: () => T): T {
  return calls.run(name, call);
}

export function readerName(): string {
  return calls.getStore() ?? processReaderName();
}

export function tally(reader: string, bytes: number, statements: number): void {
  if (bytes === 0 && statements === 0) return;
  const total = totals.get(reader) ?? { bytes: 0, statements: 0 };
  total.bytes += bytes;
  total.statements += statements;
  totals.set(reader, total);
}

export function takeReads(): ReadTotal[] {
  const taken = [...totals].map(([reader, total]) => ({ reader, ...total }));
  totals.clear();
  return taken;
}

export function giveBackReads(given: readonly ReadTotal[]): void {
  for (const total of given) tally(total.reader, total.bytes, total.statements);
}

export function atEnd(pool: Pool, last: () => Promise<unknown>): void {
  lastWords.set(pool, last);
}

export function lastWordsOf(pool: Pool): (() => Promise<unknown>) | undefined {
  return lastWords.get(pool);
}

export function countReads(client: ClientBase): void {
  let reader = readerName();
  const { connection } = client as Client;
  const raw = connection.stream as Duplex & { bytesRead?: number };
  let seen = 0;
  const charge = (): void => {
    const total = raw.bytesRead ?? seen;
    tally(reader, total - seen, 0);
    seen = total;
  };
  raw.on("data", charge).on("close", charge);
  connection.once("sslconnect", () => connection.stream.on("data", charge));
  const query = client.query.bind(client) as (...args: unknown[]) => unknown;
  client.query = ((...args: unknown[]) => {
    reader = readerName();
    tally(reader, 0, 1);
    return query(...args);
  }) as ClientBase["query"];
}
