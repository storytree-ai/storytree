// Capability 3 · Data schema
import { z } from "zod";

import { isTimeZone, parseSchedule, PRECHECKS } from "./schedule.js";

export type RecordType =
  | "arc"
  | "story"
  | "capability"
  | "contract"
  | "edge"
  | "health"
  | "decision"
  | "decisionNumbering"
  | "anchor"
  | "prCutover"
  | "definition"
  | KnowledgeKind
  | "increment"
  | "question"
  | "prediction"
  | "feedback"
  | "fyi"
  | "pin";

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
  | "experiment"
  | "escape"
  | "drill"
  | "measure";

export const INCREMENT_STATUSES = ["proposal", "active", "closed"] as const;

const nonEmpty = z.string().min(1);
const repositoryName = z.string().regex(/^[\w.-]+\/[\w.-]+$/, "a repository is written owner/name");

const ids = z.array(z.string());

const justification = z
  .string()
  .refine((text) => text.trim() !== "", "a justification is not blank")
  .refine((text) => text.split("\n").length <= 2, "a justification is at most two lines")
  .refine((text) => text.split("\n").every((line) => line.length <= 200), "each line of a justification is at most 200 characters");

const clause = z.string().regex(/^D\d+$/, "a clause is named D<n>");

const waits = z.array(z.object({ on: z.string(), reason: nonEmpty }).strict()).optional();

export const DRILL_LAYERS = ["test-writer", "builder", "lint", "tests", "mutation", "test-reviewer", "code-reviewer", "ci-linux", "ci-windows"] as const;
export type DrillLayer = (typeof DRILL_LAYERS)[number];
export const DRILL_FIXERS: Readonly<Record<DrillLayer | "none", "test-writer" | "builder" | "watcher-fix-session" | "escaped">> = {
  "test-writer": "builder",
  builder: "builder",
  lint: "builder",
  tests: "builder",
  mutation: "test-writer",
  "test-reviewer": "test-writer",
  "code-reviewer": "builder",
  "ci-linux": "watcher-fix-session",
  "ci-windows": "watcher-fix-session",
  none: "escaped",
};

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "a day is YYYY-MM-DD")
  .refine((text) => {
    const at = new Date(`${text}T00:00:00Z`);
    return !Number.isNaN(at.getTime()) && at.toISOString().startsWith(text);
  }, "a day is a real day");

const waitsFor = z
  .array(
    z
      .object({
        releaser: z.enum(["owner", "event"]),
        note: nonEmpty,
        checkBack: day.optional(),
        why: nonEmpty.optional(),
        rank: z.number().int().min(1).optional(),
        reviewed: day.optional(),
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

const guardrails = z.array(z.object({ check: nonEmpty, trigger: z.enum(["change", "release"]) }).strict()).optional();

export const STORE_LINK_DIRECTIONS = ["read", "write", "both", "unknown"] as const;

const storeLink = z
  .object({ store: nonEmpty, table: nonEmpty, direction: z.enum(STORE_LINK_DIRECTIONS), cites: z.array(z.string().regex(/^\S.*:[1-9]\d*$/, "a cite is a file and its line, file:line")).min(1) })
  .strict();

export const PIN_ICONS = ["cache", "queue", "store", "api", "auth", "config", "job", "events", "search", "logging", "flag"] as const;

export const PIN_LABEL_LIMIT = 40;

export const CONTRACT_PROOFS = ["test-criterion", "agentic-user-acceptance-testing", "observability-as-proof"] as const;

export const FRESHNESS = /^([1-9]\d*)([hd])$/;

const contractProof = z.union([
  z.object({ by: z.enum(["test-criterion", "agentic-user-acceptance-testing"]), reason: nonEmpty }).strict(),
  z.object({ by: z.literal("observability-as-proof"), reason: nonEmpty, freshness: z.string().regex(FRESHNESS, "a whole number of hours or days, as 36h or 2d"), watcher: nonEmpty }).strict(),
]);

export const RISK_AUDIENCES = ["owner", "invited", "public"] as const;

export const RISK_TIERS = ["low", "medium", "high"] as const;

export const VERDICTS = ["match", "match-with-changes", "different", "rejected"] as const;

const scale = (min: number, max: number) => z.number().int().min(min).max(max);

const knowledgeHead = { title: nonEmpty, description: nonEmpty, links: ids.optional() };

export const FRICTION_STATES = ["open", "routed", "resolved", "dismissed"] as const;
export type FrictionState = (typeof FRICTION_STATES)[number];

export function judgedState(route: string, dischargedBy: string | undefined): FrictionState {
  if (route === "nothing") return "dismissed";
  return dischargedBy === undefined ? "routed" : "resolved";
}

const provenance = z
  .object({ branch: nonEmpty, date: nonEmpty, source: z.enum(["retro", "run-analysis"]) })
  .strict();

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

export const RECORD_SCHEMAS = {
  decisionNumbering: z.object({ floor: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER) }).strict(),
  anchor: z.object({ what: nonEmpty.optional(), audience: nonEmpty.optional() }).strict(),
  prCutover: z.object({ at: z.iso.datetime(), repository: repositoryName, before: repositoryName.nullable() }).strict(),
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
  story: z
    .object({
      title: nonEmpty,
      description: z.string().optional(),
      text: z.string().optional(),
      mapped: z.object({ from: nonEmpty, package: nonEmpty, folders: z.array(nonEmpty) }).strict().optional(),
      plugin: nonEmpty.optional(),
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
  capability: z
    .object({
      title: nonEmpty,
      story: z.string(),
      description: z.string().optional(),
      text: z.string().optional(),
      dependsOn: ids.optional(),
      proposed: z.boolean(),
      covers: z.array(nonEmpty).min(1).optional(),
      storeLinks: z.array(storeLink).min(1).optional(),
      guardrails,
    })
    .strict(),
  edge: z.object({ from: z.string(), to: z.string(), description: z.string().optional() }).strict(),
  contract: z
    .object({
      title: nonEmpty,
      capability: z.string().optional(),
      edge: z.string().optional(),
      description: z.string().optional(),
      provedBy: z.array(nonEmpty).min(1).optional(),
      proof: contractProof.optional(),
    })
    .strict()
    .superRefine((fields, context) => {
      if (fields.capability === undefined && fields.edge === undefined) {
        context.addIssue({ code: "custom", path: ["capability"], message: 'missing required field "capability"' });
      } else if (fields.capability !== undefined && fields.edge !== undefined) {
        context.addIssue({ code: "custom", path: ["edge"], message: 'a contract names "capability" or "edge", never both' });
      }
    }),
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
  decision: z
    .object({
      title: nonEmpty,
      text: nonEmpty,
      links: ids.optional(),
      frontCoverOf: z.string().optional(),
      status: z.enum(["proposed", "accepted"]),
      number: z.number().int().positive().optional(),
      supersedes: ids.optional(),
      supersedesClauses: z
        .array(z.object({ decision: z.string(), clauses: z.array(clause).min(1).optional() }).strict())
        .optional(),
      narrows: ids.optional(),
      justifications: z.record(z.string(), justification).optional(),
      archivedLinks: z
        .array(
          z
            .object({
              to: z.string(),
              field: z.enum(["links", "supersedes", "supersedesClauses"]),
              clauses: z.array(clause).min(1).optional(),
              justification: justification.optional(),
              reason: nonEmpty,
              by: nonEmpty,
              at: nonEmpty,
            })
            .strict(),
        )
        .optional(),
      loadBearing: z.boolean().optional(),
      decided: nonEmpty.optional(),
      authority: z
        .object({
          basis: z.enum(["owner-directed", "owner-ratified", "agent-derived", "agent-flipped", "brought-across"]),
          scribedBy: nonEmpty,
          at: nonEmpty,
          ownerSaid: nonEmpty.optional(),
          broughtFrom: z
            .object({ record: nonEmpty, basis: z.enum(["owner-directed", "owner-ratified", "agent-derived", "agent-flipped"]) })
            .strict()
            .optional(),
        })
        .strict()
        .optional(),
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
      if (authority?.basis === "brought-across" && authority.broughtFrom === undefined) {
        context.addIssue({
          code: "custom",
          path: ["authority"],
          message: `a "brought-across" authority points at its 0.2 record and the basis 0.2 gave in "broughtFrom"`,
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
      branchEdges: z.array(z.object({ to: z.string(), label: nonEmpty.optional() }).strict()).optional(),
      skill: z
        .string()
        .max(64)
        .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "a skill's name is lowercase letters, digits and single hyphens, such as grill-me")
        .optional(),
      schedule: nonEmpty
        .superRefine((text, context) => {
          const read = parseSchedule(text);
          if ("refused" in read) context.addIssue({ code: "custom", message: `field "schedule": ${read.refused}` });
        })
        .optional(),
      timeZone: nonEmpty.refine(isTimeZone, 'field "timeZone" names no time zone this machine knows: it is an IANA name, such as Australia/Sydney').optional(),
      precheck: z.enum(PRECHECKS).optional(),
    })
    .strict()
    .superRefine(({ schedule, timeZone, precheck }, context) => {
      if (timeZone !== undefined && schedule === undefined) context.addIssue({ code: "custom", path: ["timeZone"], message: 'field "timeZone" is for the times of a "schedule", and this process has none' });
      if (precheck !== undefined && schedule === undefined) context.addIssue({ code: "custom", path: ["precheck"], message: 'field "precheck" is checked before a scheduled run, and this process has no "schedule"' });
    }),
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
      stepRefs: z.array(z.object({ step: nonEmpty, refs: ids }).strict()).optional(),
      model: z.enum(["inherit", "sonnet", "opus"]).optional(),
      effort: z.enum(["low", "medium", "high", "xhigh"]).optional(),
      aliases: z.array(nonEmpty).optional(),
    })
    .strict(),
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
      increment: nonEmpty.optional(),
      from: z.object({ project: nonEmpty, increment: nonEmpty.optional() }).strict().optional(),
      lease: z.object({ holder: nonEmpty, until: nonEmpty }).strict().optional(),
      lookup: z.union([z.literal("none"), z.object({ shown: ids, noneMatch: z.boolean() }).strict()]).optional(),
    })
    .strict(),
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
      increment: nonEmpty.optional(),
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
  check: z
    .object({
      ...knowledgeHead,
      question: nonEmpty,
      enforces: ids.min(1),
      howToAnswer: nonEmpty.optional(),
      examples: nonEmpty.optional(),
      graduated: z
        .array(z.object({ part: nonEmpty, enforcedBy: nonEmpty, whole: z.literal(true).optional(), trial: day.optional(), struck: day.optional(), arc: nonEmpty.optional() }).strict())
        .optional(),
      projects: z.array(nonEmpty).min(1).optional(),
    })
    .strict(),
  research: z.object({ ...knowledgeHead, researched: day, findings: nonEmpty }).strict(),
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
  escape: z
    .object({
      ...knowledgeHead,
      instance: z
        .object({
          run: z.number().int().min(1).optional(),
          pr: z.number().int().min(1).optional(),
          head: z.string().regex(/^[0-9a-f]{7,40}$/, "a commit, 7 to 40 hex characters").optional(),
          test: nonEmpty.optional(),
          contract: nonEmpty.optional(),
          story: nonEmpty.optional(),
          capability: nonEmpty.optional(),
          escape: z.string().regex(/^increment_/, "the increment carrying the escape link").optional(),
        })
        .strict(),
      caughtAt: z.enum(["ci", "escaped"]),
      reasoning: nonEmpty,
      construct: nonEmpty.optional(),
      elsewhere: nonEmpty.optional(),
      generalises: z.enum(["yes", "no", "local"]).optional(),
      generalisesWhy: nonEmpty.optional(),
      rung: z.enum(["lint", "property", "fault-injection", "learned-break", "reviewer-check", "none"]).optional(),
      rungWhy: nonEmpty.optional(),
      defences: ids.optional(),
      plants: ids.optional(),
    })
    .strict()
    .superRefine((fields, context) => {
      if (fields.caughtAt === "escaped" && fields.instance.escape === undefined) {
        context.addIssue({ code: "custom", path: ["instance", "escape"], message: "an escaped pattern names the increment carrying its escape link" });
      }
      if (fields.caughtAt === "ci" && fields.instance.run === undefined && fields.instance.pr === undefined) {
        context.addIssue({ code: "custom", path: ["instance"], message: "a pattern CI caught names its run or its pull request" });
      }
      if ((fields.generalises === undefined) !== (fields.generalisesWhy === undefined)) {
        context.addIssue({ code: "custom", path: ["generalisesWhy"], message: 'whether a pattern generalises is judged with its reason: give "generalises" and "generalisesWhy" together' });
      }
      if (fields.generalises === "yes" && (fields.construct === undefined || fields.elsewhere === undefined)) {
        context.addIssue({ code: "custom", path: ["generalises"], message: 'a pattern that generalises names its "construct" and the other places it appears ("elsewhere")' });
      }
      if ((fields.rung === undefined) !== (fields.rungWhy === undefined)) {
        const missing = fields.rung === undefined ? "rung" : "rungWhy";
        context.addIssue({ code: "custom", path: [missing], message: 'a rung is chosen with its reason: give "rung" and "rungWhy" together' });
      }
      if (fields.rung !== undefined && fields.generalises !== "yes") {
        context.addIssue({ code: "custom", path: ["rung"], message: 'a rung is chosen only for a pattern judged to generalise ("generalises" yes)' });
      }
      if (fields.rung !== undefined && fields.rung !== "none" && (fields.defences === undefined || fields.defences.length === 0)) {
        context.addIssue({ code: "custom", path: ["defences"], message: 'a rung other than none names its "defences"' });
      }
    }),
  drill: z
    .object({
      ...knowledgeHead,
      pattern: nonEmpty,
      plant: z.object({ story: nonEmpty, capability: nonEmpty, file: nonEmpty, shape: nonEmpty }).strict(),
      mode: z.enum(["defect", "task"]),
      layers: z.array(z.object({ layer: z.enum(DRILL_LAYERS), result: z.enum(["caught", "missed", "not-run"]), evidence: nonEmpty }).strict()),
      caughtBy: z.enum([...DRILL_LAYERS, "none"]),
      fixer: z.enum(["test-writer", "builder", "watcher-fix-session", "escaped"]),
      sameModel: z.boolean().optional(),
      session: nonEmpty,
      date: day,
    })
    .strict()
    .superRefine((fields, context) => {
      const inOrder = fields.layers.length === DRILL_LAYERS.length && fields.layers.every((row, at) => row.layer === DRILL_LAYERS[at]);
      if (!inOrder) {
        context.addIssue({ code: "custom", path: ["layers"], message: `a drill gives each layer's result once, in the fixed order: ${DRILL_LAYERS.join(", ")}` });
      }
      const resultOf = (layer: DrillLayer) => fields.layers.find((row) => row.layer === layer)?.result;
      if (inOrder && resultOf("ci-windows") !== "not-run") {
        context.addIssue({ code: "custom", path: ["layers"], message: "CI's Windows leg is not run in a drill: its result is not-run" });
      }
      if (inOrder && fields.mode === "defect" && (resultOf("test-writer") !== "not-run" || resultOf("builder") !== "not-run")) {
        context.addIssue({ code: "custom", path: ["layers"], message: "a planted defect skips the test writer and the builder: their results are not-run" });
      }
      if (inOrder) {
        const first = fields.layers.find((row) => row.result === "caught")?.layer ?? "none";
        if (fields.caughtBy !== first) {
          context.addIssue({ code: "custom", path: ["caughtBy"], message: `the first layer that caught this drill is ${first}, not ${fields.caughtBy}` });
        }
      }
      const fixer = DRILL_FIXERS[fields.caughtBy];
      if (fields.fixer !== fixer) {
        context.addIssue({ code: "custom", path: ["fixer"], message: `a catch by ${fields.caughtBy} goes to ${fixer}, not ${fields.fixer}` });
      }
      const byReviewer = fields.caughtBy === "test-reviewer" || fields.caughtBy === "code-reviewer";
      if (byReviewer !== (fields.sameModel !== undefined)) {
        context.addIssue({
          code: "custom",
          path: ["sameModel"],
          message: byReviewer ? "a reviewer's catch says whether the reviewer was the planter's model (sameModel)" : "only a reviewer's catch carries sameModel",
        });
      }
    }),
  measure: z
    .object({
      ...knowledgeHead,
      story: nonEmpty,
      base: z.boolean().optional(),
      reads: nonEmpty,
      unit: nonEmpty,
      better: z.enum(["higher", "lower", "neither"]),
      howRead: nonEmpty,
      machine: nonEmpty,
      runs: z.number().int().min(1),
      version: z.number().int().min(1),
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
  pin: z
    .object({
      anchor: z.union([
        z.object({ capability: nonEmpty, part: nonEmpty.optional(), name: nonEmpty.optional() }).strict(),
        z.object({ store: nonEmpty, table: nonEmpty.optional() }).strict(),
      ]),
      icon: z.enum(PIN_ICONS),
      label: nonEmpty.max(PIN_LABEL_LIMIT),
      evidence: nonEmpty,
      commit: z.string().regex(/^[0-9a-f]{7,40}$/, "a commit is 7 to 40 hexadecimal characters"),
      at: nonEmpty,
    })
    .strict(),
} as const satisfies Record<RecordType, z.ZodType>;

export const SCHEMA_VERSIONS: Readonly<Record<RecordType, number>> = {
  arc: 2,
  story: 1,
  capability: 2,
  contract: 1,
  edge: 1,
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
  escape: 1,
  drill: 1,
  measure: 1,
  increment: 3,
  question: 1,
  prediction: 1,
  feedback: 1,
  fyi: 1,
  pin: 1,
};

export type FieldsOf<T extends RecordType> = z.infer<(typeof RECORD_SCHEMAS)[T]>;

export interface UpgradeStep {
  readonly type: string;
  readonly from: number;
  readonly name: string;
  readonly reads?: readonly string[];
  up(fields: Record<string, unknown>): Record<string, unknown>;
}

export interface LibrarySchema {
  readonly versions: Readonly<Record<string, number>>;
  readonly schemas: Readonly<Record<string, z.ZodType>>;
  readonly upgrades: readonly UpgradeStep[];
}
