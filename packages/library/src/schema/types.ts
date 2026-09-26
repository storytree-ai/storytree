/**
 * Capability 3 · Data schema (stories/library.md): every record has a declared type with a fixed
 * set of fields, and is stamped with the schema version it was written on.
 *
 * This file declares the types, each at the version SCHEMA_VERSIONS gives it. It describes field SHAPES only: whether the id
 * in a `story`, `capability`, `node`, `stories`, `dependsOn`, `links` or `frontCoverOf` field (or
 * an agent role's `context`, `rules`, `antiPatterns` and `stepRefs`, or a process's `branchEdges`)
 * names a record that exists is for capabilities 4, 5, 6 and 9 to check.
 *
 * Changing a type so that a record written on the old one no longer fits it is a new version of
 * it: raise its number in SCHEMA_VERSIONS and add an upgrade step to UPGRADES (./upgrades.ts) for
 * the records written on the old one. A new optional field is not, since every record written
 * before it still fits: the decision's `frontCoverOf` (capability 9) was added that way, at
 * version 1.
 */
import { z } from "zod";

/** The declared record types. */
export type RecordType =
  | "arc"
  | "story"
  | "capability"
  | "contract"
  | "health"
  | "memory"
  | "decision"
  | "definition"
  | KnowledgeKind
  | "increment";

/**
 * Capability 6's eight kinds beyond memory notes, decisions and definitions (ADR-0640), each with
 * 0.2's fields (`packages/library/src/knowledge.ts` in storytree 0.2), a title and a one-line
 * description.
 */
export type KnowledgeKind =
  | "principle"
  | "guardrail"
  | "pattern"
  | "process"
  | "agent"
  | "friction"
  | "resteer"
  | "techstack";

/** An increment's lifecycle, in the only order it moves (capability 10). */
export const INCREMENT_STATUSES = ["proposal", "ready", "active", "closed"] as const;

/** A string that may not be empty: a title, a text, a term or a meaning. */
const nonEmpty = z.string().min(1);

/** Ids of other records. */
const ids = z.array(z.string());

/**
 * What an arc or an increment waits on (capability 11): each blocker, an arc for an arc and an
 * increment for an increment, with the reason. Absent means it waits on nothing.
 */
const waits = z.array(z.object({ on: z.string(), reason: nonEmpty }).strict()).optional();

/**
 * What every one of the eight kinds carries (6-a): a title, a one-line description, and links to
 * the other notes it relates to, as every note has.
 */
const knowledgeHead = { title: nonEmpty, description: nonEmpty, links: ids.optional() };

/** When and by which session a friction or a re-steer was filed, and by what: 0.2's capture provenance. */
const provenance = z
  .object({ branch: nonEmpty, date: nonEmpty, source: z.enum(["retro", "run-analysis"]) })
  .strict();

/**
 * A re-steer's failure mode: the fourteen modes of MAST ("Why Do Multi-Agent LLM Systems Fail?",
 * arXiv 2503.13657), 0.2's four storytree extensions, and the escape hatch for a failure neither
 * describes (0.2's ADR-0515).
 */
const RESTEER_MODES = [
  "disobey-task-specification",
  "disobey-role-specification",
  "step-repetition",
  "loss-of-conversation-history",
  "unaware-of-termination-conditions",
  "conversation-reset",
  "fail-to-ask-for-clarification",
  "task-derailment",
  "information-withholding",
  "ignored-other-agents-input",
  "reasoning-action-mismatch",
  "premature-termination",
  "no-or-incomplete-verification",
  "incorrect-verification",
  "tool-defect",
  "environment-defect",
  "missing-capability",
  "data-model-gap",
  "no-mast-home",
] as const;

/**
 * Each type's fields at the version SCHEMA_VERSIONS gives it (version 1 for all of them today).
 * Every object is `.strict()`, so a field it does not declare is refused rather than stored.
 */
export const RECORD_SCHEMAS = {
  /**
   * An arc, whole (capability 10): its intent and end state, required from version 2 (an older arc
   * is upgraded, ./upgrades.ts). Whether it is active or closed is worked out from its increments on
   * every read and never stored; only the owner's "parked" is (10-b).
   */
  arc: z
    .object({
      title: nonEmpty,
      description: z.string().optional(),
      stories: ids.optional(),
      intent: nonEmpty,
      endState: nonEmpty,
      parked: z.literal(true).optional(),
      waits,
    })
    .strict(),
  story: z
    .object({
      title: nonEmpty,
      description: z.string().optional(),
    })
    .strict(),
  capability: z
    .object({
      title: nonEmpty,
      story: z.string(),
      description: z.string().optional(),
      dependsOn: ids.optional(),
    })
    .strict(),
  contract: z
    .object({
      title: nonEmpty,
      capability: z.string(),
      description: z.string().optional(),
    })
    .strict(),
  health: z
    .object({
      node: z.string(),
      column: z.enum(["reported", "verified"]),
      state: z.enum(["passing", "failing", "not-checked"]),
      by: z.string().optional(),
      note: z.string().optional(),
    })
    .strict(),
  memory: z
    .object({
      text: nonEmpty,
      links: ids.optional(),
    })
    .strict(),
  decision: z
    .object({
      title: nonEmpty,
      text: nonEmpty,
      links: ids.optional(),
      /** The one story or capability this decision is a front cover of (capability 9). */
      frontCoverOf: z.string().optional(),
    })
    .strict(),
  definition: z
    .object({
      term: nonEmpty,
      meaning: nonEmpty,
      links: ids.optional(),
    })
    .strict(),
  principle: z
    .object({ ...knowledgeHead, statement: nonEmpty, why: nonEmpty, howToApply: nonEmpty })
    .strict(),
  guardrail: z
    .object({ ...knowledgeHead, statement: nonEmpty, rule: nonEmpty, enforcedBy: nonEmpty, failureMode: nonEmpty })
    .strict(),
  pattern: z
    .object({ ...knowledgeHead, statement: nonEmpty, problem: nonEmpty, approach: nonEmpty, tradeoffs: nonEmpty.optional() })
    .strict(),
  process: z
    .object({
      ...knowledgeHead,
      statement: nonEmpty,
      trigger: nonEmpty,
      steps: nonEmpty,
      surfaces: nonEmpty,
      failureModes: nonEmpty,
      verification: nonEmpty.optional(),
      /** The notes this process hands on to, each with an optional one-line gloss. */
      branchEdges: z.array(z.object({ to: z.string(), label: nonEmpty.optional() }).strict()).optional(),
    })
    .strict(),
  /** An agent role. Its required reading (`context`), rules and anti-patterns are links to notes (6-a). */
  agent: z
    .object({
      ...knowledgeHead,
      oneLine: nonEmpty,
      role: nonEmpty,
      outcome: nonEmpty,
      context: ids.min(1),
      tools: nonEmpty,
      workflow: nonEmpty,
      rules: ids.optional(),
      antiPatterns: ids.optional(),
      escalation: nonEmpty.optional(),
      /** Workflow steps, each with the notes it reads just in time. */
      stepRefs: z.array(z.object({ step: nonEmpty, refs: ids }).strict()).optional(),
      model: z.enum(["inherit", "sonnet", "opus"]).optional(),
      aliases: z.array(nonEmpty).optional(),
    })
    .strict(),
  /**
   * What fought a session, with evidence (6-b). `route` and `routeReason` are set when it is
   * adjudicated, `reinforcedBy` logs each recurrence with its own evidence, and `dischargedBy` names
   * the remedy that landed.
   */
  friction: z
    .object({
      ...knowledgeHead,
      statement: nonEmpty,
      evidence: nonEmpty,
      impact: nonEmpty,
      route: z.enum(["adr", "tool", "principle", "guardrail", "process", "definition", "edit-existing", "nothing"]).optional(),
      routeReason: nonEmpty.optional(),
      provenance: provenance.optional(),
      reinforcedBy: z.array(z.object({ branch: nonEmpty, date: nonEmpty, evidence: nonEmpty }).strict()).optional(),
      dischargedBy: nonEmpty.optional(),
    })
    .strict(),
  /**
   * One observed owner re-steer (6-b): what the session was doing, what he redirected it to, and his
   * own words as `evidence`, kept apart from the agent's `selfReport`. A defect carries its failure
   * mode; a matter of taste has none.
   */
  resteer: z
    .object({
      ...knowledgeHead,
      doing: nonEmpty,
      redirect: nonEmpty,
      evidence: nonEmpty,
      selfReport: nonEmpty.optional(),
      disposition: z.enum(["defect", "taste"]),
      dispositionBy: z.enum(["owner", "agent"]),
      mode: z.enum(RESTEER_MODES).optional(),
      provenance: provenance.optional(),
    })
    .strict()
    .superRefine((fields, context) => {
      if (fields.disposition === "defect" && fields.mode === undefined) {
        context.addIssue({
          code: "custom",
          path: ["mode"],
          message: 'a re-steer marked "defect" needs field "mode", its failure mode ("no-mast-home" when none describes it)',
        });
      }
    }),
  techstack: z
    .object({ ...knowledgeHead, statement: nonEmpty, whatItIs: nonEmpty, whyThis: nonEmpty, constraints: nonEmpty.optional() })
    .strict(),
  /**
   * One increment of an arc's work (capability 10), from the moment it is decided until it closes;
   * closed, it is the arc's log entry. It names the stories and capabilities it `touches` and the
   * friction it `remedies` (10-a). The planning breakdown is written in `body`: 0.2's plan anchor
   * did not last there and is not brought over (ADR-0639 D4).
   */
  increment: z
    .object({
      arc: z.string(),
      title: nonEmpty,
      objective: nonEmpty,
      body: nonEmpty,
      status: z.enum(INCREMENT_STATUSES),
      /** When it was parked as a proposal (an ISO 8601 timestamp); absent on one born closed. */
      parked: nonEmpty.optional(),
      touches: ids.optional(),
      remedies: ids.optional(),
      waits,
      /** How it closed: absent until it does. */
      outcome: z
        .object({
          /** The day it closed (YYYY-MM-DD). */
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
      // 0.2's rules across an increment's fields (assertIncrementInvariants, ADR-0305 and ADR-0322).
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
} as const satisfies Record<RecordType, z.ZodType>;

/** The schema version of each type: every record of the type is written on it. */
export const SCHEMA_VERSIONS: Readonly<Record<RecordType, number>> = {
  arc: 2,
  story: 1,
  capability: 1,
  contract: 1,
  health: 1,
  memory: 1,
  decision: 1,
  definition: 1,
  principle: 1,
  guardrail: 1,
  pattern: 1,
  process: 1,
  agent: 1,
  friction: 1,
  resteer: 1,
  techstack: 1,
  increment: 1,
};

/** The fields of a record of type `T`, as its schema declares them. */
export type FieldsOf<T extends RecordType> = z.infer<(typeof RECORD_SCHEMAS)[T]>;

/**
 * One step that brings a record of `type` from version `from` to `from + 1`: it takes the fields as
 * they were written on `from` and returns them as they are on `from + 1`. Pure: it returns new
 * fields and never changes the ones it is given.
 */
export interface UpgradeStep {
  readonly type: string;
  readonly from: number;
  /** A short, stable name for the change, for the error that says a step is missing. */
  readonly name: string;
  up(fields: Record<string, unknown>): Record<string, unknown>;
}

/**
 * A whole schema: each type's version, its fields at that version, and the steps that bring a
 * record written on an older version up to it. The library runs on LIBRARY_SCHEMA; a test can run
 * it on a later one, to see how records written today are read tomorrow.
 */
export interface LibrarySchema {
  readonly versions: Readonly<Record<string, number>>;
  readonly schemas: Readonly<Record<string, z.ZodType>>;
  readonly upgrades: readonly UpgradeStep[];
}
