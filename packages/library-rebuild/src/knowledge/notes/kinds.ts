// Capability 3 · Data schema
import { z } from "zod";

const artifact = {
  title: z.string().min(1),
  description: z.string(),
  links: z.array(z.string()).optional(),
};

export const NOTE_KINDS = {
  definition: z.object({
    term: z.string().min(1),
    meaning: z.string().min(1),
    links: z.array(z.string()).optional(),
  }).strict(),
  check: z.object({
    question: z.string().min(1),
    enforces: z.array(z.string()),
    ...artifact,
  }).strict(),
  friction: z.object({
    statement: z.string().min(1),
    evidence: z.string().min(1),
    impact: z.string().min(1),
    state: z.enum(["open", "routed", "resolved", "dismissed"]),
    ...artifact,
  }).strict(),
  resteer: z.object({
    doing: z.string().min(1),
    redirect: z.string().min(1),
    evidence: z.string().min(1),
    disposition: z.enum(["defect", "taste"]),
    dispositionBy: z.enum(["agent", "owner"]),
    ...artifact,
  }).strict(),
};
