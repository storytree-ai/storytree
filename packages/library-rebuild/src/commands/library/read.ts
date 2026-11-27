// Capability 17 · The library's commands
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Library } from "../../index.js";
import { decisionLinkLines, fieldOf, fieldsHeld, justificationSaid, linkedFromLines, supersededLines, valueSaid, wholeRecord } from "../../knowledge/notes/index.js";
import { titleOf } from "../../knowledge/search/index.js";
import { attachedLines, attachedTo } from "../../plan/index.js";
import type { LibraryVerbContext } from "../context.js";
import { contextIn, PROJECT_INPUT, verb, VerbRefusal, type VerbAnswer } from "../kit/index.js";
import { decisionNamed } from "../queries/index.js";

type Stored = NonNullable<Awaited<ReturnType<Library["get"]>>>;

const ID = /^[a-z][A-Za-z]*_[0-9a-f]{12}$/;

function namedIds(record: Stored): string[] {
  return Object.values(record.fields as Record<string, unknown>).flatMap((value) => (Array.isArray(value) ? value.filter((one): one is string => typeof one === "string" && ID.test(one)) : []));
}

async function block(library: Library, record: Stored): Promise<string> {
  const attached = record.type === "story" || record.type === "capability" ? attachedLines(await attachedTo(library, record)) : [];
  return [wholeRecord(record), ...attached, ...(await decisionLinkLines(library, record)), ...(await linkedFromLines(library, record.id)), ...(await supersededLines(library, record))].join("\n");
}

export const READ = verb({
  command: { family: "library", name: "read", summary: "read records whole by id or a decision by its number, or one field exactly as stored", usage: "library read <id|decision number> … [--linked] [--field <field> [--out <file>]] [--project <project>]" },
  tool: { absent: "open reads a record on the tool door", twin: "open" },
  inputs: {
    ids: { kind: "text", word: 0, many: true, describe: "The ids of the records to read, or a decision's number (1103 or ADR-1103)" },
    linked: { kind: "switch", describe: "Read too each record their id lists name, once" },
    field: { kind: "text", optional: true, describe: "One field to give exactly as stored" },
    out: { kind: "text", optional: true, describe: "A file in this folder to write the one field to" },
    project: PROJECT_INPUT,
  },
  async act({ ids, linked, field, out, project }, context: LibraryVerbContext): Promise<VerbAnswer> {
    if (out !== undefined && field === undefined) throw new VerbRefusal("--out writes one field to a file: give --field too", { misuse: true });
    const there = await contextIn(context, project);
    const { library } = there;
    const records: Stored[] = [];
    const missing: string[] = [];
    for (const id of ids) {
      const record = await library.get(await decisionNamed(library, id));
      if (record === null) missing.push(id);
      else records.push(record);
    }
    if (missing.length > 0) throw new VerbRefusal(`no record ${missing.join(", ")} in this project${there === context ? "" : ` (${there.project})`}`);
    if (field !== undefined) {
      if (records.length !== 1) throw new VerbRefusal("--field reads one field of one record: give one id", { misuse: true });
      const [record] = records as [Stored];
      if (!fieldsHeld(record).includes(field)) throw new VerbRefusal(`${record.id} has no field ${JSON.stringify(field)}: its fields are ${fieldsHeld(record).join(", ")}`, { misuse: true });
      const value = valueSaid(await fieldOf(library, record, field));
      if (out === undefined) return { text: value, raw: true };
      const file = path.resolve(context.folder, out);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, value);
      return { text: `Wrote ${field} of ${record.id} to ${file}.` };
    }
    if (linked) {
      const shown = new Set(records.map(({ id }) => id));
      for (const id of records.flatMap(namedIds)) {
        if (shown.has(id)) continue;
        shown.add(id);
        const record = await library.get(id);
        if (record !== null) records.push(record);
      }
    }
    const blocks: string[] = [];
    for (const record of records) blocks.push(await block(library, record));
    const text = blocks.join("\n\n");
    return { text: there === context ? text : `project ${there.project}:\n${text}` };
  },
});

export const LINKS = verb({
  command: { family: "library", name: "links", summary: "the records that link to an artifact", usage: "library links <artifact>" },
  tool: { absent: "open lists what links to a record on the tool door", twin: "open" },
  inputs: { artifact: { kind: "text", word: 0, describe: "The artifact linked to" } },
  async act({ artifact }, context: LibraryVerbContext): Promise<VerbAnswer> {
    const linking = await context.library.linkingIn(artifact);
    if (linking.length === 0) return { text: `No artifact links to ${artifact}.` };
    const lines = linking.map((record) => {
      const line = `  ${record.id}  [${record.type}]  ${titleOf(record)}`;
      return record.type === "decision" ? justificationSaid(record.fields, artifact, line) : line;
    });
    return { text: [`${linking.length} ${linking.length === 1 ? "artifact links" : "artifacts link"} to ${artifact}:`, ...lines].join("\n") };
  },
});

export const RELATED = verb({
  command: { family: "library", name: "related", summary: "the notes that share words with a note but do not link to it", usage: "library related <id>" },
  tool: { absent: "search_notes finds notes on the tool door", twin: "search_notes" },
  inputs: { id: { kind: "text", word: 0, describe: "The note to find related notes for" } },
  async act({ id }, context: LibraryVerbContext): Promise<VerbAnswer> {
    const related = await context.library.related(id);
    if (related === null) throw new VerbRefusal(`no note ${id} in this project`);
    if (related.hits.length === 0) return { text: `No note shares words with ${id}.` };
    return { text: [`${related.hits.length} notes share words with ${id}:`, ...related.hits.map(({ id: hit, type, title, linked }) => `  ${hit}  [${type}]  ${title}${linked ? "  (linked)" : ""}`)].join("\n") };
  },
});
