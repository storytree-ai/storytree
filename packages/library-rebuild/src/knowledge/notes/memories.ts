// Capability 6 · Knowledge artifacts
import { checkReferences, type RecordType, type SchemaRecords } from "../../storage/rules/index.js";
import type { RecordEnvelope, Transactions } from "../../storage/store/index.js";
import { NOTE_TYPES, referencesOf } from "./links.js";

const MEMORY_UPGRADE_ACTOR = "upgrade:adr-0650";

function classify(memory: RecordEnvelope): { kind: string; fields: Record<string, unknown> } | undefined {
  const text = typeof memory.fields["text"] === "string" ? memory.fields["text"] : "";
  const links = Array.isArray(memory.fields["links"]) ? { links: memory.fields["links"] } : {};
  const [head = "", ...body] = text.trim().split("\n");
  const term = head.slice("definition:".length).trim();
  const meaning = body.join("\n").trim();
  if (head.toLowerCase().startsWith("definition:") && term !== "" && meaning !== "") return { kind: "definition", fields: { term, meaning, ...links } };
  try {
    const parsed = JSON.parse(text) as { kind?: unknown; fields?: unknown };
    if (typeof parsed.kind === "string" && NOTE_TYPES.includes(parsed.kind) && typeof parsed.fields === "object" && parsed.fields !== null) {
      return { kind: parsed.kind, fields: { ...links, ...(parsed.fields as Record<string, unknown>) } };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export async function convertMemories(records: SchemaRecords, transactions: Transactions): Promise<void> {
  for (const memory of await transactions.list("memory")) {
    const kept = "its record and history are kept as they were";
    const classified = classify(memory);
    if (classified === undefined) {
      console.warn(`memory ${JSON.stringify(memory.id)} is not converted: its text names no artifact kind; ${kept}`);
      continue;
    }
    try {
      const kind = classified.kind as RecordType;
      records.check(kind, classified.fields);
      await checkReferences(records, referencesOf(kind, classified.fields));
      await records.create(kind, classified.fields as never, { id: memory.id, actor: MEMORY_UPGRADE_ACTOR });
    } catch (error) {
      console.warn(`memory ${JSON.stringify(memory.id)} is not converted to a ${classified.kind}: ${(error as Error).message}; ${kept}`);
    }
  }
}
