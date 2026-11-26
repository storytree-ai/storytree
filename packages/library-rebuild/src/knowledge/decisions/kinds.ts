// Capability 3 · Data schema
import { z } from "zod";

const justification = z.string().refine(
  (text) => {
    const lines = text.split("\n");
    return lines.length <= 2 && lines.every((line) => line.trim() !== "" && line.length <= 200);
  },
  "a justification is at most two nonblank lines of at most 200 characters each",
);

export const DECISION_KINDS = {
  decision: z.object({
    title: z.string().min(1),
    text: z.string().min(1),
    links: z.array(z.string()).optional(),
    frontCoverOf: z.string().optional(),
    status: z.enum(["proposed", "accepted"]),
    number: z.number().int().optional(),
    supersedes: z.array(z.string()).optional(),
    supersedesClauses: z.array(z.object({ decision: z.string(), clauses: z.array(z.string()).optional() }).strict()).optional(),
    narrows: z.array(z.string()).optional(),
    justifications: z.record(z.string(), justification).optional(),
    loadBearing: z.boolean().optional(),
  }).strict(),
};

export const DECISION_MARKED: readonly string[] = ["decision"];
