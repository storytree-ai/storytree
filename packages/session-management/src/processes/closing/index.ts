// Capability 16 · Finish with an honest inventory
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
  readonly knownGaps?: readonly ObservationGap[];
}
export interface ClearOptions extends ObservationOptions, KnownGaps {
  readonly owner: RunOwner;
}
export interface ClearDependencies {
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
  readonly gaps: readonly ObservationGap[];
  readonly coverage: string;
}

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
    const latest = await readLedger({ home });
    remember(latest.gaps);
    const members = descendants(id, latest.runs);
    const observed = new Map(current.runs.map(row => [row.run.id, row]));
    const latestById = new Map(latest.runs.map(run => [run.id, run]));
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
  readonly status: 'empty' | 'remaining' | 'incomplete';
  readonly inventory: Inventory;
}

export async function readClosing(options: ClosingOptions = {}): Promise<ClosingReading> {
  const carried = (options.knownGaps ?? []).map(gap => gapSchema.parse(gap));
  const reading = await listRuns({ ...options, scope: 'all' });
  const inventory: Inventory = { ...reading, gaps: [...reading.gaps, ...carried],
    complete: reading.complete && carried.length === 0 };
  return { inventory, status: !inventory.complete ? 'incomplete' :
    inventory.rows.some(row => row.process.state !== 'gone') ? 'remaining' : 'empty' };
}

export function renderClosing(reading: ClosingReading): string {
  const verdict = reading.status === 'empty' ? 'Closing reading: no tracked session work remains on this machine.' :
    reading.status === 'incomplete' ? 'Closing reading incomplete: missing evidence prevents a clearance claim.' :
      'Closing reading: tracked session work remains on this machine.';
  return `${verdict}\n${renderInventory(reading.inventory)}\nThis observation does not clear remote machines or stop shared infrastructure.`;
}
