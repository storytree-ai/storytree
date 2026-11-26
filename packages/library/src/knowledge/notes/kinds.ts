// Capability 6 · Notes
import type { KnowledgeKind } from "../../schema/index.js";

export const ARTIFACT_KINDS: { readonly [K in KnowledgeKind]: { readonly name: string; readonly captured?: { readonly command: string; readonly tool: string } } } = {
  principle: { name: "Principle" },
  guardrail: { name: "Guardrail" },
  pattern: { name: "Pattern" },
  process: { name: "Process" },
  agent: { name: "Agent role" },
  friction: { name: "Friction", captured: { command: "storytree friction new", tool: "record_friction" } },
  resteer: { name: "Re-steer", captured: { command: "storytree resteer new", tool: "record_resteer" } },
  techstack: { name: "Tech stack" },
  check: { name: "Quality control check" },
  research: { name: "Research" },
  experiment: { name: "Experiment" },
  escape: { name: "Escape pattern" },
  drill: { name: "Red-team drill" },
  measure: { name: "Measure" },
};

export const WRITTEN_KINDS: readonly KnowledgeKind[] = (Object.keys(ARTIFACT_KINDS) as KnowledgeKind[]).filter((kind) => ARTIFACT_KINDS[kind].captured === undefined);
