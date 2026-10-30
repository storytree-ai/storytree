/**
 * Capability 3 · Data schema (the library story): every record has a declared type with a fixed
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

import { isTimeZone, parseSchedule, PRECHECKS } from "./schedule.js";

/** The declared record types. */
export type RecordType =
  | "arc"
  | "story"
  | "capability"
  | "contract"
  | "health"
  | "decision"
  | "decisionNumbering"
  | "anchor"
  | "prCutover"
  | "definition"
  | KnowledgeKind
  | "increment"
  | "question"
  | "feedback"
  | "fyi";

/**
 * Capability 6's kinds beyond decisions and definitions: ADR-0640's eight, each with 0.2's fields
 * (`packages/library/src/knowledge.ts` in storytree 0.2), ADR-0956 D3's quality control check and
 * ADR-1058's research and ADR-1064 D5's experiment, each with a title and a one-line description.
 */
export type KnowledgeKind =
  | "principle"
  | "guardrail"
  | "pattern"
  | "process"
  | "agent"
  | "friction"
  | "resteer"
  | "techstack"
  | "check"
  | "research"
  | "experiment";

/**
 * An increment's lifecycle, in the only order it moves (capability 10). Its ready step, between
 * proposal and active, is retired (ADR-0909 D4): an increment stored as ready is upgraded on read
 * to a proposal (./upgrades.ts).
 */
export const INCREMENT_STATUSES = ["proposal", "active", "closed"] as const;

/** A string that may not be empty: a title, a text, a term or a meaning. */
const nonEmpty = z.string().min(1);
/** A GitHub repository as owner/name. */
const repositoryName = z.string().regex(/^[\w.-]+\/[\w.-]+$/, "a repository is written owner/name");

/** Ids of other records. */
const ids = z.array(z.string());

/**
 * What an arc or an increment waits on (capability 11): each blocker, an arc for an arc and an
 * increment for an increment, with the reason. Absent means it waits on nothing.
 */
const waits = z.array(z.object({ on: z.string(), reason: nonEmpty }).strict()).optional();

/** A day, YYYY-MM-DD, that is a real day. */
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "a day is YYYY-MM-DD")
  .refine((text) => {
    // Zod still runs this after the pattern refuses, so text that is no date at all is refused here, not thrown on.
    const at = new Date(`${text}T00:00:00Z`);
    return !Number.isNaN(at.getTime()) && at.toISOString().startsWith(text);
  }, "a day is a real day");

/**
 * What an increment waits for outside the library (capability 11, ADR-0938 D1), at most one per
 * releaser: an action of the owner's, with no day, or an outside event, with the day to check back.
 */
const waitsFor = z
  .array(
    z
      .object({ releaser: z.enum(["owner", "event"]), note: nonEmpty, checkBack: day.optional() })
      .strict()
      .superRefine(({ releaser, checkBack }, context) => {
        if (releaser === "event" && checkBack === undefined) context.addIssue({ code: "custom", path: ["checkBack"], message: "an event wait needs a check-back day" });
        if (releaser === "owner" && checkBack !== undefined) context.addIssue({ code: "custom", path: ["checkBack"], message: "an owner wait takes no check-back day" });
      }),
  )
  .refine((list) => new Set(list.map(({ releaser }) => releaser)).size === list.length, "at most one wait per releaser")
  .optional();

/** One pending plan change on an increment (ADR-0966 D1): an edit with its before and after, or a retirement with its reason. */
const pendingHead = { record: nonEmpty, type: z.enum(["story", "capability", "contract"]), base: z.number().int().min(0) };
const pendingChange = z.union([
  z.object({ ...pendingHead, before: z.record(z.string(), z.unknown()), after: z.record(z.string(), z.unknown()) }).strict(),
  z.object({ ...pendingHead, retire: nonEmpty }).strict(),
]);

/**
 * A story's or capability's own guardrails (question_4cec0ba23052): extra checks only it carries, such
 * as a real-app run for a screen, each with what triggers it: any change to it, or a formal release.
 * Standard unit and integration tests are not listed. Optional, so no version bump.
 */
const guardrails = z.array(z.object({ check: nonEmpty, trigger: z.enum(["change", "release"]) }).strict()).optional();

/** Who a story reaches (question_1740edf77e9e): the owner alone, the invited users, or the public. */
export const RISK_AUDIENCES = ["owner", "invited", "public"] as const;

/** A change's risk tier (question_0f21964e8ce0), lowest first. */
export const RISK_TIERS = ["low", "medium", "high"] as const;

/** A reading's whole-number value from `min` to `max`. */
const scale = (min: number, max: number) => z.number().int().min(min).max(max);

/**
 * What every one of the eight kinds carries (6-a): a title, a one-line description, and links to
 * the other artifacts it relates to, as every artifact has.
 */
const knowledgeHead = { title: nonEmpty, description: nonEmpty, links: ids.optional() };

/**
 * Where a friction report stands (ADR-1016 D1): filed and not yet judged, judged with a remedy owed,
 * its remedy landed, or judged as needing nothing.
 */
export const FRICTION_STATES = ["open", "routed", "resolved", "dismissed"] as const;
/** Where a friction report stands. */
export type FrictionState = (typeof FRICTION_STATES)[number];

/**
 * The state a judgement leaves a friction report in (ADR-1016 D2): routed to nothing it is
 * dismissed; routed anywhere else it is resolved when it carries the reference that discharged it,
 * and routed, its remedy owed, when it does not.
 */
export function judgedState(route: string, dischargedBy: string | undefined): FrictionState {
  if (route === "nothing") return "dismissed";
  return dischargedBy === undefined ? "routed" : "resolved";
}

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
  // ADR-0662: a project setting kept in history and snapshots, not a knowledge artifact.
  decisionNumbering: z.object({ floor: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER) }).strict(),
  /**
   * The project's sentence (ADR-1085 D1), one per project at the work model's ANCHOR_ID: what it is, and who it
   * is for (its audience). Either half may be written first; the plan-health reading names a half not yet written.
   */
  anchor: z.object({ what: nonEmpty.optional(), audience: nonEmpty.optional() }).strict(),
  /**
   * The repository cut-over (increment_7f7599b35fe4), one per project at PR_CUTOVER_ID: pull request numbers
   * recorded before `at` are `before`'s, an owner/name, or no repository's when it was deleted (null); later ones
   * are `repository`'s, the one that took the name. With none, every number is the project's one repository's.
   */
  prCutover: z.object({ at: z.iso.datetime(), repository: repositoryName, before: repositoryName.nullable() }).strict(),
  /**
   * An arc, whole (capability 10): its intent and end state, required from version 2 (an older arc
   * is upgraded, ./upgrades.ts). Whether it is active or closed is worked out from its increments on
   * every read and never stored; only the owner's "parked" is (10-b), with, when given, the day it
   * wakes (10.6): from UTC midnight of `parkedUntil` it reads as if unparked, worked out on read.
   */
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
      // ADR-0963 D1: 1 first; an arc with none comes after every arc that has one. Optional, so no version bump.
      priority: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
      waits,
    })
    .strict(),
  story: z
    .object({
      title: nonEmpty,
      description: z.string().optional(),
      /** Its prose, as markdown, whole and in the order written (ADR-1050 D1). Optional, so no version bump. */
      text: z.string().optional(),
      /**
       * A mapped story (ADR-0993 D2): a package of an imported folder, written only by the work model's
       * mapStories. `from` is the import's key, `package` the package's folder relative to the imported
       * folder ("." for the folder itself), and `folders` the folders that hold its code. Optional, so no version bump.
       */
      mapped: z.object({ from: nonEmpty, package: nonEmpty, folders: z.array(nonEmpty) }).strict().optional(),
      /**
       * A plugin's story (ADR-1187): the factory plugin whose plan file is the one source of it, its
       * capabilities and its contracts, written only by the work model's importPluginPlan. Optional, so no version bump.
       */
      plugin: nonEmpty.optional(),
      /**
       * Its risk reading, set up front and read deterministically (question_1740edf77e9e): a blast depth
       * (1 to 3, how bad a fault in it is) and a blast radius (1 to 4, how far one reaches: the stories
       * downstream of it and the audience it serves, with the users that audience counts), each with the
       * day read and why. Optional, so no version bump.
       */
      risk: z
        .object({
          depth: z.object({ value: scale(1, 3), read: day, reason: nonEmpty }).strict(),
          radius: z
            .object({
              value: scale(1, 4),
              downstream: z.number().int().min(0),
              audience: z.enum(RISK_AUDIENCES),
              users: z.number().int().min(0).optional(),
              read: day,
              reason: nonEmpty,
            })
            .strict(),
        })
        .strict()
        .optional(),
      guardrails,
    })
    .strict(),
  /**
   * A capability. `proposed` is on until the agent says it is built (ADR-0744 D2), required from
   * version 2 (an older capability is upgraded, ./upgrades.ts, and reads proposed).
   */
  capability: z
    .object({
      title: nonEmpty,
      story: z.string(),
      description: z.string().optional(),
      /** Its prose, as markdown, whole and in the order written (ADR-1050 D1). Optional, so no version bump. */
      text: z.string().optional(),
      dependsOn: ids.optional(),
      proposed: z.boolean(),
      /**
       * An explored capability of a mapped story (ADR-0993 D5): the folders and files of its import it covers, each
       * relative to the imported folder, a folder covering everything under it; the work model checks the rest.
       * Optional, so no version bump.
       */
      covers: z.array(nonEmpty).min(1).optional(),
      guardrails,
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
      /**
       * The kind of skip that left the entry not checked (ADR-0825 D2): `owner`, `platform:<os>` or
       * `other`. Added on version 1, optional, so an older reader takes it as it is.
       */
      skip: z
        .string()
        .regex(/^(owner|other|platform:[a-z0-9]+)$/, 'a skip kind is "owner", "platform:<os>" or "other"')
        .optional(),
      /** The earlier verdict this entry did not reproduce, and when it was written: "not re-run". */
      was: z.enum(["passing", "failing"]).optional(),
      wasAt: z.string().optional(),
    })
    .strict(),
  /**
   * A decision, with the decision log's fields (capability 13): its `status`, required from version
   * 2 (an older decision is upgraded, ./upgrades.ts), set directly (13-a); its `number`, handed out
   * when it is recorded; the decisions it `supersedes`, never counted as support, which is what its
   * `links` mean (13-c); the load-bearing mark; who decided it, in their own words; and one
   * composed statement. Whether it is superseded is worked out on every read, never stored.
   */
  decision: z
    .object({
      title: nonEmpty,
      text: nonEmpty,
      links: ids.optional(),
      /** The one story or capability this decision is a front cover of (capability 9). */
      frontCoverOf: z.string().optional(),
      status: z.enum(["proposed", "accepted"]),
      number: z.number().int().positive().optional(),
      supersedes: ids.optional(),
      loadBearing: z.boolean().optional(),
      /** The day it was decided (YYYY-MM-DD). */
      decided: nonEmpty.optional(),
      /** Whose call it was (0.2's ADR-0519): a stamp claiming the owner quotes him, verbatim. */
      authority: z
        .object({
          basis: z.enum(["owner-directed", "owner-ratified", "agent-derived", "agent-flipped"]),
          scribedBy: nonEmpty,
          at: nonEmpty,
          ownerSaid: nonEmpty.optional(),
        })
        .strict()
        .optional(),
      /**
       * The one composed statement (the owner's C2; 0.2's ADR-0428): a maintained paragraph that
       * never replaces the text, with the fingerprint of the text it was composed against, so a
       * read can say when the text has changed since.
       */
      composed: z.object({ statement: nonEmpty, composedAt: nonEmpty, fingerprint: nonEmpty }).strict().optional(),
    })
    .strict()
    .superRefine((fields, context) => {
      const authority = fields.authority;
      if (authority !== undefined && authority.basis.startsWith("owner-") && authority.ownerSaid === undefined) {
        context.addIssue({
          code: "custom",
          path: ["authority"],
          message: `an "${authority.basis}" authority quotes the owner in "ownerSaid"; with no words of his to quote, the basis is "agent-derived"`,
        });
      }
    }),
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
      /** The artifacts this process hands on to, each with an optional one-line gloss. */
      branchEdges: z.array(z.object({ to: z.string(), label: nonEmpty.optional() }).strict()).optional(),
      /**
       * Set, this process is also a skill by this name, which `pnpm build:guidance` writes out as
       * SKILL.md for Claude Code and Codex. Added on version 1, optional, so an older reader takes
       * it as it is. The Agent Skills rule: lowercase letters, digits and single hyphens, 64 at most.
       */
      skill: z
        .string()
        .max(64)
        .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "a skill's name is lowercase letters, digits and single hyphens, such as grill-me")
        .optional(),
      /**
       * When it should run (ADR-1105), in words ./schedule.ts reads, such as "every 2 hours" or "daily at 09:15 and
       * 21:15". Absent, an agent runs it when its trigger applies. Optional, so no version bump.
       */
      schedule: nonEmpty
        .superRefine((text, context) => {
          const read = parseSchedule(text);
          if ("refused" in read) context.addIssue({ code: "custom", message: `field "schedule": ${read.refused}` });
        })
        .optional(),
      /** The IANA time zone the schedule's times are in; absent, the owner's (OWNER_TIME_ZONE). */
      timeZone: nonEmpty.refine(isTimeZone, 'field "timeZone" names no time zone this machine knows: it is an IANA name, such as Australia/Sydney').optional(),
      /** The cheap check its runner makes before starting a subagent, from the fixed list PRECHECKS; nothing to do, the run is recorded skipped. */
      precheck: z.enum(PRECHECKS).optional(),
    })
    .strict()
    .superRefine(({ schedule, timeZone, precheck }, context) => {
      if (timeZone !== undefined && schedule === undefined) context.addIssue({ code: "custom", path: ["timeZone"], message: 'field "timeZone" is for the times of a "schedule", and this process has none' });
      if (precheck !== undefined && schedule === undefined) context.addIssue({ code: "custom", path: ["precheck"], message: 'field "precheck" is checked before a scheduled run, and this process has no "schedule"' });
    }),
  /** An agent role. Its required reading (`context`), rules and anti-patterns are links to artifacts (6-a). */
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
      /** Workflow steps, each with the artifacts it reads just in time. */
      stepRefs: z.array(z.object({ step: nonEmpty, refs: ids }).strict()).optional(),
      model: z.enum(["inherit", "sonnet", "opus"]).optional(),
      /** How hard the role reasons: the levels Claude Code and Codex both accept. */
      effort: z.enum(["low", "medium", "high", "xhigh"]).optional(),
      aliases: z.array(nonEmpty).optional(),
    })
    .strict(),
  /**
   * What fought a session, with evidence (6-b). `route` and `routeReason` are set when it is
   * adjudicated, `reinforcedBy` logs each recurrence with its own evidence, and `dischargedBy` names
   * the remedy that landed. Its `state` (ADR-1016 D1) is moved only by the library's own verbs:
   * filing, routing, reinforcing and closing the increment that remedies it.
   */
  friction: z
    .object({
      ...knowledgeHead,
      statement: nonEmpty,
      evidence: nonEmpty,
      impact: nonEmpty,
      state: z.enum(FRICTION_STATES),
      route: z.enum(["adr", "tool", "principle", "guardrail", "process", "definition", "edit-existing", "nothing"]).optional(),
      routeReason: nonEmpty.optional(),
      provenance: provenance.optional(),
      reinforcedBy: z.array(z.object({ branch: nonEmpty, date: nonEmpty, evidence: nonEmpty }).strict()).optional(),
      dischargedBy: nonEmpty.optional(),
      /**
       * The session the friction drain handed it to, and until when (an ISO time): another session's
       * drain passes it over until then. Optional, so no version bump.
       */
      lease: z.object({ holder: nonEmpty, until: nonEmpty }).strict().optional(),
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
   * A quality control check (ADR-0956 D3): one question a reviewer answers yes or no about a finished
   * change, and the principles or guardrails it `enforces`, at least one, which keep the reason for
   * the rule; optionally how to answer it and examples. What has `graduated` to deterministic
   * checking (ADR-0956 D5) is each part with where it is now enforced, `whole` when the part is the whole check.
   * `projects` names the projects whose reviews ask it, when it applies in only those (a factory's check about its own
   * code); absent, every project that reads it asks it. Optional, so no version bump.
   */
  check: z
    .object({
      ...knowledgeHead,
      question: nonEmpty,
      enforces: ids.min(1),
      howToAnswer: nonEmpty.optional(),
      examples: nonEmpty.optional(),
      graduated: z.array(z.object({ part: nonEmpty, enforcedBy: nonEmpty, whole: z.literal(true).optional() }).strict()).optional(),
      projects: z.array(nonEmpty).min(1).optional(),
    })
    .strict(),
  /**
   * Research (ADR-1058 D1): what was looked at and found, with the day it was `researched` and its
   * `findings` as the body. It records no choice; a decision it informs links it.
   */
  research: z.object({ ...knowledgeHead, researched: day, findings: nonEmpty }).strict(),
  /**
   * An experiment written down before it runs (ADR-1064 D5): at least two `arms` of distinct names, each with the verbs
   * it `denies` by door when it denies any, its `hypotheses`, `measures`, what result counts as the variable helping,
   * not helping or inconclusive (`criteria`), its `budget` and `stopRules`. `frozen` is when it was frozen (an ISO 8601
   * timestamp); from then on only its `outcome`, which waits for the freeze, may change (Knowledge.editNote).
   */
  experiment: z
    .object({
      ...knowledgeHead,
      arms: z
        .array(
          z.object({
            name: nonEmpty,
            description: nonEmpty,
            denies: z.object({ tools: z.array(nonEmpty), commands: z.array(nonEmpty) }).strict().optional(),
          }).strict(),
        )
        .min(2)
        .refine((arms) => new Set(arms.map(({ name }) => name)).size === arms.length, "no two arms share a name"),
      hypotheses: z.array(nonEmpty).min(1),
      measures: z.array(nonEmpty).min(1),
      criteria: z.object({ helps: nonEmpty, noHelp: nonEmpty, inconclusive: nonEmpty }).strict(),
      budget: nonEmpty,
      stopRules: z.array(nonEmpty).min(1),
      frozen: z.iso.datetime().optional(),
      outcome: nonEmpty.optional(),
    })
    .strict()
    .superRefine((fields, context) => {
      if (fields.outcome !== undefined && fields.frozen === undefined) {
        context.addIssue({ code: "custom", path: ["outcome"], message: "an experiment's outcome is added only once it is frozen" });
      }
    }),
  /**
   * One increment of an arc's work (capability 10), from the moment it is decided until it closes;
   * closed, it is the arc's log entry. It names the `capabilities` it changes, the lock list a claim
   * on it lights (ADR-0949 D2), parked empty and filled by the session that claims it; it cites
   * anything else (stories, notes, decisions) through `links`, and the friction it `remedies`
   * (10-a). Version 3 retired `touches`, which held stories and capabilities alike. The planning
   * breakdown is written in `body`: 0.2's plan anchor did not last there and is not brought over
   * (ADR-0639 D4).
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
      capabilities: ids.optional(),
      links: ids.optional(),
      remedies: ids.optional(),
      waits,
      waitsFor,
      /**
       * The questions this work is held on (capability 12): a link, never a reading. Whether it is
       * waiting on the owner is worked out from each question's lifecycle, so settling one releases
       * the work with no write here, and the link stays as the record of what it waited on.
       */
      heldOn: ids.optional(),
      /**
       * The one machine that can take it (a machine's short name, as Machines names it); absent, any
       * machine can. Which names exist is Machines' to check. Optional, so no version bump.
       */
      machine: nonEmpty.optional(),
      /**
       * Its pending plan changes (ADR-0966 D1): edits and retirements of stories, capabilities and
       * contracts it did not plan, waiting for its branch to merge, each with the history entry
       * (`base`) it was read at. An edit keeps the changed fields' live values (`before`) and new ones
       * (`after`), null for a field absent. Optional, so no version bump.
       */
      pending: z.array(pendingChange).optional(),
      /**
       * The escape it fixes, a defect that reached main: the change that caused it (a pull request, as
       * `#123` or `123`, or an increment) and the story it hit, the link risk cut-offs and a likelihood
       * term are calibrated against (research_9860f6546277). Optional, so no version bump.
       */
      escape: z
        .object({ causedBy: z.string().regex(/^#?\d+$|^increment_/, "a pull request (#123) or an increment"), story: z.string() })
        .strict()
        .optional(),
      /**
       * Its risk line (question_0f21964e8ce0), read from the paths it changes: its tier, rating (2 x depth
       * + radius), the change's own depth and radius, the depth flags that raised it, the stories it
       * touches and the day read. Optional, so no version bump.
       */
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
  /**
   * A question for the owner, raised on an arc (capability 12), with 0.2's fields: why it matters,
   * the question, its context and options, and optionally an analogy, a diagram and a
   * recommendation. Settled, it keeps his answer, when, and the decision that carried it. Its
   * review lease (`verifiedAt`, `leaseDays`) is stored here and drained by the librarian (12-a).
   */
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
      lifecycle: z.enum(["open", "settled"]),
      answer: nonEmpty.optional(),
      /** When it was settled (an ISO 8601 timestamp). */
      settledAt: nonEmpty.optional(),
      /** The decision that carried the answer. */
      settledBy: z.string().optional(),
      /** When it was last checked to still hold (an ISO 8601 timestamp): first when it was raised. */
      verifiedAt: nonEmpty.optional(),
      /** How many days that check is trusted for. */
      leaseDays: z.number().int().positive().optional(),
      /**
       * The session putting it to the owner right now, and since when (12.10): two sessions never
       * ask him the same thing at once. Whether that session is still live is Session management's reading.
       */
      presenting: z.object({ session: nonEmpty, since: nonEmpty }).strict().optional(),
    })
    .strict()
    .superRefine((fields, context) => {
      const problem = (path: string[], message: string): void => context.addIssue({ code: "custom", path, message });
      if (fields.lifecycle === "settled") {
        if (fields.answer === undefined) problem(["answer"], 'a settled question needs field "answer": the owner\'s answer');
        if (fields.settledAt === undefined) problem(["settledAt"], 'a settled question needs field "settledAt": when it was settled');
        if (fields.presenting !== undefined) problem(["presenting"], "a settled question is no longer being put to the owner");
      } else {
        for (const field of ["answer", "settledAt", "settledBy"] as const) {
          if (fields[field] !== undefined) problem([field], `an open question has no "${field}" yet`);
        }
      }
    }),
  /**
   * A note the owner sent from the desktop app's feedback corner (Surface feedback, capability 3): what he wrote, the
   * named surface in front of him and the story that declares it, what he had selected and the project on show, the
   * app's version, the window's size and theme, and when. `anchor` is the element he pointed at (Surface feedback 2.2),
   * read from the page as he clicked it; notes sent before the picker have none. `screenshot` says whether a picture of
   * the window is kept beside it, and `crop` whether one cut to the element is too (Library API 7.18); the pictures'
   * bytes are never in the fields. `status` is new until the session
   * manager routes it (Surface feedback 4.2): then `route` says where it went, `routedTo` the increment or question it
   * went to, and `routeReason` why.
   */
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
  /**
   * Something the owner should know after the fact (ADR-1184 D3): a short `title` in plain words, `what` happened, `at`
   * when (an ISO 8601 timestamp), what it is `about` (a record's id, a file path or a pull request) and `by` whoever
   * noticed it (a session, a scheduled routine, the watcher). `heardAt` is when he heard it: absent, it is still to tell him.
   */
  fyi: z.object({ title: nonEmpty, what: nonEmpty, at: nonEmpty, about: nonEmpty, by: nonEmpty, heardAt: nonEmpty.optional() }).strict(),
} as const satisfies Record<RecordType, z.ZodType>;

/** The schema version of each type: every record of the type is written on it. */
export const SCHEMA_VERSIONS: Readonly<Record<RecordType, number>> = {
  arc: 2,
  story: 1,
  capability: 2,
  contract: 1,
  health: 1,
  decision: 2,
  decisionNumbering: 1,
  anchor: 1,
  prCutover: 1,
  definition: 1,
  principle: 1,
  guardrail: 1,
  pattern: 1,
  process: 1,
  agent: 1,
  friction: 2,
  resteer: 1,
  techstack: 1,
  check: 1,
  research: 1,
  experiment: 1,
  increment: 3,
  question: 1,
  feedback: 1,
  fyi: 1,
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
