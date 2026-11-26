// Capability 28 · Shared server
import { AsyncLocalStorage } from "node:async_hooks";

export interface ReadTotal {
  readonly reader: string;
  readonly bytes: number;
  readonly statements: number;
}

const calls = new AsyncLocalStorage<string>();
const totals = new Map<string, { bytes: number; statements: number }>();
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
