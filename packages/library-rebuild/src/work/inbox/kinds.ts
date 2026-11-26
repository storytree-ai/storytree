// Capability 12 · Owner questions
import { z } from "zod";

export const VERDICTS = ["match", "match-with-changes", "different", "rejected"] as const;

const verdict = z.enum(VERDICTS);

const prep = z.object({
  at: z.string(),
  stance: z.enum(["agrees", "differs", "retire"]),
  reason: z.string().optional(),
  editedAt: z.string().optional(),
}).strict().superRefine((fields, context) => {
  if (fields.stance !== "agrees" && (fields.reason ?? "").trim() === "") {
    context.addIssue({ code: "custom", path: ["reason"], message: `a stance that ${fields.stance === "retire" ? "proposes retire" : "differs"} says why` });
  }
});

export const INBOX_KINDS = {
  question: z.object({
    arc: z.string(),
    title: z.string().min(1),
    stakes: z.string(),
    statement: z.string(),
    context: z.string(),
    options: z.string(),
    analogy: z.string().optional(),
    diagram: z.string().optional(),
    recommendation: z.string().optional(),
    links: z.array(z.string()).optional(),
    unbuilt: z.array(z.string()).optional(),
    lifecycle: z.enum(["open", "settled"]),
    answer: z.string().optional(),
    settledAt: z.string().optional(),
    settledBy: z.string().optional(),
    verifiedAt: z.string().optional(),
    leaseDays: z.number().optional(),
    presenting: z.object({ session: z.string(), since: z.string() }).strict().optional(),
    prep: prep.optional(),
    score: z.object({
      prediction: verdict.optional(),
      recommendation: verdict.optional(),
      by: z.string(),
      at: z.string(),
    }).strict().optional(),
  }).strict(),
  prediction: z.object({
    question: z.string(),
    pick: z.union([z.number().int().min(1), z.enum(["retire", "defer"])]),
    confidence: z.enum(["low", "medium", "high"]),
    why: z.string(),
    at: z.string(),
  }).strict(),
  fyi: z.object({
    title: z.string().min(1),
    what: z.string(),
    at: z.string(),
    about: z.string(),
    by: z.string(),
    heardAt: z.string().optional(),
  }).strict(),
};
