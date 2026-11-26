// Capability 3 · Record rules
import { z } from "zod";

export const nonEmpty = z.string().min(1);

export const ids = z.array(z.string());

export const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "a day is YYYY-MM-DD")
  .refine((text) => {
    const at = new Date(`${text}T00:00:00Z`);
    return !Number.isNaN(at.getTime()) && at.toISOString().startsWith(text);
  }, "a day is a real day");

export const scale = (min: number, max: number) => z.number().int().min(min).max(max);
