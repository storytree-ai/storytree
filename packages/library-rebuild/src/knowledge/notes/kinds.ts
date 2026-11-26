// Capability 3 · Data schema
import { z } from "zod";

export const NOTE_KINDS = {
  definition: z.object({
    term: z.string().min(1),
    meaning: z.string().min(1),
    links: z.array(z.string()).optional(),
  }).strict(),
};
