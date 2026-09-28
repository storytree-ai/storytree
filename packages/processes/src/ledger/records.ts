import { z } from 'zod';

const text = z.string().trim().min(1);
const agent = z.union([z.literal('orchestrator'), z.literal('unknown'), z.object({
  subagent: text, type: text.optional(), task: text.optional(),
}).strict()]);
export const ownerSchema = z.object({
  session: text, harness: text.optional(), agent: agent.optional(), parentSession: text.optional(),
}).strict();
/** Already resolved caller identity. parentSession is an explicit delegation, never inferred. */
export type RunOwner = z.infer<typeof ownerSchema>;
/**
 * The agent link's tool call, as far as ownership reads it. Restated rather than imported: the agent
 * link depends on this package, and a dependency back would make a workspace cycle.
 */
export interface OwningCall {
  readonly caller: { readonly session: string; readonly harness?: string };
  readonly agent: RunOwner['agent'];
}
export function ownerFromCall(call: OwningCall): RunOwner {
  return ownerSchema.parse({ ...call.caller, agent: call.agent });
}
export function sameOwner(left: RunOwner, right: RunOwner): boolean {
  return left.session === right.session && left.harness === right.harness;
}

const identity = z.object({
  pid: z.number().int().positive(), platform: z.enum(['aix', 'android', 'darwin', 'freebsd', 'haiku', 'linux', 'openbsd', 'sunos', 'win32', 'cygwin', 'netbsd']),
  started: text, boot: text,
}).strict();
const birth = z.discriminatedUnion('state', [
  z.object({ state: z.literal('live'), identity }).strict(),
  z.object({ state: z.literal('gone') }).strict(),
  z.object({ state: z.literal('unknown'), reason: text }).strict(),
]);
export const runSchema = z.object({
  version: z.literal(1), id: z.uuid(), owner: ownerSchema, machine: text,
  project: text.optional(), command: text, args: z.array(z.string()), folder: text,
  startedAt: z.iso.datetime(), pid: z.number().int().positive(), birth,
  parentRun: z.uuid().optional(),
}).strict().refine(run => run.birth.state !== 'live' || run.pid === run.birth.identity.pid, 'birth identity must name the launched PID');
/** Immutable launch observation; birth is NOT the process's current state. */
export type RunRecord = z.infer<typeof runSchema>;
export const gapSchema = z.object({
  kind: z.enum(['registration', 'read', 'observation']), reason: text,
  path: text.optional(), run: text.optional(), pid: z.number().int().positive().optional(),
  at: z.iso.datetime().optional(),
}).strict();
export type ObservationGap = z.infer<typeof gapSchema>;
export const outcomeSchema = z.object({
  run: z.uuid(), state: z.enum(['timed-out', 'completed', 'cancelled']),
  at: z.iso.datetime(), evidence: text,
}).strict();
export type RequestEvidence = z.infer<typeof outcomeSchema>;
export type RequestReading = { state: 'unknown' } | RequestEvidence;
