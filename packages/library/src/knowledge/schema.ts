// Capability 33 · Knowledge
import { z } from "zod";

import { day, ids, nonEmpty } from "../records/rules/fields.js";
import { isTimeZone, parseSchedule, PRECHECKS } from "../records/rules/schedule.js";

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

export const KNOWLEDGE_RECORD_SCHEMAS = {
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
} as const;
