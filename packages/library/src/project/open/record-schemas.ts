// Capability 1 · Opening a project
import type { z } from "zod";

import { withPluginKinds, type LibrarySchema, type PluginRecordKind } from "../../records/index.js";
import { PLAN_RECORD_SCHEMAS, PLAN_SCHEMA_VERSIONS } from "../../plan/schema.js";
import { WORK_RECORD_SCHEMAS, WORK_SCHEMA_VERSIONS } from "../../work/schema.js";
import { HEALTH_RECORD_SCHEMAS, HEALTH_SCHEMA_VERSIONS } from "../../health/schema.js";
import { KNOWLEDGE_RECORD_SCHEMAS, KNOWLEDGE_SCHEMA_VERSIONS, type KnowledgeKind } from "../../knowledge/schema.js";
import { DECISION_RECORD_SCHEMAS, DECISION_SCHEMA_VERSIONS } from "../../knowledge/decisions/schema.js";
import { UPGRADES } from "./upgrades.js";

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

export const RECORD_SCHEMAS = {
  decisionNumbering: DECISION_RECORD_SCHEMAS.decisionNumbering,
  anchor: PLAN_RECORD_SCHEMAS.anchor,
  prCutover: PLAN_RECORD_SCHEMAS.prCutover,
  arc: WORK_RECORD_SCHEMAS.arc,
  story: PLAN_RECORD_SCHEMAS.story,
  capability: PLAN_RECORD_SCHEMAS.capability,
  edge: PLAN_RECORD_SCHEMAS.edge,
  contract: PLAN_RECORD_SCHEMAS.contract,
  health: HEALTH_RECORD_SCHEMAS.health,
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
  arc: WORK_SCHEMA_VERSIONS.arc,
  story: PLAN_SCHEMA_VERSIONS.story,
  capability: PLAN_SCHEMA_VERSIONS.capability,
  contract: PLAN_SCHEMA_VERSIONS.contract,
  edge: PLAN_SCHEMA_VERSIONS.edge,
  health: HEALTH_SCHEMA_VERSIONS.health,
  decision: DECISION_SCHEMA_VERSIONS.decision,
  decisionNumbering: DECISION_SCHEMA_VERSIONS.decisionNumbering,
  anchor: PLAN_SCHEMA_VERSIONS.anchor,
  prCutover: PLAN_SCHEMA_VERSIONS.prCutover,
  definition: KNOWLEDGE_SCHEMA_VERSIONS.definition,
  principle: KNOWLEDGE_SCHEMA_VERSIONS.principle,
  guardrail: KNOWLEDGE_SCHEMA_VERSIONS.guardrail,
  pattern: KNOWLEDGE_SCHEMA_VERSIONS.pattern,
  process: KNOWLEDGE_SCHEMA_VERSIONS.process,
  agent: KNOWLEDGE_SCHEMA_VERSIONS.agent,
  friction: KNOWLEDGE_SCHEMA_VERSIONS.friction,
  resteer: KNOWLEDGE_SCHEMA_VERSIONS.resteer,
  techstack: KNOWLEDGE_SCHEMA_VERSIONS.techstack,
  check: KNOWLEDGE_SCHEMA_VERSIONS.check,
  research: KNOWLEDGE_SCHEMA_VERSIONS.research,
  experiment: KNOWLEDGE_SCHEMA_VERSIONS.experiment,
  escape: KNOWLEDGE_SCHEMA_VERSIONS.escape,
  drill: KNOWLEDGE_SCHEMA_VERSIONS.drill,
  measure: KNOWLEDGE_SCHEMA_VERSIONS.measure,
  increment: WORK_SCHEMA_VERSIONS.increment,
  question: WORK_SCHEMA_VERSIONS.question,
  prediction: WORK_SCHEMA_VERSIONS.prediction,
  feedback: WORK_SCHEMA_VERSIONS.feedback,
  fyi: WORK_SCHEMA_VERSIONS.fyi,
  pin: PLAN_SCHEMA_VERSIONS.pin,
};

type Composed = typeof RECORD_SCHEMAS;

declare module "../../records/rules/schema.js" {
  interface RecordSchemas extends Composed {}
}

export const LIBRARY_SCHEMA: LibrarySchema = { versions: SCHEMA_VERSIONS, schemas: RECORD_SCHEMAS, upgrades: UPGRADES };

export function pluginSchema(kinds: readonly PluginRecordKind[], base: LibrarySchema = LIBRARY_SCHEMA): LibrarySchema {
  return withPluginKinds(base, kinds);
}
