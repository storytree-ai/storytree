/** Capability 3: one local inventory reading for the CLI, MCP and closing surfaces. */
import { ownerSchema, sameOwner } from '../ledger/records.js';
import type { RunOwner } from '../ledger/records.js';
import { observeRuns } from '../observation/observe.js';
import type { ObservationOptions, ObservedRun, RunObservation } from '../observation/observe.js';
import { readProcess } from '../process/index.js';
import type { ProcessIdentity } from '../process/index.js';
import { owns, refusal } from '../stopping/stop.js';

export interface StopAction {
  readonly command: string;
  readonly tool: string;
  readonly arguments: Record<string, unknown>;
}
export type StopOffer =
  | ({ readonly available: true; readonly reason?: never } & StopAction)
  | { readonly available: false; readonly reason: string };
export interface SharedWork {
  readonly name: string;
  readonly state: 'live' | 'gone' | 'unknown';
  /** The public lifecycle reading's limitations and how to manage this shared work. */
  readonly reason: string;
}
export interface InventoryOptions extends ObservationOptions {
  readonly scope?: 'self' | 'all';
  readonly owner?: RunOwner;
  readonly now?: Date;
  /** Supplied only by a surface with an installed stop entry point. It must revalidate on use. */
  readonly stopAction?: (run: string) => StopAction;
  /** Optional public lifecycle readings; never converted into owned runs or signal authority. */
  readonly shared?: readonly SharedWork[];
}
export interface InventoryRow extends ObservedRun {
  readonly ageMs: number;
  readonly ownership: 'self' | 'descendant' | 'other';
  readonly endedWithoutReport: boolean;
  readonly stop: StopOffer;
}
export interface Inventory {
  readonly machine: string;
  readonly scope: 'self' | 'all';
  readonly owner?: RunOwner;
  readonly observedAt: string;
  readonly rows: readonly InventoryRow[];
  readonly shared: readonly (SharedWork & { readonly stop: StopOffer })[];
  readonly gaps: RunObservation['gaps'];
  readonly coverage: string;
  /** Complete only for the stated scope/coverage, never a whole-computer idle assertion. */
  readonly complete: boolean;
}

export async function listRuns(options: InventoryOptions = {}): Promise<Inventory> {
  const scope = options.scope ?? 'self';
  const checked = ownerSchema.safeParse(options.owner);
  if (scope === 'self' && !checked.success) {
    throw new Error('storytree own needs a session identity from the calling harness; use storytree own --all for local attribution without a session.');
  }
  const owner = checked.success ? checked.data : undefined;
  if (scope === 'self' && owner?.agent === 'unknown') {
    throw new Error('storytree own cannot establish the calling agent identity; use storytree own --all for local attribution without stop authority.');
  }
  const observation = await observeRuns(options);
  const inspecting = await readProcess(process.pid);
  const now = options.now ?? new Date();
  const runs = observation.runs.map(row => row.run);
  const ledger = { machine: observation.machine, runs };
  const rows: InventoryRow[] = [];
  for (const row of observation.runs) {
    const { run } = row;
    // An old run at a reused PID is still a row. Only this exact lifetime is the inspector.
    if (run.machine === observation.machine && run.birth.state === 'live' && inspecting.state === 'live' &&
        sameIdentity(run.birth.identity, inspecting.identity)) continue;
    const ownership = owner === undefined || !owns(owner, run.owner, runs) ? 'other' :
      sameOwner(owner, run.owner) ? 'self' : 'descendant';
    if (scope === 'self' && ownership === 'other') continue;
    let stop: StopOffer;
    const refused = owner === undefined ? undefined : refusal(run, owner, ledger);
    if (run.machine !== observation.machine) stop = unavailable('Recorded on another computer; no local stop authority.');
    else if (owner === undefined) stop = unavailable('No caller session identity; all-session attribution grants no stop authority.');
    else if (ownership === 'other') stop = unavailable('Owned by another session or agent; ask that owner to stop it.');
    else if (refused) stop = unavailable(refused);
    else if (row.process.state === 'gone') stop = unavailable('This recorded lifetime is already gone.');
    else if (row.process.state === 'unknown') stop = unavailable(`Process identity is uncertain: ${row.process.reason}`);
    else if (options.stopAction === undefined) stop = unavailable('Stop action is not available on this surface.');
    else stop = { available: true, ...options.stopAction(run.id) };
    rows.push({ ...row, ownership, ageMs: Math.max(0, now.getTime() - Date.parse(run.startedAt)),
      endedWithoutReport: row.process.state === 'gone' && row.request.state === 'unknown', stop });
  }
  rows.sort((a, b) => a.run.startedAt.localeCompare(b.run.startedAt) || a.run.id.localeCompare(b.run.id));
  const shared = (options.shared ?? []).map(row => ({ ...row, stop: unavailable(row.reason) }));
  const supported = ['linux', 'darwin', 'win32'].includes(process.platform);
  const gaps = [...observation.gaps, ...(!supported ? [{ kind: 'observation' as const,
    reason: `Native process observation is unsupported on ${process.platform}.` }] : [])];
  return { machine: observation.machine, scope, ...(owner === undefined ? {} : { owner }), observedAt: now.toISOString(),
    rows, shared, gaps, coverage: observation.coverage,
    complete: gaps.length === 0 && rows.every(row => row.process.state !== 'unknown') && shared.every(row => row.state !== 'unknown') };
}

function unavailable(reason: string): StopOffer { return { available: false, reason }; }
function sameIdentity(a: ProcessIdentity, b: ProcessIdentity): boolean {
  return a.pid === b.pid && a.platform === b.platform && a.boot === b.boot && a.started === b.started;
}

/** Both front doors render the same reading; live work is a successful inventory result. */
export function renderInventory(inventory: Inventory): string {
  const scope = inventory.scope === 'all' ? 'all recorded sessions' : `session ${quoted(inventory.owner!.session)}`;
  const lines = [`Work on ${quoted(inventory.machine)} — ${scope}.`,
    inventory.complete ? 'Reading complete within the stated coverage.' : 'Reading incomplete: some work could not be observed.'];
  if (inventory.rows.length === 0) lines.push('No recorded runs in this scope.');
  for (const row of inventory.rows) {
    const { run } = row;
    const agent = typeof run.owner.agent === 'object' ? `; subagent ${quoted(run.owner.agent.subagent)}` : '';
    lines.push('', `${row.process.state.toUpperCase()} — run ${run.id}; PID ${run.pid}; age ${age(row.ageMs)}`,
      `  Owner: ${quoted(run.owner.session)} (${quoted(run.owner.harness ?? 'unspecified harness')})${agent}; machine ${quoted(run.machine)}`,
      `  Command: ${[run.command, ...run.args].map(quoted).join(' ')}`,
      `  Folder: ${quoted(run.folder)}; launched ${run.startedAt}`,
      `  Request: ${row.request.state}${row.endedWithoutReport ? '; ended without reporting back' : ''}`);
    if (run.owner.parentSession) lines.push(`  Parent session: ${quoted(run.owner.parentSession)}`);
    if (run.parentRun) lines.push(`  Parent run: ${run.parentRun}`);
    if (run.birth.state === 'live') lines.push(`  Lifetime: ${quoted(run.birth.identity.platform)} / ${quoted(run.birth.identity.boot)} / ${quoted(run.birth.identity.started)}`);
    if (row.process.state === 'unknown') lines.push(`  Could not observe: ${quoted(row.process.reason)}`);
    lines.push(row.stop.available ? `  Stop: ${row.stop.command}` : `  No stop action: ${quoted(row.stop.reason)}`);
  }
  for (const row of inventory.shared) lines.push('', `Shared — ${quoted(row.name)}: ${row.state}. ${row.reason}`);
  for (const gap of inventory.gaps) lines.push(`Gap (${gap.kind})${gap.path ? ` ${quoted(gap.path)}` : ''}: ${quoted(gap.reason)}`);
  lines.push('', inventory.coverage);
  return lines.join('\n');
}
function quoted(text: string): string { return JSON.stringify(text); }
function age(ms: number): string {
  const seconds = Math.floor(ms / 1_000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3_600)}h`;
}
