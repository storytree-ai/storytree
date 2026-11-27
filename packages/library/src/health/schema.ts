// Capability 5 · Health record
import { z } from "zod";

export const HEALTH_RECORD_SCHEMAS = {
  health: z
    .object({
      node: z.string(),
      column: z.enum(["reported", "verified"]),
      state: z.enum(["passing", "failing", "not-checked"]),
      by: z.string().optional(),
      note: z.string().optional(),
      skip: z
        .string()
        .regex(/^(owner|other|platform:[a-z0-9]+)$/, 'a skip kind is "owner", "platform:<os>" or "other"')
        .optional(),
      was: z.enum(["passing", "failing"]).optional(),
      wasAt: z.string().optional(),
      source: z.enum(["local", "ci"]).optional(),
      tests: z.array(z.string()).optional(),
      flaky: z.array(z.string()).optional(),
    })
    .strict(),
} as const;

export const HEALTH_SCHEMA_VERSIONS: Readonly<Record<keyof typeof HEALTH_RECORD_SCHEMAS, number>> = { health: 1 };
