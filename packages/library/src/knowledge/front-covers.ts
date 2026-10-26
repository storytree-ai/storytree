/**
 * Capability 9 · Knowledge entrances (the library story): every story and capability has its own shelf
 * of front-cover decisions, and a decision can be a front cover of one of them at most. Artifacts link
 * only to other artifacts, so the only way from the work into the knowledge is through a front cover.
 * A decision names the node it is a cover of in its one `frontCoverOf` field, so no decision can be
 * the cover of two, and nothing has to check for it.
 *
 * Knowledge (capability 6) and the decision log (capability 13) check every link and front cover
 * they write here, before the write; a broken one throws with nothing written.
 */
import { byCreation } from "../creation-order.js";
import { checkReference, type Expected } from "../references.js";
import type { SchemaRecord, SchemaRecords } from "../schema/index.js";
import type { RecordType } from "../schema/types.js";

/** What an artifact may link to: another artifact of `types`, never the work. */
export function artifactsOnly(types: readonly RecordType[]): Expected {
  return {
    name: "artifact",
    types,
    why: "artifacts link only to other artifacts: a story or capability is reached through its front covers, the decisions whose frontCoverOf names it",
  };
}

/** What a decision may be the front cover of. */
const COVERABLE: Expected = { name: "story or capability", types: ["story", "capability"] };

/** A decision may be the front cover of a live story or capability, and of nothing else. */
export function checkFrontCover(records: SchemaRecords, frontCoverOf: unknown): Promise<void> {
  return checkReference(records, "frontCoverOf", frontCoverOf, COVERABLE);
}

/**
 * A story's or capability's shelf: the live decisions whose `frontCoverOf` is `nodeId`, founding
 * (oldest) first, except a superseded one, which leaves its shelf for its successor (13-b) and is
 * still read with decision(). Empty for any other id.
 */
export async function frontCovers(records: SchemaRecords, nodeId: string): Promise<SchemaRecord<"decision">[]> {
  const decisions = await records.list("decision");
  const superseded = new Set(decisions.filter((decision) => decision.fields.status === "accepted").flatMap((decision) => decision.fields.supersedes ?? []));
  return decisions.filter((decision) => decision.fields.frontCoverOf === nodeId && !superseded.has(decision.id)).sort(byCreation);
}
