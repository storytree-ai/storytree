// Capability 3 · Data schema
import { z } from "zod";

export const INBOX_KINDS = {
  question: z.object({
    arc: z.string(),
    title: z.string().min(1),
    stakes: z.string(),
    statement: z.string(),
    context: z.string(),
    options: z.string(),
    lifecycle: z.enum(["open", "settled"]),
    answer: z.string().optional(),
    settledAt: z.string().optional(),
  }).strict(),
};
