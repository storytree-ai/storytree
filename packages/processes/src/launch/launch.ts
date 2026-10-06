/** Capability 1 · Record who started each run. */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { ledgerHome, localMachine, readLedger, reason, writeGap, writeRecord } from '../ledger/files.js';
import type { LedgerOptions } from '../ledger/files.js';
import { ownerSchema, runSchema, sameOwner } from '../ledger/records.js';
import type { ObservationGap, RunOwner, RunRecord } from '../ledger/records.js';
import { readProcess } from '../process/index.js';
import type { ProcessReading } from '../process/index.js';

export interface LaunchOptions extends LedgerOptions {
  readonly owner?: RunOwner;
  readonly project?: string;
  /** Executable and literal argv. For a shell command, explicitly launch that shell. */
  readonly command: string;
  readonly args?: readonly string[];
  readonly folder: string;
  readonly env?: NodeJS.ProcessEnv;
  /** Another registered run, with the same owner or an explicit parentSession delegation. */
  readonly parentRun?: string;
}
export type LaunchResult =
  | { readonly status: 'tracked'; readonly pid: number; readonly run: RunRecord }
  | { readonly status: 'untracked'; readonly pid?: number; readonly gap: ObservationGap; readonly gapRecorded: boolean };
export interface LaunchDependencies { readonly readProcess?: (pid: number) => Promise<ProcessReading> }

/**
 * The ONE launch boundary for harness adapters and session-bound terminals. Independent of turns,
 * claims and library connectivity. It never adopts an arbitrary PID. Tracking is reported only
 * after durable registration; an unsuccessful launch/registration is an explicit coverage gap.
 */
export async function launchOwned(options: LaunchOptions, dependencies: LaunchDependencies = {}): Promise<LaunchResult> {
  const home = ledgerHome(options);
  const untracked = async (message: string, pid?: number): Promise<LaunchResult> => {
    const gap: ObservationGap = { kind: 'registration', reason: message, at: new Date().toISOString(), ...(pid === undefined ? {} : { pid }) };
    return { status: 'untracked', ...(pid === undefined ? {} : { pid }), gap, gapRecorded: await writeGap(home, gap) };
  };
  const checked = ownerSchema.safeParse(options.owner);
  if (!checked.success) return untracked('launch needs a usable resolved owner; no process was started');
  const owner = checked.data;
  if (options.parentRun !== undefined) {
    const ledger = await readLedger({ home });
    const parent = ledger.runs.find(run => run.id === options.parentRun);
    if (!parent || parent.machine !== localMachine() ||
        (!sameOwner(parent.owner, owner) && !(owner.parentSession === parent.owner.session && owner.harness === parent.owner.harness))) {
      return untracked('parent run needs an explicit matching owner or parentSession link; no process was started');
    }
  }
  const id = randomUUID();
  const startedAt = new Date().toISOString();
  let child;
  try {
    child = spawn(options.command, [...options.args ?? []], {
      cwd: options.folder, env: options.env ?? process.env, detached: true, stdio: 'ignore', windowsHide: true,
    });
    await new Promise<void>((resolve, reject) => { child!.once('spawn', resolve); child!.once('error', reject); });
  } catch (error) { return untracked(`launch failed: ${reason(error)}`); }
  const pid = child.pid!;
  child.unref();
  let birth: ProcessReading;
  try { birth = await (dependencies.readProcess ?? readProcess)(pid); }
  catch (error) { birth = { state: 'unknown', reason: `launch identity unavailable: ${reason(error)}` }; }
  // libuv may reap several children before dispatching their exit callbacks. Let that batch
  // finish: the spawned handle's confirmed exit outranks a lookup that saw a reused PID.
  await setImmediate();
  if (child.exitCode !== null || child.signalCode !== null) birth = { state: 'gone' };
  try {
    const run = runSchema.parse({
      version: 1, id, owner, machine: localMachine(), pid, birth,
      command: options.command, args: [...options.args ?? []], folder: path.resolve(options.folder),
      startedAt,
      ...(options.project === undefined ? {} : { project: options.project }),
      ...(options.parentRun === undefined ? {} : { parentRun: options.parentRun }),
    });
    await writeRecord(path.join(home, 'runs', `${id}.json`), run);
    return { status: 'tracked', pid, run };
  } catch (error) { return untracked(`run registration failed: ${reason(error)}`, pid); }
}
