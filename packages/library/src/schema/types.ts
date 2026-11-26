// Capability 3 · Record rules
import { z } from "zod";

import { PLAN_RECORD_SCHEMAS } from "../plan/schema.js";
import { WORK_RECORD_SCHEMAS } from "../work/schema.js";
import { KNOWLEDGE_RECORD_SCHEMAS } from "../knowledge/schema.js";
import { DECISION_RECORD_SCHEMAS } from "../knowledge/decisions/schema.js";

type ComposedType =
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

export { INCREMENT_STATUSES, RISK_TIERS, VERDICTS } from "../work/schema.js";

export { CONTRACT_PROOFS, FRESHNESS, PIN_ICONS, PIN_LABEL_LIMIT, RISK_AUDIENCES, STORE_LINK_DIRECTIONS } from "../plan/schema.js";

export { DRILL_FIXERS, DRILL_LAYERS, FRICTION_STATES, judgedState } from "../knowledge/schema.js";
export type { DrillLayer, FrictionState } from "../knowledge/schema.js";

export const RECORD_SCHEMAS = {
  decisionNumbering: DECISION_RECORD_SCHEMAS.decisionNumbering,
  anchor: PLAN_RECORD_SCHEMAS.anchor,
  prCutover: PLAN_RECORD_SCHEMAS.prCutover,
  arc: WORK_RECORD_SCHEMAS.arc,
  story: PLAN_RECORD_SCHEMAS.story,
  capability: PLAN_RECORD_SCHEMAS.capability,
  edge: PLAN_RECORD_SCHEMAS.edge,
  contract: PLAN_RECORD_SCHEMAS.contract,
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
  decision: DECISION_RECORD_SCHEMAS.decision,
  definition: KNOWLEDGE_RECORD_SCHEMAS.definition,
  principle: KNOWLEDGE_RECORD_SCHEMAS.principle,
  guardrail: KNOWLEDGE_RECORD_SCHEMAS.guardrail,
  pattern: KNOWLEDGE_RECORD_SCHEMAS.pattern,
  process: KNOWLEDGE_RECORD_SCHEMAS.process,
  agent: KNOWLEDGE_RECORD_SCHEMAS.agent,
  friction: KNOWLEDGE_RECORD_SCHEMAS.friction,
  resteer: KNOWLEDGE_RECORD_SCHEMAS.resteer,
  techstack: KNOWLEDGE_RECORD_SCHEMAS.techstack,
  check: KNOWLEDGE_RECORD_SCHEMAS.check,
  research: KNOWLEDGE_RECORD_SCHEMAS.research,
  experiment: KNOWLEDGE_RECORD_SCHEMAS.experiment,
  escape: KNOWLEDGE_RECORD_SCHEMAS.escape,
  drill: KNOWLEDGE_RECORD_SCHEMAS.drill,
  measure: KNOWLEDGE_RECORD_SCHEMAS.measure,
  increment: WORK_RECORD_SCHEMAS.increment,
  question: WORK_RECORD_SCHEMAS.question,
  prediction: WORK_RECORD_SCHEMAS.prediction,
  feedback: WORK_RECORD_SCHEMAS.feedback,
  fyi: WORK_RECORD_SCHEMAS.fyi,
  pin: PLAN_RECORD_SCHEMAS.pin,
} as const satisfies Record<ComposedType, z.ZodType>;

export const SCHEMA_VERSIONS: Readonly<Record<ComposedType, number>> = {
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

type Composed = typeof RECORD_SCHEMAS;

declare module "../records/rules/schema.js" {
  interface RecordSchemas extends Composed {}
}
