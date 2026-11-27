// Capability 31 · Decisions
import { z } from "zod";

import { ids, nonEmpty } from "../../records/rules/fields.js";

const justification = z
  .string()
  .refine((text) => text.trim() !== "", "a justification is not blank")
  .refine((text) => text.split("\n").length <= 2, "a justification is at most two lines")
  .refine((text) => text.split("\n").every((line) => line.length <= 200), "each line of a justification is at most 200 characters");

const clause = z.string().regex(/^D\d+$/, "a clause is named D<n>");

export const DECISION_RECORD_SCHEMAS = {
  decisionNumbering: z.object({ floor: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER) }).strict(),
  decision: z
    .object({
      title: nonEmpty,
      text: nonEmpty,
      links: ids.optional(),
      frontCoverOf: z.string().optional(),
      status: z.enum(["proposed", "accepted"]),
      number: z.number().int().positive().optional(),
      supersedes: ids.optional(),
      supersedesClauses: z
        .array(z.object({ decision: z.string(), clauses: z.array(clause).min(1).optional() }).strict())
        .optional(),
      narrows: ids.optional(),
      justifications: z.record(z.string(), justification).optional(),
      archivedLinks: z
        .array(
          z
            .object({
              to: z.string(),
              field: z.enum(["links", "supersedes", "supersedesClauses"]),
              clauses: z.array(clause).min(1).optional(),
              justification: justification.optional(),
              reason: nonEmpty,
              by: nonEmpty,
              at: nonEmpty,
            })
            .strict(),
        )
        .optional(),
      loadBearing: z.boolean().optional(),
      decided: nonEmpty.optional(),
      authority: z
        .object({
          basis: z.enum(["owner-directed", "owner-ratified", "agent-derived", "agent-flipped", "brought-across"]),
          scribedBy: nonEmpty,
          at: nonEmpty,
          ownerSaid: nonEmpty.optional(),
          broughtFrom: z
            .object({ record: nonEmpty, basis: z.enum(["owner-directed", "owner-ratified", "agent-derived", "agent-flipped"]) })
            .strict()
            .optional(),
        })
        .strict()
        .optional(),
      composed: z.object({ statement: nonEmpty, composedAt: nonEmpty, fingerprint: nonEmpty }).strict().optional(),
    })
    .strict()
    .superRefine((fields, context) => {
      const authority = fields.authority;
      if (authority !== undefined && authority.basis.startsWith("owner-") && authority.ownerSaid === undefined) {
        context.addIssue({
          code: "custom",
          path: ["authority"],
          message: `an "${authority.basis}" authority quotes the owner in "ownerSaid"; with no words of his to quote, the basis is "agent-derived"`,
        });
      }
      if (authority?.basis === "brought-across" && authority.broughtFrom === undefined) {
        context.addIssue({
          code: "custom",
          path: ["authority"],
          message: `a "brought-across" authority points at its 0.2 record and the basis 0.2 gave in "broughtFrom"`,
        });
      }
    }),
} as const;

export const DECISION_SCHEMA_VERSIONS: Readonly<Record<keyof typeof DECISION_RECORD_SCHEMAS, number>> = {
  decision: 2,
  decisionNumbering: 1,
};
