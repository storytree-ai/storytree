/** Capability 4 · Stop the work I own. */
import { performance } from 'node:perf_hooks';
import { setTimeout as pause } from 'node:timers/promises';
import { z } from 'zod';
import { localMachine, readLedger, reason } from '../ledger/files.js';
import type { LedgerOptions, LedgerReading } from '../ledger/files.js';
import { ownerSchema, sameOwner } from '../ledger/records.js';
import type { ObservationGap, RunOwner, RunRecord } from '../ledger/records.js';
import { LAUNCH_COVERAGE } from '../observation/observe.js';
import { probeProcess } from '../process/index.js';
import type { ProcessIdentity, ProcessReading } from '../process/index.js';
import { signalProcess } from './signal.js';
import type { SignalResult, StopPhase } from './signal.js';

export interface StopOptions extends LedgerOptions {
  readonly owner: RunOwner;
  /** Explicit immutable run IDs, never PIDs, commands, groups or an implicit "all". */
  readonly targets: readonly string[];
  readonly graceMs?: number;
  readonly forceMs?: number;
}
export interface StopDependencies {
  readonly probe?: (identity: ProcessIdentity) => Promise<ProcessReading>;
  /** Must bind/revalidate the recorded lifetime at delivery, as the native implementation does. */
  readonly signal?: (identity: ProcessIdentity, phase: StopPhase) => Promise<SignalResult>;
}
export interface StopAttempt { readonly phase: StopPhase; readonly result: SignalResult }
export interface StopMember {
  readonly run: string;
  readonly pid: number;
  readonly owner: RunOwner;
  readonly process: ProcessReading;
  readonly attempts: readonly StopAttempt[];
}
export interface StopExclusion { readonly run: string; readonly owner: RunOwner; readonly reason: string }
export interface StopTarget {
  readonly target: string;
  readonly owner?: RunOwner;
  /** stopped/already-gone apply ONLY to the stated registered membership. */
  readonly status: 'stopped' | 'already-gone' | 'refused' | 'incomplete';
  readonly reason?: string;
  readonly members: readonly StopMember[];
  readonly excluded: readonly StopExclusion[];
}
export interface StopResult {
  readonly machine: string;
  readonly scope: 'registered-runs-and-linked-descendants';
  readonly nativeTree: 'unconfirmed';
  readonly ok: boolean;
  readonly targets: readonly StopTarget[];
  readonly gaps: readonly ObservationGap[];
  readonly coverage: string;
}

function sessionAuthority(caller: RunOwner): boolean {
  return caller.agent === undefined || caller.agent === 'orchestrator';
}
/** Delegation comes only from registered parentSession edges, never command/folder/age. */
export function owns(caller: RunOwner, owner: RunOwner, runs: readonly RunRecord[], visited = new Set<string>()): boolean {
  if (caller.harness !== owner.harness) return false;
  if (sameOwner(caller, owner)) {
    if (sessionAuthority(caller)) return true;
    return typeof caller.agent === 'object' && typeof owner.agent === 'object' && caller.agent.subagent === owner.agent.subagent;
  }
  if (!sessionAuthority(caller) || !owner.parentSession || visited.has(owner.session)) return false;
  if (owner.parentSession === caller.session) return true;
  visited.add(owner.session);
  return runs.some(run => run.owner.session === owner.parentSession && run.owner.harness === owner.harness &&
    owns(caller, run.owner, runs, new Set(visited)));
}
function sameLifetime(left: RunRecord, right: RunRecord): boolean {
  if (left.machine !== right.machine || left.pid !== right.pid) return false;
  // Missing birth evidence cannot prove that a conflicting PID registration is harmless.
  if (left.birth.state !== 'live' || right.birth.state !== 'live') return right.birth.state !== 'gone';
  return left.birth.identity.platform === right.birth.identity.platform && left.birth.identity.boot === right.birth.identity.boot &&
    left.birth.identity.started === right.birth.identity.started;
}
export function refusal(run: RunRecord, caller: RunOwner, ledger: Pick<LedgerReading, 'machine' | 'runs'>): string | undefined {
  if (run.machine !== ledger.machine) return 'run belongs to another computer';
  if (!owns(caller, run.owner, ledger.runs)) return 'run is outside the caller’s established ownership/delegation scope';
  if (ledger.runs.some(other => other.id !== run.id && sameLifetime(run, other) && !owns(caller, other.owner, ledger.runs))) {
    return 'process has a conflicting or unestablished owner in another registration';
  }
  return undefined;
}
function descendants(root: RunRecord, runs: readonly RunRecord[]): RunRecord[] {
  const members = [root];
  const seen = new Set([root.id]);
  for (let i = 0; i < members.length; i++) {
    for (const run of runs) if (run.parentRun === members[i]!.id && !seen.has(run.id)) {
      seen.add(run.id);
      members.push(run);
    }
  }
  return members;
}
function bounded(value: number | undefined, fallback: number): number {
  const ms = value ?? fallback;
  if (!Number.isFinite(ms) || ms < 0 || ms > 30_000) throw new Error('stop waits must be between 0 and 30000 milliseconds');
  return ms;
}

/**
 * Stops only explicit registered membership, individually; never signals an OS group or inferred
 * tree. There is no launch interlock: newly registered descendants cause an incomplete result.
 * Records remain intact, including confirmed-gone ones; clearing belongs to capability 5.
 */
export async function stopOwned(options: StopOptions, dependencies: StopDependencies = {}): Promise<StopResult> {
  const waits = { polite: bounded(options.graceMs, 2000), force: bounded(options.forceMs, 2000) };
  const caller = ownerSchema.safeParse(options.owner);
  const probe = dependencies.probe ?? probeProcess;
  const signal = dependencies.signal ?? signalProcess;
  const gaps = new Map<string, ObservationGap>();
  const read = async () => {
    const ledger = await readLedger(options);
    for (const gap of ledger.gaps) gaps.set(JSON.stringify(gap), gap);
    return ledger;
  };
  const observe = async (run: RunRecord): Promise<ProcessReading> => {
    if (run.birth.state !== 'live') return run.birth;
    try { return await probe(run.birth.identity); }
    catch (error) { return { state: 'unknown', reason: `process probe failed: ${reason(error)}` }; }
  };
  const targets: StopTarget[] = [];
  for (const target of options.targets) {
    const ledger = await read();
    const root = ledger.runs.find(run => run.id === target);
    const rejected = !z.uuid().safeParse(target).success ? 'target must be a registered run UUID' :
      !root ? 'target is unregistered or its record cannot be read' :
      !caller.success ? 'stop needs a usable resolved caller' : refusal(root, caller.data, ledger);
    if (rejected || !root || !caller.success) {
      targets.push({ target, ...(root ? { owner: root.owner } : {}), status: 'refused',
        reason: rejected ?? 'unestablished ownership', members: [], excluded: [] });
      continue;
    }
    const excluded = new Map<string, StopExclusion>();
    const covered = new Map<string, RunRecord>();
    for (const run of descendants(root, ledger.runs)) {
      const parent = run.id === root.id ? undefined : covered.get(run.parentRun!);
      const badLink = run.id !== root.id && (!parent || (!sameOwner(parent.owner, run.owner) &&
        !(run.owner.parentSession === parent.owner.session && run.owner.harness === parent.owner.harness)));
      const why = refusal(run, caller.data, ledger) ?? (badLink ? 'parent link does not establish ownership of this descendant' : undefined);
      if (why) excluded.set(run.id, { run: run.id, owner: run.owner, reason: why });
      else covered.set(run.id, run);
    }
    const members = new Map<string, { run: string; pid: number; owner: RunOwner; process: ProcessReading; attempts: StopAttempt[] }>();
    for (const run of covered.values()) members.set(run.id, { run: run.id, pid: run.pid, owner: run.owner, process: await observe(run), attempts: [] });
    const refresh = async () => {
      const current = await read();
      for (const run of descendants(root, current.runs)) if (!covered.has(run.id) && !excluded.has(run.id)) {
        excluded.set(run.id, { run: run.id, owner: run.owner, reason: 'descendant registered during the stop; name it in a new stop request' });
      }
      for (const run of covered.values()) {
        const found = current.runs.find(row => row.id === run.id);
        const why = !found || JSON.stringify(found) !== JSON.stringify(run) ? 'run record changed or became unreadable during stop' : refusal(found, caller.data, current);
        const member = members.get(run.id)!;
        if (why) {
          excluded.set(run.id, { run: run.id, owner: run.owner, reason: why });
          member.process = { state: 'unknown', reason: why };
        } else if (!excluded.has(run.id)) member.process = await observe(run);
      }
    };
    for (const phase of ['polite', 'force'] as const) {
      await refresh();
      // Parent first limits fresh work; every covered child is still independently checked.
      for (const run of covered.values()) {
        // A previous member may have registered more work while its signal was in flight.
        await refresh();
        const member = members.get(run.id)!;
        if (excluded.has(run.id) || member.process.state !== 'live' || run.birth.state !== 'live') continue;
        let result: SignalResult;
        try { result = await signal(run.birth.identity, phase); }
        catch (error) { result = { status: 'unknown', reason: `stop attempt failed: ${reason(error)}` }; }
        member.attempts.push({ phase, result });
      }
      const deadline = performance.now() + waits[phase];
      do {
        // Checks follow even unsupported/failed attempts; signal acceptance is not the verdict.
        await refresh();
        if ([...members.values()].every(member => member.process.state === 'gone') || performance.now() >= deadline) break;
        await pause(Math.min(25, Math.max(0, deadline - performance.now())));
      } while (true);
      if ([...members.values()].every(member => member.process.state === 'gone')) break;
    }
    const complete = excluded.size === 0 && gaps.size === 0 && [...members.values()].every(member => member.process.state === 'gone');
    const attempted = [...members.values()].some(member => member.attempts.length > 0);
    targets.push({ target, owner: root.owner, status: complete ? (attempted ? 'stopped' : 'already-gone') : 'incomplete',
      ...(!complete ? { reason: 'covered work, ownership or inventory could not be fully confirmed gone; records retained' } : {}),
      members: [...members.values()], excluded: [...excluded.values()] });
  }
  return { machine: localMachine(), scope: 'registered-runs-and-linked-descendants', nativeTree: 'unconfirmed',
    ok: targets.length > 0 && targets.every(target => target.status === 'stopped' || target.status === 'already-gone'),
    targets, gaps: [...gaps.values()], coverage: LAUNCH_COVERAGE };
}
