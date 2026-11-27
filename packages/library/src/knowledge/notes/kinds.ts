// Capability 3 · Data schema
import { z } from "zod";

import { knownTimeZone, parseSchedule, PRECHECKS } from "./schedule.js";

const artifact = {
  title: z.string().min(1),
  description: z.string(),
  links: z.array(z.string()).optional(),
};

const day = z.string().refine((text) => /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(text)) && new Date(text).toISOString().startsWith(text), "a day is written YYYY-MM-DD");

const provenance = z.object({ branch: z.string(), date: z.string(), source: z.enum(["retro", "run-analysis"]) }).strict();

const DRILL_LAYERS = ["test-writer", "builder", "lint", "tests", "mutation", "test-reviewer", "code-reviewer", "ci-linux", "ci-windows"] as const;

const FIXERS: Readonly<Record<string, string>> = {
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

const REVIEWERS: readonly string[] = ["test-reviewer", "code-reviewer"];

const MASTS = [
  "disobey-task-specification", "disobey-role-specification", "step-repetition", "loss-of-conversation-history", "unaware-of-termination-conditions",
  "conversation-reset", "fail-to-ask-for-clarification", "task-derailment", "information-withholding", "ignored-other-agents-input",
  "reasoning-action-mismatch", "premature-termination", "no-or-incomplete-verification", "incorrect-verification", "tool-defect",
  "environment-defect", "missing-capability", "data-model-gap", "no-mast-home",
] as const;

function refuse(ctx: z.RefinementCtx, field: string, message: string): void {
  ctx.addIssue({ code: "custom", path: [field], message, params: { reason: true } });
}

export function frictionState(fields: { readonly route?: unknown; readonly dischargedBy?: unknown }): "open" | "routed" | "resolved" | "dismissed" {
  if (fields.route === undefined) return "open";
  if (fields.route === "nothing") return "dismissed";
  return fields.dischargedBy === undefined ? "routed" : "resolved";
}

export const NOTE_KINDS = {
  definition: z.object({
    term: z.string().min(1),
    meaning: z.string().min(1),
    links: z.array(z.string()).optional(),
  }).strict(),
  principle: z.object({ ...artifact, statement: z.string(), why: z.string(), howToApply: z.string() }).strict(),
  guardrail: z.object({ ...artifact, statement: z.string(), rule: z.string(), enforcedBy: z.string(), failureMode: z.string() }).strict(),
  pattern: z.object({ ...artifact, statement: z.string(), problem: z.string(), approach: z.string(), tradeoffs: z.string().optional() }).strict(),
  process: z.object({
    ...artifact,
    statement: z.string(),
    trigger: z.string(),
    steps: z.string(),
    surfaces: z.string(),
    failureModes: z.string(),
    verification: z.string().optional(),
    branchEdges: z.array(z.object({ to: z.string(), label: z.string().optional() }).strict()).optional(),
    skill: z.string().optional(),
    schedule: z.string().optional(),
    timeZone: z.string().optional(),
    precheck: z.enum(PRECHECKS).optional(),
  }).strict().superRefine((process, ctx) => {
    if (process.schedule !== undefined) {
      const parsed = parseSchedule(process.schedule);
      if ("refused" in parsed) refuse(ctx, "schedule", parsed.refused);
    }
    if (process.timeZone !== undefined) {
      if (process.schedule === undefined) refuse(ctx, "timeZone", "a time zone is given only with a schedule");
      else if (!knownTimeZone(process.timeZone)) refuse(ctx, "timeZone", `${JSON.stringify(process.timeZone)} is not a known time zone`);
    }
    if (process.precheck !== undefined && process.schedule === undefined) refuse(ctx, "precheck", "a precheck is given only with a schedule");
  }),
  agent: z.object({
    ...artifact,
    oneLine: z.string(),
    role: z.string(),
    outcome: z.string(),
    context: z.array(z.string()),
    tools: z.string(),
    workflow: z.string(),
    rules: z.array(z.string()).optional(),
    antiPatterns: z.array(z.string()).optional(),
    escalation: z.string().optional(),
    stepRefs: z.array(z.object({ step: z.string(), refs: z.array(z.string()) }).strict()).optional(),
    model: z.enum(["inherit", "sonnet", "opus"]).optional(),
    effort: z.enum(["low", "medium", "high", "xhigh"]).optional(),
    aliases: z.array(z.string()).optional(),
  }).strict(),
  friction: z.object({
    ...artifact,
    statement: z.string().min(1),
    evidence: z.string().min(1),
    impact: z.string().min(1),
    state: z.enum(["open", "routed", "resolved", "dismissed"]),
    route: z.enum(["principle", "guardrail", "process", "definition", "nothing", "adr", "tool", "edit-existing"]).optional(),
    routeReason: z.string().optional(),
    provenance: provenance.optional(),
    reinforcedBy: z.array(z.object({ branch: z.string(), date: z.string(), evidence: z.string() }).strict()).optional(),
    dischargedBy: z.string().optional(),
    increment: z.string().optional(),
  }).strict(),
  resteer: z.object({
    ...artifact,
    doing: z.string().min(1),
    redirect: z.string().min(1),
    evidence: z.string().min(1),
    selfReport: z.string().optional(),
    disposition: z.enum(["defect", "taste"]),
    dispositionBy: z.enum(["agent", "owner"]),
    mode: z.enum(MASTS).optional(),
    provenance: provenance.optional(),
    increment: z.string().optional(),
  }).strict().superRefine((resteer, ctx) => {
    if (resteer.disposition === "defect" && resteer.mode === undefined) refuse(ctx, "mode", "a re-steer marked a defect names its failure mode");
  }),
  techstack: z.object({ ...artifact, statement: z.string(), whatItIs: z.string(), whyThis: z.string(), constraints: z.string().optional() }).strict(),
  check: z.object({
    ...artifact,
    question: z.string().min(1),
    enforces: z.array(z.string()).min(1),
    howToAnswer: z.string().optional(),
    examples: z.string().optional(),
    graduated: z.array(z.object({
      part: z.string(),
      enforcedBy: z.string(),
      whole: z.literal(true).optional(),
      trial: day.optional(),
      struck: day.optional(),
      arc: z.string().optional(),
    }).strict()).optional(),
    projects: z.array(z.string()).optional(),
  }).strict(),
  research: z.object({ ...artifact, researched: day, findings: z.string().min(1) }).strict(),
  experiment: z.object({
    ...artifact,
    arms: z.array(z.object({
      name: z.string(),
      description: z.string(),
      denies: z.object({ tools: z.array(z.string()), commands: z.array(z.string()) }).strict().optional(),
    }).strict()).min(2),
    hypotheses: z.array(z.string()).min(1),
    measures: z.array(z.string()),
    criteria: z.object({ helps: z.string(), noHelp: z.string(), inconclusive: z.string() }).strict(),
    budget: z.string(),
    stopRules: z.array(z.string()),
    frozen: z.iso.datetime().optional(),
    outcome: z.string().optional(),
  }).strict().superRefine((experiment, ctx) => {
    if (new Set(experiment.arms.map(({ name }) => name)).size !== experiment.arms.length) refuse(ctx, "arms", "no two arms share a name");
    if (experiment.outcome !== undefined && experiment.frozen === undefined) refuse(ctx, "outcome", "an outcome is added only once the experiment is frozen");
  }),
  escape: z.object({
    ...artifact,
    instance: z.object({
      run: z.number().optional(),
      pr: z.number().optional(),
      head: z.string().optional(),
      test: z.string().optional(),
      contract: z.string().optional(),
      story: z.string().optional(),
      capability: z.string().optional(),
      escape: z.string().optional(),
    }).strict(),
    caughtAt: z.enum(["escaped", "ci"]),
    reasoning: z.string().min(1),
    construct: z.string().optional(),
    elsewhere: z.string().optional(),
    generalises: z.enum(["local", "yes", "no"]).optional(),
    generalisesWhy: z.string().optional(),
    rung: z.enum(["lint", "none", "property", "fault-injection", "learned-break", "reviewer-check"]).optional(),
    rungWhy: z.string().min(1).optional(),
    defences: z.array(z.string()).optional(),
    plants: z.array(z.string()).optional(),
  }).strict().superRefine((escape, ctx) => {
    if (escape.caughtAt === "escaped" && escape.instance.escape === undefined) refuse(ctx, "instance", "an escaped pattern names the increment carrying its escape");
    if (escape.caughtAt === "ci" && escape.instance.run === undefined && escape.instance.pr === undefined) refuse(ctx, "instance", "a pattern CI caught names its run or pull request");
    if (escape.generalises !== undefined && !escape.generalisesWhy) refuse(ctx, "generalisesWhy", "a judgement carries its reason");
    if (escape.generalises === "yes" && (!escape.construct || !escape.elsewhere)) refuse(ctx, "generalises", "a pattern judged yes names its construct and the other places it is");
    if (escape.rung !== undefined && escape.generalises !== "yes") refuse(ctx, "rung", "a rung is chosen only on a pattern judged yes");
    else if (escape.rung !== undefined && !escape.rungWhy) refuse(ctx, "rungWhy", "a rung carries its reason");
    else if (escape.rung === undefined && escape.rungWhy !== undefined) refuse(ctx, "rung", "a reason carries its rung");
    else if (escape.rung !== undefined && escape.rung !== "none" && (escape.defences ?? []).length === 0) refuse(ctx, "defences", "a rung other than none names its defences");
  }),
  drill: z.object({
    title: z.string().min(1),
    description: z.string().min(1),
    links: z.array(z.string()).optional(),
    pattern: z.string(),
    plant: z.object({ story: z.string(), capability: z.string(), file: z.string().min(1), shape: z.string().min(1) }).strict(),
    mode: z.enum(["defect", "task"]),
    layers: z.array(z.object({ layer: z.enum(DRILL_LAYERS), result: z.enum(["caught", "missed", "not-run"]), evidence: z.string().min(1) }).strict()),
    caughtBy: z.enum([...DRILL_LAYERS, "none"]),
    fixer: z.enum(["test-writer", "builder", "watcher-fix-session", "escaped"]),
    sameModel: z.boolean().optional(),
    session: z.string().min(1),
    date: day,
  }).strict().superRefine((drill, ctx) => {
    const layers = drill.layers.map(({ layer }) => layer);
    const result = (layer: string) => drill.layers.find((row) => row.layer === layer)?.result;
    if (layers.length !== DRILL_LAYERS.length || layers.some((layer, at) => layer !== DRILL_LAYERS[at])) refuse(ctx, "layers", `a drill gives each layer's result once, in the order ${DRILL_LAYERS.join(", ")}`);
    else if (result("ci-windows") !== "not-run") refuse(ctx, "layers", "CI's Windows leg is not run in a drill");
    else if (drill.mode === "defect" && (result("test-writer") !== "not-run" || result("builder") !== "not-run")) refuse(ctx, "layers", "a planted defect skips the test writer and the builder");
    const first = drill.layers.find((row) => row.result === "caught")?.layer ?? "none";
    if (drill.caughtBy !== first) refuse(ctx, "caughtBy", `the first layer that caught it is ${first}`);
    if (drill.fixer !== FIXERS[drill.caughtBy]) refuse(ctx, "fixer", `a catch by ${drill.caughtBy} goes to ${FIXERS[drill.caughtBy]}`);
    if (REVIEWERS.includes(drill.caughtBy) !== (drill.sameModel !== undefined)) refuse(ctx, "sameModel", "a reviewer's catch, and only a reviewer's, says whether the reviewer was the planter's model");
  }),
  measure: z.object({
    ...artifact,
    story: z.string(),
    base: z.boolean().optional(),
    reads: z.string(),
    unit: z.string(),
    better: z.enum(["higher", "lower", "neither"]),
    howRead: z.string(),
    machine: z.string(),
    runs: z.number().int().min(1),
    version: z.number().int().min(1),
  }).strict(),
};

export const NOTE_VERSIONS = { friction: 2 };

export const NOTE_UPGRADES = [
  {
    type: "friction",
    from: 1,
    name: "friction-carries-its-state",
    reads: ["route", "dischargedBy"],
    up: (fields: Record<string, unknown>) => ({ ...fields, state: frictionState(fields) }),
  },
];

export const NOTE_REFUSALS: Readonly<Record<string, string>> = {
  memory: "memories belong to the harness, not the library (ADR-0650): keep what matters as an artifact of a proper kind",
};

export const NOTE_MARKED: readonly string[] = ["principle", "guardrail", "pattern", "process", "agent"];
