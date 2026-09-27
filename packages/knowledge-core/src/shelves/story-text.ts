/** Capability 1: imported story prose is library content, not knowledge drawn inside the globe. */
import type { RecordEnvelope } from "@storytree/library";

/** The stored story-text convention, shared by drawing and its evidence (ADR-0661 D3). */
export function isStoryText(record: RecordEnvelope): boolean {
  return record.type === "definition" && [record.fields.term, record.fields.title]
    .some(value => typeof value === "string" && value.startsWith("Story text: stories/"));
}
