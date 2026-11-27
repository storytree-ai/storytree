// Capability 6 · Knowledge artifacts
import type { Reference } from "../../storage/rules/index.js";
import type { KnowledgeKind } from "../search/index.js";

export interface ArtifactKind {
  readonly captured?: { readonly command: string; readonly tool: string };
}

export const ARTIFACT_KINDS: Readonly<Record<KnowledgeKind, ArtifactKind>> = {
  principle: {},
  guardrail: {},
  pattern: {},
  process: {},
  agent: {},
  friction: { captured: { command: "storytree friction new", tool: "record_friction" } },
  resteer: { captured: { command: "storytree resteer new", tool: "record_resteer" } },
  techstack: {},
  check: {},
  research: {},
  experiment: {},
  escape: {},
  drill: {},
  measure: {},
};

export const NOTE_TYPES: readonly string[] = ["decision", "definition", ...Object.keys(ARTIFACT_KINDS)];

export class LinkLoopError extends Error {
  override readonly name = "LinkLoopError";
  readonly path: readonly string[];

  constructor(path: readonly string[]) {
    super(`a link would close a loop between artifacts: ${path.join(" → ")}; artifacts link without loops, so nothing was written`);
    this.path = path;
  }
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function referenceEdgesOf(fields: object): { field: string; to: string }[] {
  const shaped = fields as Record<string, unknown>;
  const edges = ["links", "context", "rules"].flatMap((field) => strings(shaped[field]).map((to) => ({ field, to })));
  const steps = Array.isArray(shaped["stepRefs"]) ? (shaped["stepRefs"] as { refs?: unknown }[]) : [];
  return [...edges, ...steps.flatMap((step) => strings(step.refs).map((to) => ({ field: "stepRefs", to })))];
}

export function referencesOf(type: string, fields: object): Reference[] {
  const shaped = fields as Record<string, unknown>;
  const references = strings(shaped["links"]).map((to) => ({ field: "links", to, expected: "artifact", kinds: NOTE_TYPES }));
  if (type === "check") references.push(...strings(shaped["enforces"]).map((to) => ({ field: "enforces", to, expected: "principle or guardrail", kinds: ["principle", "guardrail"] })));
  if (type === "drill" && typeof shaped["pattern"] === "string") references.push({ field: "pattern", to: shaped["pattern"], expected: "escape", kinds: ["escape"] });
  if (type === "measure" && typeof shaped["story"] === "string") references.push({ field: "story", to: shaped["story"], expected: "story", kinds: ["story"] });
  return references;
}

export function gained(references: readonly Reference[], before: readonly Reference[]): Reference[] {
  return references.filter((reference) => !before.some(({ field, to }) => field === reference.field && to === reference.to));
}

export async function checkLoops(id: string, fields: object, get: (id: string) => Promise<{ readonly type: string; readonly fields: object } | null>): Promise<void> {
  const seen = new Set<string>();
  const walk = async (path: readonly string[], targets: readonly string[]): Promise<void> => {
    for (const to of targets) {
      if (to === id) throw new LinkLoopError([...path, to]);
      if (seen.has(to)) continue;
      seen.add(to);
      const record = await get(to);
      if (record === null || !NOTE_TYPES.includes(record.type)) continue;
      await walk([...path, to], referenceEdgesOf(record.fields).map((edge) => edge.to));
    }
  };
  await walk([id], referenceEdgesOf(fields).map((edge) => edge.to));
}
