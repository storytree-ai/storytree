// Capability 3 · Record rules
import { z } from "zod";

const common = {
  session: z.string().min(1),
  harness: z.string().min(1).optional(),
  source: z.enum(["hook", "tool"]),
  folder: z.string().min(1).optional(),
  branch: z.string().min(1).optional(),
  machine: z.string().min(1).optional(),
  transcript: z.string().min(1).optional(),
  causedBy: z.number().int().positive().optional(),
  experiment: z.string().min(1).optional(),
  arm: z.string().min(1).optional(),
};

const AGENT = z.union([
  z.literal("orchestrator"),
  z.literal("unknown"),
  z.object({ subagent: z.string().min(1), type: z.string().min(1).optional(), task: z.string().min(1).optional() }).strict(),
]);

export type Agent = z.infer<typeof AGENT>;

const noteRead = {
  note: z.string().min(1),
  found: z.enum(["search", "link", "id", "shelf"]),
  read: z.enum(["peek", "whole"]),
  agent: AGENT.optional(),
};

const part = { capability: z.string().min(1).optional(), increment: z.string().min(1).optional() };
const onePart = (line: { capability?: string | undefined; increment?: string | undefined }) => (line.capability === undefined) !== (line.increment === undefined);
const ONE_PART = { message: "a claim is on a capability or an increment, exactly one" };
const QUIET_BECAUSE = ["idle", "gone", "restart", "closed-out", "stopped"] as const;

export const NEW_LINE = z.discriminatedUnion("kind", [
  z.object({ ...common, kind: z.literal("session-started"), how: z.string().min(1).optional() }).strict(),
  z.object({ ...common, kind: z.literal("session-ended"), reason: z.string().min(1).optional() }).strict(),
  z.object({ ...common, kind: z.literal("subagent-started"), subagent: z.string().min(1), type: z.string().min(1).optional(), task: z.string().min(1).optional() }).strict(),
  z.object({ ...common, kind: z.literal("subagent-ended"), subagent: z.string().min(1) }).strict(),
  z.object({ ...common, kind: z.literal("file-edited"), files: z.array(z.string().min(1)).min(1) }).strict(),
  z.object({ ...common, kind: z.literal("command-started"), command: z.string(), call: z.string().min(1), limitMs: z.number().int().positive().optional() }).strict(),
  z.object({ ...common, kind: z.literal("command-run"), command: z.string(), call: z.string().min(1).optional() }).strict(),
  z.object({ ...common, kind: z.literal("prompt-submitted") }).strict(),
  z.object({ ...common, kind: z.literal("turn-ended"), background: z.number().int().nonnegative().optional(), exits: z.literal(true).optional() }).strict(),
  z.object({ ...common, kind: z.literal("closed-out"), safe: z.boolean(), why: z.string().min(1), running: z.number().int().nonnegative().optional() }).strict(),
  z.object({ ...common, kind: z.literal("session-named"), title: z.string().min(1) }).strict(),
  z.object({ ...common, kind: z.literal("pointed"), capability: z.string().min(1).optional(), gate: z.string().min(1).optional(), why: z.string().min(1).optional(), question: z.string().min(1).optional() }).strict(),
  z.object({ ...common, kind: z.literal("tool-requested"), tool: z.string().min(1), call: z.string().min(1), agent: AGENT }).strict(),
  z.object({ ...common, kind: z.literal("tool-called"), tool: z.string().min(1) }).strict(),
  z.object({ ...common, kind: z.literal("door-answered"), door: z.enum(["command", "tool"]), verb: z.string().min(1),
    outcome: z.enum(["answered", "unknown", "refused", "failed", "denied-by-arm"]), word: z.string().optional(), named: z.string().min(1).optional(),
    class: z.string().min(1).optional(), next: z.array(z.string().min(1)), pointedFrom: z.string().min(1).optional() }).strict(),
  z.object({ ...common, kind: z.literal("door-pointer"), where: z.string().min(1), word: z.string().min(1), to: z.string().min(1).optional(),
    others: z.array(z.string().min(1)), evidence: z.string().min(1) }).strict(),
  z.object({ ...common, kind: z.literal("door-checked"), since: z.string().datetime({ offset: true }), until: z.string().datetime({ offset: true }),
    filed: z.array(z.string().min(1)) }).strict(),
  z.object({ ...common, kind: z.literal("door-mounted"), verbs: z.array(z.string().min(1)).min(1) }).strict(),
  z.object({ ...common, kind: z.literal("process-ran"), process: z.string().min(1), outcome: z.enum(["ok", "concern", "failed", "missed", "skipped"]), note: z.string().min(1).optional() }).strict(),
  z.object({ ...common, kind: z.literal("note-read"), ...noteRead }).strict(),
  z.object({ ...common, kind: z.literal("outside-text-read"), what: z.string().min(1).max(300) }).strict(),
  z.object({ ...common, kind: z.literal("claimed"), ...part, reason: z.string().min(1), takenOverFrom: z.string().min(1).optional(),
    quietSince: z.string().datetime({ offset: true }).optional(), takenBecause: z.enum(QUIET_BECAUSE).optional(), file: z.string().min(1).optional(), under: z.string().min(1).optional() }).strict().refine(onePart, ONE_PART),
  z.object({ ...common, kind: z.literal("claim-refused"), ...part, holder: z.string().min(1), reason: z.string().min(1), file: z.string().min(1).optional(), under: z.string().min(1).optional() }).strict().refine(onePart, ONE_PART),
  z.object({ ...common, kind: z.literal("released"), ...part, holder: z.string().min(1).optional(), reason: z.string().min(1).optional() }).strict().refine(onePart, ONE_PART),
  z.object({ ...common, kind: z.literal("user-allowed"), increment: z.string().min(1), how: z.enum(["prompt", "command", "said"]),
    capabilities: z.array(z.object({ capability: z.string().min(1), covers: z.array(z.string().min(1)) }).strict()) }).strict(),
  z.object({ ...common, kind: z.literal("landed"), capability: z.string().min(1) }).strict(),
  z.object({ ...common, kind: z.literal("closed"), increment: z.string().min(1), disposition: z.enum(["landed", "failed", "withdrawn"]) }).strict(),
  z.object({ ...common, kind: z.literal("merged"), ...part, holder: z.string().min(1), branch: z.string().min(1), pr: z.number().int().positive() }).strict().refine(onePart, ONE_PART),
  z.object({ ...common, kind: z.literal("pr-red"), pr: z.number().int().positive(), increment: z.string().min(1), conflict: z.boolean(), checks: z.array(z.string().min(1)) }).strict(),
  z.object({ ...common, kind: z.literal("queue-red"), pr: z.number().int().positive(), increment: z.string().min(1), removedAt: z.string().datetime({ offset: true }),
    commit: z.string().min(1), checks: z.array(z.string().min(1)), tests: z.array(z.string().min(1)), outcome: z.enum(["real", "flake", "ahead", "unknown"]) }).strict(),
  z.object({ ...common, kind: z.literal("ci-rerun"), repo: z.string().min(1), run: z.number().int().positive(), attempt: z.number().int().min(2), what: z.enum(["main", "release", "pr"]) }).strict(),
  z.object({ ...common, kind: z.literal("lane-failed"), increment: z.string().min(1), why: z.string().min(1), logs: z.array(z.string().min(1)).min(1), lane: z.string().min(1).optional() }).strict(),
  z.object({ ...common, kind: z.literal("lane-reoffered"), increment: z.string().min(1), why: z.string().min(1), by: z.string().min(1).optional() }).strict(),
  z.object({ ...common, kind: z.literal("branch-state"), of: z.string().min(1), open: z.boolean(), how: z.enum(["merged", "not-ahead", "deleted", "ahead"]), pr: z.number().int().positive().optional(),
    draft: z.literal(true).optional(), checks: z.enum(["pending", "passing", "failing"]).optional(), queued: z.literal(true).optional(),
    checksSince: z.string().datetime({ offset: true }).optional(), queuedSince: z.string().datetime({ offset: true }).optional(), queueWaiting: z.literal(true).optional() }).strict(),
  z.object({ ...common, kind: z.literal("main-state"), of: z.string().min(1), dirty: z.boolean(), unborn: z.literal(true).optional() }).strict(),
  z.object({ ...common, kind: z.literal("session-archived"), of: z.string().min(1), app: z.enum(["claude-desktop", "codex"]) }).strict(),
  z.object({ ...common, kind: z.literal("session-unarchived"), of: z.string().min(1), app: z.enum(["claude-desktop", "codex"]) }).strict(),
  z.object({ ...common, kind: z.literal("machine-started"), machine: z.string().min(1), startedAt: z.string().datetime({ offset: true }) }).strict(),
  z.object({ ...common, kind: z.literal("session-described"), of: z.string().min(1), app: z.enum(["claude-desktop", "codex"]),
    title: z.string().min(1).optional(), status: z.string().min(1).optional() }).strict(),
  z.object({ ...common, kind: z.literal("hook-times"), readings: z.array(z.object({ at: z.string().datetime({ offset: true }), harness: z.string().min(1), event: z.string().min(1),
    total: z.number().nonnegative(), parts: z.object({ startup: z.number().nonnegative().optional(), connect: z.number().nonnegative().optional(),
      write: z.number().nonnegative().optional(), handoff: z.number().nonnegative().optional() }).strict() }).strict()).min(1).max(500) }).strict(),
  z.object({ ...common, kind: z.literal("usage-measured"),
    context: z.object({ tokens: z.number().int().nonnegative().optional(), window: z.number().int().positive(), percent: z.number().min(0).max(100).optional() }).strict(),
    rateLimits: z.array(z.object({ kind: z.string().min(1), percentUsed: z.number().nonnegative(), resetsAt: z.string().min(1).optional() }).strict()).max(20),
    cost: z.object({ usd: z.number().nonnegative() }).strict().optional() }).strict(),
  z.object({ ...common, kind: z.literal("turn-failed"), reason: z.enum(["error", "refusal"]), limits: z.array(z.string().min(1)).min(1).max(20).optional() }).strict(),
]);

export type NewLine = z.infer<typeof NEW_LINE>;
export type LineKind = NewLine["kind"];

export type Line = NewLine & {
  seq: number;
  project: string;
  at: string;
};

export interface LinesSince {
  lines: Line[];
  cursor: number;
}
