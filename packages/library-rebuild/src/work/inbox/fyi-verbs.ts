// Capability 17 · The library's commands
import { refusing, verb, type VerbAnswer, type VerbContext, type VerbFamily } from "../../commands/kit/index.js";

const NEW_FYI = verb({
  command: { family: "fyi", name: "new", summary: "record an FYI for the owner to hear", usage: "fyi new --title <title> --what <what> --about <about> [--at <time>] [--by <writer>]" },
  tool: { absent: "FYIs are recorded on the command line" },
  inputs: {
    title: { kind: "text", describe: "What happened, in a line" },
    what: { kind: "text", describe: "What the owner should know" },
    about: { kind: "text", describe: "The record, pull request or run it is about" },
    at: { kind: "text", optional: true, describe: "When it happened (now unless given)" },
    by: { kind: "text", optional: true, describe: "Who records it (you unless given)" },
  },
  writes: true,
  async act({ title, what, about, at, by }, context: VerbContext): Promise<VerbAnswer> {
    const writer = context.writer ?? {};
    const made = await refusing(() => context.library.recordFyi({ title, what, about, by: by ?? writer.actor ?? `session:${context.session}`, ...(at === undefined ? {} : { at }) }, writer));
    return { text: `Recorded FYI ${made.id}: ${title}.`, data: { id: made.id } };
  },
});

const LIST_FYIS = verb({
  command: { family: "fyi", name: "list", summary: "the FYIs not heard yet, oldest first", usage: "fyi list" },
  tool: { absent: "FYIs are listed on the command line" },
  inputs: {},
  async act(_input, context: VerbContext): Promise<VerbAnswer> {
    const unheard = await context.library.unheardFyis();
    if (unheard.length === 0) return { text: "No FYIs waiting to be heard." };
    const lines = unheard.map(({ id, fields }) => `  ${id}  ${fields.at}  ${fields.title}: ${fields.what} (about ${fields.about}, by ${fields.by})`);
    return { text: [`${unheard.length} ${unheard.length === 1 ? "FYI waits" : "FYIs wait"} to be heard:`, ...lines].join("\n") };
  },
});

const HEARD = verb({
  command: { family: "fyi", name: "heard", summary: "mark FYIs heard, so the list no longer shows them", usage: "fyi heard <id> …" },
  tool: { absent: "FYIs are marked heard on the command line" },
  inputs: { ids: { kind: "text", word: 0, many: true, describe: "The FYIs heard" } },
  writes: true,
  async act({ ids }, context: VerbContext): Promise<VerbAnswer> {
    const marked = await refusing(() => context.library.markFyisHeard(ids, context.writer));
    return { text: marked.length === 0 ? "Each was heard already." : `Marked heard: ${marked.join(", ")}.` };
  },
});

export const FYI_FAMILY: VerbFamily = { name: "fyi", summary: "FYIs for the owner: record, list, mark heard", order: 4, verbs: [NEW_FYI, LIST_FYIS, HEARD] };
