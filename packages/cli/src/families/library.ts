/**
 * Capability 3 · Library (stories/cli.md): the library's own reads and writes, from a terminal.
 */
import { labelOf, Refusal, type Answer } from "../answer.js";
import type { Family, Verb } from "../door.js";

const search: Verb = {
  name: "search",
  usage: "library search <words…>",
  summary: "the notes holding every word, ignoring case",
  async act(args, context) {
    const query = args.words.join(" ").trim();
    if (query === "") throw new Refusal("this needs the words to search for\nusage: storytree library search <words…>", { code: 2 });
    const notes = await (await context.library()).search(query);
    if (notes.length === 0) return { text: `No note holds "${query}".` };
    const lines = notes.map((note) => `  ${note.id}  [${note.type}]  ${labelOf(note.fields)}`);
    return { text: [`${notes.length} note${notes.length === 1 ? "" : "s"} holding "${query}":`, ...lines].join("\n") };
  },
};

const create: Verb = {
  name: "new",
  usage: "library new memory --text <text|@file>",
  summary: "write a new record",
  async act(args, context): Promise<Answer> {
    const kind = args.word(0, "the kind of record", this.usage);
    if (kind !== "memory") throw new Refusal(`storytree library new writes a memory so far, not a ${kind}`);
    const written = await (await context.library()).writeMemory({ text: args.text("text") as string });
    return { text: `Wrote memory ${written.id}.`, next: [{ command: "storytree library search <words>", why: "find it again" }] };
  },
};

export const library: Family = {
  name: "library",
  summary: "read, search and write the project's records",
  verbs: [search, create],
};
