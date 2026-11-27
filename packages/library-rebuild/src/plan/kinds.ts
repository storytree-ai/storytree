// Capability 3 · Data schema
import { z } from "zod";

const day = z.iso.date();
const why = z.string().min(1);
const guardrails = z.array(z.object({ check: z.string().min(1), trigger: z.enum(["change", "release"]) }).strict());
const planned = z.enum(["story", "capability", "contract", "edge"]);

export const STORE_LINK_DIRECTIONS = ["read", "write", "both", "unknown"] as const;

export const CONTRACT_PROOFS = ["test-criterion", "agentic-user-acceptance-testing", "observability-as-proof"] as const;

export const PIN_ICONS = ["store", "cache", "queue", "api", "auth", "config", "job", "events", "search", "logging", "flag"] as const;

export const PLAN_PENDING_CHANGE = z.union([
  z.object({ record: z.string(), type: planned, base: z.number().int(), before: z.record(z.string(), z.unknown()), after: z.record(z.string(), z.unknown()) }).strict(),
  z.object({ record: z.string(), type: planned, base: z.number().int(), retire: z.string() }).strict(),
]);

export type PendingPlanChange = z.infer<typeof PLAN_PENDING_CHANGE>;

export const PLAN_KINDS = {
  anchor: z.object({
    what: z.string().min(1).optional(),
    audience: z.string().min(1).optional(),
  }).strict(),
  prCutover: z.object({
    at: z.iso.datetime(),
    repository: z.string().min(1),
    before: z.string().min(1).nullable(),
  }).strict(),
  pin: z.object({
    anchor: z.union([
      z.object({ capability: z.string().min(1), part: z.string().min(1).optional(), name: z.string().min(1).optional() }).strict(),
      z.object({ store: z.string().min(1), table: z.string().min(1).optional() }).strict(),
    ]),
    icon: z.enum(PIN_ICONS),
    label: z.string().min(1).max(40),
    evidence: z.string().min(1),
    commit: z.string().regex(/^[0-9a-f]{7,40}$/),
    at: z.iso.datetime(),
  }).strict(),
  story: z.object({
    title: z.string().min(1),
    description: z.string().optional(),
    text: z.string().optional(),
    mapped: z.object({ from: z.string(), package: z.string(), folders: z.array(z.string()) }).strict().optional(),
    folders: z.array(z.string().min(1)).optional(),
    plugin: z.string().min(1).optional(),
    risk: z.object({
      depth: z.object({ value: z.number().int().min(1).max(3), read: day, reason: why }).strict(),
      radius: z.object({
        value: z.number().int().min(1).max(4),
        downstream: z.number().int().min(0),
        audience: z.enum(["owner", "invited", "public"]),
        users: z.number().int().min(0).optional(),
        read: day,
        reason: why,
      }).strict(),
    }).strict().optional(),
    guardrails: guardrails.optional(),
  }).strict(),
  capability: z.object({
    title: z.string().min(1),
    story: z.string(),
    description: z.string().optional(),
    text: z.string().optional(),
    dependsOn: z.array(z.string()).optional(),
    proposed: z.boolean(),
    parent: z.string().optional(),
    covers: z.array(z.string()).optional(),
    storeLinks: z.array(z.object({
      store: z.string().min(1),
      table: z.string().min(1),
      direction: z.enum(STORE_LINK_DIRECTIONS),
      cites: z.array(z.string().regex(/:\d+$/)).min(1),
    }).strict()).optional(),
    guardrails: guardrails.optional(),
  }).strict(),
  edge: z.object({
    from: z.string(),
    to: z.string(),
    description: z.string().optional(),
  }).strict(),
  contract: z.object({
    title: z.string().min(1),
    capability: z.string().optional(),
    edge: z.string().optional(),
    description: z.string().optional(),
    provedBy: z.array(z.string().min(1)).min(1).optional(),
    proof: z.union([
      z.object({ by: z.enum([CONTRACT_PROOFS[0], CONTRACT_PROOFS[1]]), reason: why }).strict(),
      z.object({ by: z.literal(CONTRACT_PROOFS[2]), reason: why, freshness: z.string().regex(/^[1-9]\d*[hd]$/), watcher: why }).strict(),
    ]).optional(),
  }).strict().superRefine((fields, context) => {
    if (fields.capability !== undefined && fields.edge !== undefined) {
      context.addIssue({ code: "custom", path: ["edge"], message: "a contract belongs to one capability or one edge, not both" });
    }
    if (fields.capability === undefined && fields.edge === undefined) {
      context.addIssue({ code: "custom", path: ["capability"], message: "a contract belongs to one capability or one edge" });
    }
  }),
};

export const PLAN_VERSIONS = { capability: 2 };

export const PLAN_UPGRADES = [
  {
    type: "capability",
    from: 1,
    name: "born-proposed",
    reads: ["proposed"],
    up: (fields: Record<string, unknown>) => ({ proposed: true, ...fields }),
  },
];
