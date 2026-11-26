// Capability 3 · Data schema
import { z } from "zod";

export const HEALTH_KINDS = {
  health: z.object({
    node: z.string(),
    column: z.enum(["reported", "verified"]),
    state: z.enum(["passing", "failing", "not-checked"]),
    by: z.string().optional(),
    note: z.string().optional(),
  }).strict(),
};
