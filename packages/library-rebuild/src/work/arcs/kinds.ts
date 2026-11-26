// Capability 3 · Data schema
import { z } from "zod";

export const ARC_KINDS = {
  arc: z.object({
    title: z.string().min(1),
    description: z.string().optional(),
    stories: z.array(z.string()).optional(),
    intent: z.string().min(1),
    endState: z.string().min(1),
    parked: z.literal(true).optional(),
  }).strict(),
  increment: z.object({
    arc: z.string(),
    title: z.string().min(1),
    objective: z.string(),
    body: z.string(),
    status: z.enum(["proposal", "active", "closed"]),
    parked: z.string().optional(),
    capabilities: z.array(z.string()).optional(),
    links: z.array(z.string()).optional(),
    outcome: z.object({
      date: z.string(),
      pr: z.string().optional(),
      note: z.string().optional(),
      disposition: z.enum(["landed", "failed", "withdrawn"]),
    }).strict().optional(),
  }).strict(),
};

export const ARC_VERSIONS = { increment: 3 };

export const ARC_UPGRADES = [
  {
    type: "increment",
    from: 1,
    name: "ready-becomes-proposal",
    reads: ["status"],
    up: (fields: Record<string, unknown>) => (fields["status"] === "ready" ? { ...fields, status: "proposal" } : fields),
  },
  {
    type: "increment",
    from: 2,
    name: "touches-split-into-capabilities-and-links",
    reads: ["touches", "capabilities", "links"],
    up: ({ touches, ...fields }: Record<string, unknown>) => {
      const touched = Array.isArray(touches) ? touches.map(String) : [];
      const capabilities = [...asList(fields["capabilities"]), ...touched.filter((id) => id.startsWith("capability_"))];
      const links = [...asList(fields["links"]), ...touched.filter((id) => !id.startsWith("capability_"))];
      return { ...fields, ...(capabilities.length === 0 ? {} : { capabilities }), ...(links.length === 0 ? {} : { links }) };
    },
  },
];

function asList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}
