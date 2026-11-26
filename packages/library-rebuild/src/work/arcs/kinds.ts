// Capability 3 · Data schema
import { z } from "zod";

import { PLAN_PENDING_CHANGE } from "../../plan/kinds.js";

const day = z.iso.date();
const wait = z.object({ on: z.string().min(1), reason: z.string() }).strict();

const waitFor = z.object({
  releaser: z.enum(["owner", "event"]),
  note: z.string(),
  checkBack: day.optional(),
  why: z.string().optional(),
  rank: z.number().int().min(1).optional(),
  reviewed: z.union([day, z.iso.datetime()]).optional(),
  merged: z.number().int().optional(),
}).strict().superRefine((fields, context) => {
  if (fields.merged !== undefined && fields.releaser !== "owner") {
    context.addIssue({ code: "custom", path: ["merged"], message: "only an owner wait carries a merged pull request" });
  }
});

const escape = z.union([
  z.object({
    causedBy: z.string().regex(/^(#\d+|increment_\S+)$/, "a cause is a pull request (#123) or an increment"),
    commit: z.string().regex(/^[0-9a-f]{7,40}$/, "a commit is 7 to 40 hex digits").optional(),
    story: z.string(),
  }).strict(),
  z.literal("none"),
]);

const risk = z.object({
  tier: z.enum(["low", "medium", "high"]),
  rating: z.number().int().min(1).max(10),
  depth: z.number().int().min(1).max(3),
  radius: z.number().int().min(1).max(4),
  flags: z.array(z.string().min(1)),
  stories: z.array(z.string()),
  read: day,
}).strict();

export const ARC_KINDS = {
  arc: z.object({
    title: z.string().min(1),
    description: z.string().optional(),
    stories: z.array(z.string()).optional(),
    intent: z.string().min(1),
    endState: z.string().min(1),
    parked: z.literal(true).optional(),
    parkedUntil: day.optional(),
    priority: z.number().int().optional(),
    waits: z.array(wait).optional(),
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
    remedies: z.array(z.string()).optional(),
    waits: z.array(wait).optional(),
    waitsFor: z.array(waitFor).optional(),
    heldOn: z.array(z.string()).optional(),
    machine: z.string().min(1).optional(),
    pending: z.array(PLAN_PENDING_CHANGE).optional(),
    escape: escape.optional(),
    risk: risk.optional(),
    outcome: z.object({
      date: z.string(),
      pr: z.string().optional(),
      note: z.string().optional(),
      disposition: z.enum(["landed", "failed", "withdrawn"]),
    }).strict().optional(),
  }).strict(),
};

export const ARC_VERSIONS = { arc: 2, increment: 3 };

export const ARC_UPGRADES = [
  {
    type: "arc",
    from: 1,
    name: "intent-and-end-state",
    reads: ["title", "description", "intent", "endState"],
    up: (fields: Record<string, unknown>) => ({
      ...fields,
      intent: fields["intent"] ?? fields["description"] ?? fields["title"],
      endState: fields["endState"] ?? "Not written yet: edit the arc to say what done looks like",
    }),
  },
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
