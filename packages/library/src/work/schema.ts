// Capability 32 · Work
import { z } from "zod";

import { day, ids, nonEmpty, scale } from "../records/rules/fields.js";

export const INCREMENT_STATUSES = ["proposal", "active", "closed"] as const;

const waits = z.array(z.object({ on: z.string(), reason: nonEmpty }).strict()).optional();

const waitsFor = z
  .array(
    z
      .object({
        releaser: z.enum(["owner", "event"]),
        note: nonEmpty,
        checkBack: day.optional(),
        why: nonEmpty.optional(),
        rank: z.number().int().min(1).optional(),
        reviewed: z.union([day, z.iso.datetime()]).optional(),
        merged: z.number().int().min(1).optional(),
      })
      .strict()
      .superRefine(({ releaser, checkBack, why, rank, reviewed, merged }, context) => {
        if (releaser === "event" && checkBack === undefined) context.addIssue({ code: "custom", path: ["checkBack"], message: "an event wait needs a check-back day" });
        if (releaser === "owner" && checkBack !== undefined) context.addIssue({ code: "custom", path: ["checkBack"], message: "an owner wait takes no check-back day" });
        if (releaser === "event" && (why !== undefined || rank !== undefined || reviewed !== undefined || merged !== undefined)) context.addIssue({ code: "custom", path: ["releaser"], message: "only an owner wait carries a why, a rank, a review day or a merged pull request" });
      }),
  )
  .refine((list) => new Set(list.map(({ releaser }) => releaser)).size === list.length, "at most one wait per releaser")
  .optional();

const pendingHead = { record: nonEmpty, type: z.enum(["story", "capability", "contract", "edge"]), base: z.number().int().min(0) };
const pendingChange = z.union([
  z.object({ ...pendingHead, before: z.record(z.string(), z.unknown()), after: z.record(z.string(), z.unknown()) }).strict(),
  z.object({ ...pendingHead, retire: nonEmpty }).strict(),
]);

export const RISK_TIERS = ["low", "medium", "high"] as const;

export const VERDICTS = ["match", "match-with-changes", "different", "rejected"] as const;

export const WORK_RECORD_SCHEMAS = {
  arc: z
    .object({
      title: nonEmpty,
      description: z.string().optional(),
      stories: ids.optional(),
      intent: nonEmpty,
      endState: nonEmpty,
      parked: z.literal(true).optional(),
      parkedUntil: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "a wake day is YYYY-MM-DD")
        .refine((day) => new Date(`${day}T00:00:00Z`).toISOString().startsWith(day), "a wake day is a real day")
        .optional(),
      priority: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
      waits,
    })
    .strict(),
  increment: z
    .object({
      arc: z.string(),
      title: nonEmpty,
      objective: nonEmpty,
      body: nonEmpty,
      status: z.enum(INCREMENT_STATUSES),
      parked: nonEmpty.optional(),
      capabilities: ids.optional(),
      links: ids.optional(),
      remedies: ids.optional(),
      waits,
      waitsFor,
      heldOn: ids.optional(),
      machine: nonEmpty.optional(),
      pending: z.array(pendingChange).optional(),
      escape: z
        .union([
          z
            .object({
              causedBy: z.string().regex(/^#?\d+$|^increment_/, "a pull request (#123) or an increment"),
              commit: z.string().regex(/^[0-9a-f]{7,40}$/, "a merge commit, 7 to 40 hex characters").optional(),
              story: z.string(),
            })
            .strict(),
          z.literal("none"),
        ])
        .optional(),
      risk: z
        .object({
          tier: z.enum(RISK_TIERS),
          rating: scale(3, 10),
          depth: scale(1, 3),
          radius: scale(1, 4),
          flags: z.array(nonEmpty),
          stories: ids,
          read: day,
        })
        .strict()
        .optional(),
      outcome: z
        .object({
          date: nonEmpty,
          pr: nonEmpty.optional(),
          note: nonEmpty.optional(),
          disposition: z.enum(["landed", "failed", "withdrawn"]),
        })
        .strict()
        .optional(),
    })
    .strict()
    .superRefine((fields, context) => {
      const problem = (path: string[], message: string): void => context.addIssue({ code: "custom", path, message });
      if (fields.status === "proposal" && fields.parked === undefined) {
        problem(["parked"], 'a proposal needs field "parked", the time it was parked');
      }
      if (fields.status === "closed" && fields.outcome === undefined) {
        problem(["outcome"], 'a closed increment needs field "outcome": how it closed');
      }
      if (fields.status !== "closed" && fields.outcome !== undefined) {
        problem(["outcome"], `an increment that is ${fields.status}, not closed, has no "outcome" yet`);
      }
      const outcome = fields.outcome;
      if (outcome !== undefined && outcome.pr === undefined && outcome.note === undefined && fields.parked !== undefined) {
        problem(["outcome"], 'a close with no pull request needs a "note" saying why it closed');
      }
    }),
  question: z
    .object({
      arc: z.string(),
      title: nonEmpty,
      stakes: nonEmpty,
      statement: nonEmpty,
      context: nonEmpty,
      options: nonEmpty,
      analogy: nonEmpty.optional(),
      diagram: nonEmpty.optional(),
      recommendation: nonEmpty.optional(),
      links: ids.optional(),
      unbuilt: ids.optional(),
      lifecycle: z.enum(["open", "settled"]),
      answer: nonEmpty.optional(),
      settledAt: nonEmpty.optional(),
      settledBy: z.string().optional(),
      verifiedAt: nonEmpty.optional(),
      leaseDays: z.number().int().positive().optional(),
      presenting: z.object({ session: nonEmpty, since: nonEmpty }).strict().optional(),
      prep: z
        .object({ at: nonEmpty, stance: z.enum(["agrees", "differs", "retire"]), reason: nonEmpty.optional(), editedAt: nonEmpty.optional() })
        .strict()
        .superRefine((prep, context) => {
          if (prep.stance !== "agrees" && prep.reason === undefined) {
            context.addIssue({ code: "custom", path: ["reason"], message: `a prep mark that ${prep.stance === "differs" ? "differs from the raiser" : "proposes retiring it"} needs field "reason": why` });
          }
        })
        .optional(),
      score: z.object({ prediction: z.enum(VERDICTS).optional(), recommendation: z.enum(VERDICTS).optional(), by: nonEmpty, at: nonEmpty }).strict().optional(),
    })
    .strict()
    .superRefine((fields, context) => {
      const problem = (path: string[], message: string): void => context.addIssue({ code: "custom", path, message });
      if (fields.lifecycle === "settled") {
        if (fields.answer === undefined) problem(["answer"], 'a settled question needs field "answer": the owner\'s answer');
        if (fields.settledAt === undefined) problem(["settledAt"], 'a settled question needs field "settledAt": when it was settled');
        if (fields.presenting !== undefined) problem(["presenting"], "a settled question is no longer being put to the owner");
      } else {
        for (const field of ["answer", "settledAt", "settledBy", "score", "unbuilt"] as const) {
          if (fields[field] !== undefined) problem([field], `an open question has no "${field}" yet`);
        }
      }
    }),
  prediction: z
    .object({
      question: z.string(),
      pick: z.union([z.number().int().positive(), z.enum(["retire", "defer"])]),
      confidence: z.enum(["high", "medium", "low"]),
      why: nonEmpty,
      at: nonEmpty,
    })
    .strict(),
  feedback: z
    .object({
      text: nonEmpty,
      surface: nonEmpty,
      story: nonEmpty.optional(),
      selection: nonEmpty.optional(),
      project: nonEmpty.optional(),
      version: nonEmpty,
      window: z.object({ width: z.number().int().nonnegative(), height: z.number().int().nonnegative() }).strict(),
      theme: z.enum(["light", "dark"]),
      at: nonEmpty,
      anchor: z
        .object({
          selector: nonEmpty,
          tag: nonEmpty,
          role: nonEmpty.optional(),
          name: nonEmpty.optional(),
          text: nonEmpty.optional(),
          marks: z.array(nonEmpty),
          components: z.array(nonEmpty).max(6),
          box: z.object({ x: z.number(), y: z.number(), width: z.number().nonnegative(), height: z.number().nonnegative() }).strict(),
          styles: z.record(z.string(), z.string()),
          html: z.string().max(2048),
          drawn: z
            .object({
              kind: z.enum(["gate", "capability", "island"]),
              story: nonEmpty,
              capability: nonEmpty.optional(),
              between: z.tuple([nonEmpty, nonEmpty]).optional(),
              name: nonEmpty,
              box: z.object({ x: z.number(), y: z.number(), width: z.number().nonnegative(), height: z.number().nonnegative() }).strict(),
            })
            .strict()
            .optional(),
        })
        .strict()
        .optional(),
      status: z.enum(["new", "routed"]),
      screenshot: z.boolean(),
      crop: z.boolean().optional(),
      route: z.enum(["increment", "question", "closed"]).optional(),
      routedTo: nonEmpty.optional(),
      routeReason: nonEmpty.optional(),
    })
    .strict()
    .superRefine((fields, context) => {
      const problem = (path: string[], message: string): void => context.addIssue({ code: "custom", path, message });
      if (fields.status === "routed") {
        if (fields.route === undefined) problem(["route"], 'a routed note needs field "route": increment, question or closed');
        if (fields.routeReason === undefined) problem(["routeReason"], 'a routed note needs field "routeReason": why it went there');
        if (fields.route !== "closed" && fields.routedTo === undefined) problem(["routedTo"], `a note routed to a${fields.route === "increment" ? "n" : ""} ${fields.route ?? "work"} needs field "routedTo": its id`);
      } else {
        for (const field of ["route", "routedTo", "routeReason"] as const) {
          if (fields[field] !== undefined) problem([field], `a new note has no "${field}" yet`);
        }
      }
    }),
  fyi: z.object({ title: nonEmpty, what: nonEmpty, at: nonEmpty, about: nonEmpty, by: nonEmpty, heardAt: nonEmpty.optional() }).strict(),
} as const;
