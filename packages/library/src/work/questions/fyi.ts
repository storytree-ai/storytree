// Capability 12 · Owner's inbox
import type { FieldsOf, SchemaRecord, WriteOptions } from "../../records/index.js";
import { verb, VerbRefusal, type VerbContext, type VerbFamily } from "../../verbs/verb.js";

interface FyiLibrary {
  recordFyi(fyi: Omit<FieldsOf<"fyi">, "at" | "heardAt"> & { readonly at?: string | undefined }, options?: WriteOptions): Promise<SchemaRecord<"fyi">>;
  unheardFyis(): Promise<SchemaRecord<"fyi">[]>;
  markFyisHeard(ids: readonly string[], options?: WriteOptions): Promise<string[]>;
}

type FyiContext = VerbContext<FyiLibrary>;

const NO_TOOL = { absent: "FYIs are recorded and marked heard from the command line; what reads them to the owner calls the library itself" } as const;

const create = verb({
  command: {
    family: "fyi",
    name: "new",
    summary: "record something the owner should know: what happened, when, and what it is about",
    usage: "fyi new --title <t> --what <text|@file> --about <id|path|PR> [--at <ISO time>] [--by <writer>]",
  },
  tool: NO_TOOL,
  inputs: {
    title: { kind: "text", describe: "a short title in plain words" },
    what: { kind: "text", describe: "what happened" },
    about: { kind: "text", describe: "what it is about: a record's id, a file path or a pull request" },
    at: { kind: "text", optional: true, describe: "when it happened, an ISO 8601 time; now when left out" },
    by: { kind: "text", optional: true, describe: "who noticed it; the caller when left out" },
  },
  writes: true,
  async act({ title, what, about, at, by }, context: FyiContext) {
    const fyi = await context.library.recordFyi({ title, what, about, by: by ?? context.writer?.actor ?? `session:${context.session}`, ...(at === undefined ? {} : { at }) }, context.writer);
    return { text: `Recorded FYI ${fyi.id}: ${fyi.fields.title}`, next: [{ command: "fyi list", why: "the FYIs the owner has not heard yet" }] };
  },
});

const list = verb({
  command: { family: "fyi", name: "list", summary: "the FYIs the owner has not heard yet, oldest first", usage: "fyi list" },
  tool: NO_TOOL,
  inputs: {},
  async act(_inputs, context: FyiContext) {
    const unheard = await context.library.unheardFyis();
    if (unheard.length === 0) return { text: "No FYIs waiting to be heard." };
    const lines = unheard.map(({ id, fields }) => `  ${fields.at.slice(0, 16).replace("T", " ")}  ${id}  ${fields.title}\n      ${fields.what.split(/\r?\n/, 1)[0]} (about ${fields.about}, by ${fields.by})`);
    return { text: [`FYIs waiting to be heard, oldest first (${unheard.length}):`, ...lines].join("\n") };
  },
});

const heard = verb({
  command: { family: "fyi", name: "heard", summary: "mark FYIs heard, so they are not offered again", usage: "fyi heard <id> [<id> …]" },
  tool: NO_TOOL,
  inputs: { ids: { kind: "text", word: 0, many: true, describe: "the FYIs' ids" } },
  writes: true,
  async act({ ids }, context: FyiContext) {
    if (ids.length === 0) throw new VerbRefusal("this needs the id of at least one FYI", { misuse: true });
    let marked: string[];
    try {
      marked = await context.library.markFyisHeard(ids, context.writer);
    } catch (error) {
      throw new VerbRefusal((error as Error).message);
    }
    return { text: marked.length === 0 ? "Each was already heard; nothing changed." : `Marked heard: ${marked.join(", ")}` };
  },
});

export const FYI_FAMILY: VerbFamily<FyiContext> = {
  name: "fyi",
  summary: "what the owner should know after the fact: new, list, heard",
  order: 3.5,
  verbs: [create, list, heard],
};
