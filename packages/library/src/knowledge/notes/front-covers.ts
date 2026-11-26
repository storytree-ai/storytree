// Capability 6 · Notes
import { byCreation, type Expected, type RecordType, type SchemaRecord, type SchemaRecords } from "../../records/index.js";

export function artifactsOnly(types: readonly RecordType[]): Expected {
  return {
    name: "artifact",
    types,
    why: "artifacts link only to other artifacts: a story or capability is reached through its front covers, the decisions whose frontCoverOf names it",
  };
}

export async function frontCovers(records: SchemaRecords, nodeId: string): Promise<SchemaRecord<"decision">[]> {
  const decisions = await records.list("decision");
  const superseded = new Set(decisions.filter((decision) => decision.fields.status === "accepted").flatMap((decision) => decision.fields.supersedes ?? []));
  return decisions.filter((decision) => decision.fields.frontCoverOf === nodeId && !superseded.has(decision.id)).sort(byCreation);
}
