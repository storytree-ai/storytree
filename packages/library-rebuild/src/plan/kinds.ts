// Capability 3 · Data schema
import { z } from "zod";

export const PLAN_KINDS = {
  story: z.object({
    title: z.string().min(1),
    description: z.string().optional(),
  }).strict(),
  capability: z.object({
    title: z.string().min(1),
    story: z.string(),
    description: z.string().optional(),
    dependsOn: z.array(z.string()).optional(),
    proposed: z.boolean(),
  }).strict(),
  contract: z.object({
    title: z.string().min(1),
    capability: z.string(),
    description: z.string().optional(),
  }).strict(),
};
