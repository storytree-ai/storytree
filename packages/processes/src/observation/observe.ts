/** Capability 2 · Keep sight of unfinished runs. */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { ledgerHome, readLedger, reason, writeRecord } from '../ledger/files.js';
import type { LedgerOptions } from '../ledger/files.js';
import { outcomeSchema, ownerSchema, sameOwner } from '../ledger/records.js';
import type { ObservationGap, RequestEvidence, RequestReading, RunOwner, RunRecord } from '../ledger/records.js';
import { probeProcess } from '../process/index.js';
import type { ProcessIdentity, ProcessReading } from '../process/index.js';

export interface OutcomeOptions extends LedgerOptions {
  readonly run: string;
  readonly owner: RunOwner;
  readonly outcome: RequestEvidence['state'];
  readonly evidence: string;
}
/** Caller-supplied evidence only. A process ending, or an old session, is not request evidence. */
export async function recordRequestOutcome(options: OutcomeOptions): Promise<RequestEvidence> {
  const home = ledgerHome(options);
  const ledger = await readLedger({ home });
  const run = ledger.runs.find(row => row.id === options.run);
  if (!run || run.machine !== ledger.machine || !sameOwner(run.owner, ownerSchema.parse(options.owner))) throw new Error('request outcome needs the registered owner on this machine');
  const outcome = outcomeSchema.parse({ run: run.id, state: options.outcome, evidence: options.evidence, at: new Date().toISOString() });
  await writeRecord(path.join(home, 'requests', `${randomUUID()}.json`), outcome);
  return outcome;
}
export interface ObservedRun {
  readonly run: RunRecord;
  readonly process: ProcessReading;
  readonly request: RequestReading;
}
export interface ObservationOptions extends LedgerOptions {
  readonly probe?: (identity: ProcessIdentity) => Promise<ProcessReading>;
}
export interface RunObservation {
  readonly machine: string;
  readonly runs: readonly ObservedRun[];
  readonly gaps: readonly ObservationGap[];
  readonly coverage: string;
}
export const LAUNCH_COVERAGE = 'Only runs launched through the owned launcher on this computer are tracked. Other launch paths and descendants not explicitly registered at launch are untracked; this is not a whole-machine census.';
/** Current OS facts beside immutable ownership; reads never prune, expire or infer a timeout. */
export async function observeRuns(options: ObservationOptions = {}): Promise<RunObservation> {
  const ledger = await readLedger(options);
  const runs = await Promise.all(ledger.runs.map(async (run): Promise<ObservedRun> => {
    let process: ProcessReading = run.birth;
    if (run.machine !== ledger.machine) process = { state: 'unknown', reason: 'record belongs to another machine' };
    else if (run.birth.state === 'live') {
      try { process = await (options.probe ?? probeProcess)(run.birth.identity); }
      catch (error) { process = { state: 'unknown', reason: `process probe failed: ${reason(error)}` }; }
    }
    const events = ledger.outcomes.filter(outcome => outcome.run === run.id).sort((a, b) => a.at.localeCompare(b.at));
    // A timeout is durable evidence about the request, even if the work later completes.
    const request = events.findLast(event => event.state === 'timed-out') ?? events.at(-1) ?? { state: 'unknown' as const };
    return { run, process, request };
  }));
  return { machine: ledger.machine, runs, gaps: ledger.gaps, coverage: LAUNCH_COVERAGE };
}
