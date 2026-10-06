/** Capability 1 · Record who started each run. */
import { randomUUID } from 'node:crypto';
import { mkdir, open, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import path from 'node:path';
import type { z } from 'zod';
import { gapSchema, outcomeSchema, runSchema } from './records.js';
import type { ObservationGap, RequestEvidence, RunRecord } from './records.js';

export interface LedgerOptions { readonly home?: string }
export function ledgerHome(options: LedgerOptions = {}): string {
  return path.resolve(options.home ?? path.join(process.env.STORYTREE_HOME ?? path.join(homedir(), '.storytree', '0.3'), 'own'));
}
export const localMachine = (): string => hostname();
export function reason(error: unknown): string { return error instanceof Error ? error.message : String(error); }

/** Sync the complete record before publishing it. No shared append or read/modify/write lock. */
export async function writeRecord(file: string, value: unknown): Promise<void> {
  const dir = path.dirname(file);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(`${JSON.stringify(value)}\n`); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, file);
    if (process.platform !== 'win32') {
      const directory = await open(dir, 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    }
  } finally { await rm(temporary, { force: true }).catch(() => {}); }
}
export async function writeGap(home: string, gap: ObservationGap): Promise<boolean> {
  try { await writeRecord(path.join(home, 'gaps', `${randomUUID()}.json`), gap); return true; }
  catch { return false; } // The caller still receives the gap and this failed persistence flag.
}
export interface LedgerReading {
  readonly machine: string;
  readonly runs: readonly RunRecord[];
  readonly outcomes: readonly RequestEvidence[];
  readonly gaps: readonly ObservationGap[];
}
/** Local, offline, append-only until capability 5 explicitly clears confirmed-gone work. */
export async function readLedger(options: LedgerOptions = {}): Promise<LedgerReading> {
  const home = ledgerHome(options);
  const gaps: ObservationGap[] = [];
  // A home that exists but is not a folder is a read gap, not an empty ledger: Windows reports
  // ENOENT (not ENOTDIR) for a folder beneath a file, so the per-folder check alone cannot tell.
  try {
    if (!(await stat(home)).isDirectory()) {
      gaps.push({ kind: 'read', path: home, reason: 'cannot read ledger: its home is not a folder' });
      return { machine: localMachine(), runs: [], outcomes: [], gaps };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') gaps.push({ kind: 'read', path: home, reason: `cannot read ledger: ${reason(error)}` });
  }
  const runs = await readFolder(path.join(home, 'runs'), runSchema, gaps, (run, name) => name === `${run.id}.json`);
  const outcomes = await readFolder(path.join(home, 'requests'), outcomeSchema, gaps);
  const recordedGaps = await readFolder(path.join(home, 'gaps'), gapSchema, gaps);
  return { machine: localMachine(), runs, outcomes, gaps: [...gaps, ...recordedGaps] };
}
async function readFolder<T>(dir: string, schema: z.ZodType<T>, gaps: ObservationGap[], matches?: (item: T, name: string) => boolean): Promise<T[]> {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') gaps.push({ kind: 'read', path: dir, reason: `cannot read ledger: ${reason(error)}` });
    return [];
  }
  const values: T[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(dir, entry.name);
    try {
      if (!entry.isFile()) throw new Error('expected a regular ledger file');
      const parsed = schema.parse(JSON.parse(await readFile(file, 'utf8')));
      if (matches && !matches(parsed, entry.name)) throw new Error('record id differs from its file name');
      values.push(parsed);
    } catch (error) { gaps.push({ kind: 'read', path: file, reason: `cannot read record: ${reason(error)}` }); }
  }
  return values;
}
