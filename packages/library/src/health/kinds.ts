// Capability 3 · Data schema
import { z } from "zod";

export const HEALTH_KINDS = {
  health: z.object({
    node: z.string(),
    column: z.enum(["reported", "verified"]),
    state: z.enum(["passing", "failing", "not-checked"]),
    by: z.string().optional(),
    note: z.string().optional(),
    skip: z.string().regex(/^(owner|other|platform:.+)$/, "a skip is owner, other or platform:<os>").optional(),
    was: z.enum(["passing", "failing"]).optional(),
    wasAt: z.string().optional(),
    source: z.enum(["local", "ci"]).optional(),
    tests: z.array(z.string()).optional(),
    flaky: z.array(z.string()).optional(),
  }).strict(),
};
