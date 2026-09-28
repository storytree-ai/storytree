/** Capability 5: conservative record cleanup and a bounded, all-session closing reading. */
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { ledgerHome, readLedger, reason } from '../ledger/files.js';
import { gapSchema, ownerSchema, sameOwner } from '../ledger/records.js';
import type { ObservationGap, RunOwner, RunRecord } from '../ledger/records.js';
import { listRuns, renderInventory } from '../listing/index.js';
import type { Inventory, InventoryOptions } from '../listing/index.js';
import { observeRuns } from '../observation/observe.js';
import type { ObservationOptions } from '../observation/observe.js';

export interface KnownGaps {
  /** Carry launch gaps whose persistence failed; a later disk read cannot recover them. */
  readonly knownGaps?: readonly ObservationGap[];
}
export interface ClearOptions extends ObservationOptions, KnownGaps {
  readonly owner: RunOwner;
}
export interface ClearDependencies {
  /** Same semantics as unlink: resolve only after removing the file, reject on failure. */
  readonly remove?: (file: string) => Promise<void>;
}
export interface RetainedRecord {
  readonly run: string;
  readonly reason: string;
  readonly blockedBy: readonly string[];
}
export interface FailedRemoval {
  readonly run: string;
  readonly path: string;
  readonly reason: string;
}
export interface ClearResult {
  readonly machine: string;
  readonly owner: RunOwner;
  readonly removed: readonly string[];
  readonly retained: readonly RetainedRecord[];
  readonly failed: readonly FailedRemoval[];
  /** Unreadable records have no trustworthy owner/run ID and are reported here, never removed. */
  readonly gaps: readonly ObservationGap[];
  readonly coverage: string;
}

/**
 * Only caller records are removed. Explicit descendants must also be confirmed gone, including
 * delegated sessions whose records this caller cannot clear. Any missing evidence blocks cleanup.
 * No signals, request/gap deletion, claim releases or session-age expiry. Launch records are
 * immutable; rereading detects changed records and late child registrations before each unlink.
 * This is a snapshot, not a launch interlock: subsequent launches need another closing reading.
 */
export async function clearOwned(options: ClearOptions, dependencies: ClearDependencies = {}): Promise<ClearResult> {
  const owner = ownerSchema.parse(options.owner);
  const home = ledgerHome(options);
  const gaps = new Map<string, ObservationGap>();
  const remember = (items: readonly ObservationGap[]) => {
    for (const gap of items) gaps.set(JSON.stringify(gap), gap);
  };
  remember((options.knownGaps ?? []).map(gap => gapSchema.parse(gap)));
  const initial = await observeRuns({ ...options, home });
  remember(initial.gaps);
  const removed: string[] = [];
  const retained: RetainedRecord[] = [];
  const failed: FailedRemoval[] = [];
  for (const original of initial.runs.filter(row => callerRecord(owner, row.run.owner))) {
    const id = original.run.id;
    const current = await observeRuns({ ...options, home });
    remember(current.gaps);
    // Read after the probes too: a child can register while native observation is in flight.
    const latest = await readLedger({ home });
    remember(latest.gaps);
    const members = descendants(id, latest.runs);
    const observed = new Map(current.runs.map(row => [row.run.id, row]));
    const latestById = new Map(latest.runs.map(run => [run.id, run]));
    // Compare both directions: disappearing/reparented children are lost evidence too.
    // Only deletions this call has confirmed itself may shrink the original membership.
    const previous = [...descendants(id, initial.runs.map(row => row.run)),
      ...descendants(id, current.runs.map(row => row.run))].filter(run => !removed.includes(run.id));
    const root = latest.runs.find(run => run.id === id);
    const changed = !root || !sameRecord(original.run, root) ||
      previous.some(run => !latestById.has(run.id) || !sameRecord(run, latestById.get(run.id)!)) ||
      members.some(run => {
        const row = observed.get(run.id);
        return !row || !sameRecord(row.run, run);
      });
    const blockedBy = [...new Set([...previous, ...members]
      .filter(run => !latestById.has(run.id) || observed.get(run.id)?.process.state !== 'gone').map(run => run.id))];
    const why = changed ? 'run ownership, record or child membership changed during clear; retained' :
      gaps.size > 0 ? 'inventory is incomplete; covered children cannot all be confirmed gone' :
      blockedBy.length > 0 ? 'original process or a registered descendant is live or unknown' : undefined;
    if (why) {
      retained.push({ run: id, reason: why, blockedBy });
      continue;
    }
    const file = path.join(home, 'runs', `${id}.json`);
    try {
      await (dependencies.remove ?? unlink)(file);
      removed.push(id);
    } catch (error) { failed.push({ run: id, path: file, reason: reason(error) }); }
  }
  return { machine: initial.machine, owner, removed, retained, failed,
    gaps: [...gaps.values()], coverage: initial.coverage };
}

function callerRecord(caller: RunOwner, owner: RunOwner): boolean {
  if (!sameOwner(caller, owner)) return false;
  if (caller.agent === undefined || caller.agent === 'orchestrator') return true;
  return typeof caller.agent === 'object' && typeof owner.agent === 'object' && caller.agent.subagent === owner.agent.subagent;
}
function sameRecord(left: RunRecord, right: RunRecord): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
function descendants(root: string, runs: readonly RunRecord[]): RunRecord[] {
  const ids = new Set([root]);
  for (const id of ids) for (const run of runs) if (run.parentRun === id) ids.add(run.id);
  return runs.filter(run => ids.has(run.id));
}

export interface ClosingOptions extends Omit<InventoryOptions, 'scope' | 'stopAction'>, KnownGaps {}
export interface ClosingReading {
  /** empty means no live/unknown tracked session work, even if gone records remain on disk. */
  readonly status: 'empty' | 'remaining' | 'incomplete';
  readonly inventory: Inventory;
}

/** Always reads all local session records, regardless of caller, session end or released claims. */
export async function readClosing(options: ClosingOptions = {}): Promise<ClosingReading> {
  const carried = (options.knownGaps ?? []).map(gap => gapSchema.parse(gap));
  const reading = await listRuns({ ...options, scope: 'all' });
  const inventory: Inventory = { ...reading, gaps: [...reading.gaps, ...carried],
    complete: reading.complete && carried.length === 0 };
  return { inventory, status: !inventory.complete ? 'incomplete' :
    inventory.rows.some(row => row.process.state !== 'gone') ? 'remaining' : 'empty' };
}

/** Evidence for the existing closing leg; this does not grant or perform session closure. */
export function renderClosing(reading: ClosingReading): string {
  const verdict = reading.status === 'empty' ? 'Closing reading: no tracked session work remains on this machine.' :
    reading.status === 'incomplete' ? 'Closing reading incomplete: missing evidence prevents a clearance claim.' :
      'Closing reading: tracked session work remains on this machine.';
  return `${verdict}\n${renderInventory(reading.inventory)}\nThis observation does not clear remote machines or stop shared infrastructure.`;
}
