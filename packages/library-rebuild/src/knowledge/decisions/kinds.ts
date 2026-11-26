// Capability 3 · Data schema
import { z } from "zod";

const justification = z.string().refine(
  (text) => {
    const lines = text.split("\n");
    return lines.length <= 2 && lines.every((line) => line.trim() !== "" && line.length <= 200);
  },
  "a justification is at most two nonblank lines of at most 200 characters each",
);

const BASES = ["owner-directed", "owner-ratified", "agent-derived", "agent-flipped"] as const;

const authority = z.object({
  basis: z.enum([...BASES, "brought-across"]),
  scribedBy: z.string(),
  at: z.string(),
  ownerSaid: z.string().optional(),
  broughtFrom: z.object({ record: z.string(), basis: z.enum(BASES) }).strict().optional(),
}).strict().superRefine((stamp, ctx) => {
  if ((stamp.basis === "owner-directed" || stamp.basis === "owner-ratified") && stamp.ownerSaid === undefined) {
    ctx.addIssue({ code: "custom", message: `a decision stamped ${stamp.basis} quotes the owner: give ownerSaid, his own words` });
  }
  if (stamp.basis === "brought-across" && stamp.broughtFrom === undefined) {
    ctx.addIssue({ code: "custom", message: "a decision stamped brought-across points at its 0.2 record: give broughtFrom { record, basis }, the basis 0.2 gave" });
  }
});

export const DECISION_KINDS = {
  decision: z.object({
    title: z.string().min(1),
    text: z.string().min(1),
    links: z.array(z.string()).optional(),
    frontCoverOf: z.string().optional(),
    status: z.enum(["proposed", "accepted"]),
    number: z.number().int().optional(),
    supersedes: z.array(z.string()).optional(),
    supersedesClauses: z.array(z.object({ decision: z.string(), clauses: z.array(z.string().regex(/^D[1-9]\d*$/, "a clause is named D<n>")).optional() }).strict()).optional(),
    narrows: z.array(z.string()).optional(),
    justifications: z.record(z.string(), justification).optional(),
    loadBearing: z.boolean().optional(),
    authority: authority.optional(),
    composed: z.object({ statement: z.string(), composedAt: z.string(), fingerprint: z.string() }).strict().optional(),
  }).strict(),
  decisionNumbering: z.object({ floor: z.number() }).strict(),
};

export const DECISION_VERSIONS = { decision: 2 };

export const DECISION_UPGRADES = [
  {
    type: "decision",
    from: 1,
    name: "decision-carries-its-status",
    reads: ["status"],
    up: (fields: Record<string, unknown>) => ({ ...fields, status: fields["status"] ?? "accepted" }),
  },
];

export const DECISION_MARKED: readonly string[] = ["decision"];
