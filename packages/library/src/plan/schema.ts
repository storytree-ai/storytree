// Capability 4 · The plan
import { z } from "zod";

import { day, ids, nonEmpty, scale } from "../records/rules/fields.js";

const repositoryName = z.string().regex(/^[\w.-]+\/[\w.-]+$/, "a repository is written owner/name");

const guardrails = z.array(z.object({ check: nonEmpty, trigger: z.enum(["change", "release"]) }).strict()).optional();

export const STORE_LINK_DIRECTIONS = ["read", "write", "both", "unknown"] as const;

const storeLink = z
  .object({ store: nonEmpty, table: nonEmpty, direction: z.enum(STORE_LINK_DIRECTIONS), cites: z.array(z.string().regex(/^\S.*:[1-9]\d*$/, "a cite is a file and its line, file:line")).min(1) })
  .strict();

export const PIN_ICONS = ["cache", "queue", "store", "api", "auth", "config", "job", "events", "search", "logging", "flag"] as const;

export const PIN_LABEL_LIMIT = 40;

export const CONTRACT_PROOFS = ["test-criterion", "agentic-user-acceptance-testing", "observability-as-proof"] as const;

export const FRESHNESS = /^([1-9]\d*)([hd])$/;

const contractProof = z.union([
  z.object({ by: z.enum(["test-criterion", "agentic-user-acceptance-testing"]), reason: nonEmpty }).strict(),
  z.object({ by: z.literal("observability-as-proof"), reason: nonEmpty, freshness: z.string().regex(FRESHNESS, "a whole number of hours or days, as 36h or 2d"), watcher: nonEmpty }).strict(),
]);

export const RISK_AUDIENCES = ["owner", "invited", "public"] as const;

export const PLAN_RECORD_SCHEMAS = {
  anchor: z.object({ what: nonEmpty.optional(), audience: nonEmpty.optional() }).strict(),
  prCutover: z.object({ at: z.iso.datetime(), repository: repositoryName, before: repositoryName.nullable() }).strict(),
  story: z
    .object({
      title: nonEmpty,
      description: z.string().optional(),
      text: z.string().optional(),
      mapped: z.object({ from: nonEmpty, package: nonEmpty, folders: z.array(nonEmpty) }).strict().optional(),
      folders: z.array(nonEmpty).optional(),
      plugin: nonEmpty.optional(),
      risk: z
        .object({
          depth: z.object({ value: scale(1, 3), read: day, reason: nonEmpty }).strict(),
          radius: z
            .object({
              value: scale(1, 4),
              downstream: z.number().int().min(0),
              audience: z.enum(RISK_AUDIENCES),
              users: z.number().int().min(0).optional(),
              read: day,
              reason: nonEmpty,
            })
            .strict(),
        })
        .strict()
        .optional(),
      guardrails,
    })
    .strict(),
  capability: z
    .object({
      title: nonEmpty,
      story: z.string(),
      description: z.string().optional(),
      text: z.string().optional(),
      dependsOn: ids.optional(),
      proposed: z.boolean(),
      parent: nonEmpty.optional(),
      covers: z.array(nonEmpty).min(1).optional(),
      storeLinks: z.array(storeLink).min(1).optional(),
      guardrails,
    })
    .strict(),
  edge: z.object({ from: z.string(), to: z.string(), description: z.string().optional() }).strict(),
  contract: z
    .object({
      title: nonEmpty,
      capability: z.string().optional(),
      edge: z.string().optional(),
      description: z.string().optional(),
      provedBy: z.array(nonEmpty).min(1).optional(),
      proof: contractProof.optional(),
    })
    .strict()
    .superRefine((fields, context) => {
      if (fields.capability === undefined && fields.edge === undefined) {
        context.addIssue({ code: "custom", path: ["capability"], message: 'missing required field "capability"' });
      } else if (fields.capability !== undefined && fields.edge !== undefined) {
        context.addIssue({ code: "custom", path: ["edge"], message: 'a contract names "capability" or "edge", never both' });
      }
    }),
  pin: z
    .object({
      anchor: z.union([
        z.object({ capability: nonEmpty, part: nonEmpty.optional(), name: nonEmpty.optional() }).strict(),
        z.object({ store: nonEmpty, table: nonEmpty.optional() }).strict(),
      ]),
      icon: z.enum(PIN_ICONS),
      label: nonEmpty.max(PIN_LABEL_LIMIT),
      evidence: nonEmpty,
      commit: z.string().regex(/^[0-9a-f]{7,40}$/, "a commit is 7 to 40 hexadecimal characters"),
      at: nonEmpty,
    })
    .strict(),
} as const;
