/** ADR-0650's one-time conversion. Called under the schema and writer locks on project open. */
import type { PoolClient } from "pg";

import { RECORD_SCHEMAS, SCHEMA_VERSIONS } from "../schema/types.js";
import type { NoteType } from "../knowledge/knowledge.js";
import { KNOWLEDGE_KINDS } from "../knowledge/knowledge.js";
import type { RecordEnvelope } from "../transactions/types.js";

const KINDS: readonly string[] = ["decision", "definition", ...KNOWLEDGE_KINDS];

/** Unclassified records stay intact, and are reported on every open until resolved. */
export async function upgradeMemories(client: PoolClient, project: string): Promise<string[]> {
  const { convertible, warnings } = await pendingMemories(client, project, true);
  for (const { record, converted } of convertible) {
    const updatedAt = new Date().toISOString();
    const next = { ...record, ...converted, updatedAt };
    await client.query(
      `INSERT INTO record_event (record_id, type, action, record, actor, at)
       VALUES ($1, $2, 'updated', $3, 'upgrade:adr-0650', $4)`,
      [record.id, next.type, JSON.stringify(next), updatedAt],
    );
    await client.query(`UPDATE record SET type = $2, version = $3, fields = $4, updated_at = $5 WHERE id = $1`,
      [record.id, next.type, next.version, JSON.stringify(next.fields), updatedAt]);
  }
  return warnings;
}

/** A memory whose text says which artifact it is, and that artifact. */
type Convertible = { record: RecordEnvelope; converted: Pick<RecordEnvelope, "type" | "version" | "fields"> };

/**
 * The memories still to convert, and a warning for each that cannot be, read without writing: an
 * open that finds none to convert needs no write, and so no owner's rights (contract 1.10). With
 * `lock`, the rows stay locked for the conversion that follows.
 */
export async function pendingMemories(
  client: PoolClient,
  project: string,
  lock: boolean,
): Promise<{ convertible: Convertible[]; warnings: string[] }> {
  const { rows } = await client.query<{ record: RecordEnvelope }>(`
    SELECT jsonb_build_object('id', id, 'type', type, 'version', version, 'fields', fields,
      'createdAt', created_at, 'updatedAt', updated_at) AS record
    FROM record WHERE type = 'memory' ORDER BY id COLLATE "C"${lock ? " FOR UPDATE" : ""}`);
  const convertible: Convertible[] = [];
  const warnings: string[] = [];
  for (const { record } of rows) {
    record.createdAt = new Date(record.createdAt).toISOString();
    record.updatedAt = new Date(record.updatedAt).toISOString();
    const converted = classify(record);
    if (converted === undefined) {
      warnings.push(`Project ${project}: memory ${record.id} was not converted: its text does not unambiguously supply a supported artifact kind and its required fields. The record and history are preserved; read its original text with library.history({ id: "${record.id}" }) and classify it before replacing it.`);
    } else {
      convertible.push({ record, converted });
    }
  }
  return { convertible, warnings };
}

/** Only explicit labels or a fully specified JSON artifact are evidence of kind; never guess from prose. */
function classify(record: RecordEnvelope): Pick<RecordEnvelope, "type" | "version" | "fields"> | undefined {
  if (record.version !== 1 || typeof record.fields.text !== "string" || Object.keys(record.fields).some((key) => key !== "text" && key !== "links")) return undefined;
  const text = record.fields.text.trim();
  let kind: string;
  let fields: Record<string, unknown>;
  const definition = /^(?:#{1,6}\s+)?Definition:\s*([^\r\n]+)\r?\n+([\s\S]+)$/i.exec(text);
  if (definition) {
    kind = "definition";
    fields = { term: definition[1]!.trim(), meaning: definition[2]!.trim() };
  } else {
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed !== "object" || parsed === null || !("kind" in parsed) || !("fields" in parsed)) return undefined;
      if (Object.keys(parsed).some((key) => key !== "kind" && key !== "fields")) return undefined;
      if (typeof parsed.kind !== "string" || typeof parsed.fields !== "object" || parsed.fields === null || Array.isArray(parsed.fields)) return undefined;
      kind = parsed.kind;
      fields = { ...parsed.fields };
    } catch {
      return undefined;
    }
  }
  if (!KINDS.includes(kind)) return undefined;
  // Preserve the original links, never replace them with a second interpretation of the text.
  if (record.fields.links !== undefined) {
    if (fields.links !== undefined && JSON.stringify(fields.links) !== JSON.stringify(record.fields.links)) return undefined;
    fields.links = record.fields.links;
  }
  // Classification cannot invent a front cover, a number or further references and graph edges.
  if (["frontCoverOf", "number", "supersedes", "context", "rules", "antiPatterns", "stepRefs", "branchEdges"].some((key) => key in fields)) return undefined;
  if (fields.links !== undefined && JSON.stringify(fields.links) !== JSON.stringify(record.fields.links)) return undefined;
  const type = kind as NoteType;
  if (!RECORD_SCHEMAS[type].safeParse(fields).success) return undefined;
  return { type, version: SCHEMA_VERSIONS[type], fields };
}
