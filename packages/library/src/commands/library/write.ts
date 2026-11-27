// Capability 17 · The library's commands
import { recordDecision } from "../../knowledge/decisions/index.js";
import { ARTIFACT_KINDS, type KnowledgeKind } from "../../knowledge/notes/index.js";
import { NOTE_REFUSALS } from "../../knowledge/notes/kinds.js";
import { CONTRACT_DEFINITION, filedOnSaid, LONG_CONTRACT_TITLE } from "../../plan/index.js";
import type { SchemaRecord } from "../../storage/rules/index.js";
import { heldPending, heldSaid, holdPlanChange, refuseHeldPlanWrite } from "../../work/arcs/index.js";
import type { LibraryVerbContext } from "../context.js";
import { refusing, verb, VerbRefusal, type VerbAnswer } from "../kit/index.js";
import { givenFields } from "./fields.js";

const CAPTURED = ARTIFACT_KINDS as Readonly<Record<string, { readonly captured?: { readonly command: string; readonly tool: string } }>>;

async function refuseClaimed(context: LibraryVerbContext, target: unknown): Promise<void> {
  if (typeof target !== "string") return;
  const refused = await refuseHeldPlanWrite(context.library, await context.claims(), context.session, target);
  if (refused !== undefined) throw new VerbRefusal(refused);
}

async function written(context: LibraryVerbContext, kind: string, fields: Record<string, unknown>, tested: readonly string[] = []): Promise<SchemaRecord> {
  const { library, writer = {} } = context;
  if (kind === "decision") {
    if (fields["status"] === "accepted" && fields["authority"] === undefined) {
      throw new VerbRefusal("an accepted decision written with library new carries its authority (--authority '{\"basis\": …, \"scribedBy\": …, \"at\": …}'): adr new writes one and stamps it for you; nothing was written", { misuse: true });
    }
    return await recordDecision(library, fields as never, writer);
  }
  if (kind === "definition") return await library.defineTerm(fields as never, writer);
  if (Object.hasOwn(ARTIFACT_KINDS, kind)) return await library.writeKnowledge(kind as KnowledgeKind, fields as never, writer);
  if (kind === "story") return await library.addStory(fields as never, writer);
  if (kind === "capability") return await library.addCapability(fields as never, { ...writer, pending: await heldPending(library, await context.claims(), context.session) });
  if (kind === "edge") return await library.addEdge(fields as never, writer);
  if (kind === "contract") {
    for (const target of [fields["capability"], fields["edge"]]) await refuseClaimed(context, target);
    return await library.addContract(fields as never, { ...writer, testedNumbers: tested });
  }
  if (kind.includes(".")) return await library.createPluginRecord(kind, fields, writer);
  if (Object.hasOwn(NOTE_REFUSALS, kind)) throw new VerbRefusal(`library new does not write a ${kind}: ${NOTE_REFUSALS[kind]}; nothing was written`);
  throw new VerbRefusal(`library new writes a note, a decision, a story, capability, contract or edge, or a plugin's record, not a ${kind}`, { misuse: true });
}

function contractSaid(record: SchemaRecord, owner: string | undefined, untested: readonly string[]): string {
  if (record.type !== "contract") return "";
  const one = untested.length === 1;
  const open = owner === undefined || untested.length === 0
    ? ""
    : ` ${untested.length} other ${one ? "contract" : "contracts"} of this capability ${one ? "has" : "have"} no test yet. If this one repeats ${one ? "it" : "any of them"}, retire it and build that one (list ${one ? "it" : "them"} with \`storytree map --select cap:${owner} --down 1 --kind contract --show\`).`;
  const long = record.fields.title.length > LONG_CONTRACT_TITLE
    ? ` Its title runs past ${LONG_CONTRACT_TITLE} characters, which often means more than one contract: ${CONTRACT_DEFINITION} Split it with \`storytree library edit\` and \`storytree library new contract\` if so.`
    : "";
  return open + long;
}

export const NEW = verb({
  command: { family: "library", name: "new", summary: "write a new record of any kind", usage: "library new <kind> --<field> <value> …" },
  tool: { absent: "write_note writes a note on the tool door", twin: "write_note" },
  inputs: {
    "<kind>": { kind: "text", word: 0, describe: "The kind of record to write" },
    "<fields>": { kind: "fields", describe: "Its fields, one --<field> <value> each" },
  },
  writes: true,
  async act(input, context: LibraryVerbContext): Promise<VerbAnswer> {
    const kind = input["<kind>"];
    const captured = CAPTURED[kind]?.captured;
    if (captured !== undefined) throw new VerbRefusal(`A ${kind} is captured with \`${captured.command}\` (the ${captured.tool} tool), which files it with its evidence; library new writes none, so nothing was written.`, { misuse: true });
    const fields = givenFields(kind, input["<fields>"]);
    const owner = kind === "contract" && typeof fields["capability"] === "string" ? fields["capability"] : undefined;
    const numbers = owner === undefined ? undefined : await context.testedNumbers(owner);
    const record = await refusing(() => written(context, kind, fields, numbers?.tested));
    const cover = record.type === "decision" ? record.fields.frontCoverOf : undefined;
    const filed = cover === undefined ? "" : `\n${await filedOnSaid(context.library, cover, "`storytree library edit`")}`;
    return { text: `Wrote ${record.type} ${record.id}.${filed}${contractSaid(record, owner, numbers?.untested ?? [])}`, data: { id: record.id } };
  },
});

export const REFILE = verb({
  command: { family: "library", name: "refile", summary: "rewrite an artifact as another kind, under its id", usage: "library refile <id> <kind> --<field> <value> …" },
  tool: { absent: "refiling is done on the command line" },
  inputs: {
    "<id>": { kind: "text", word: 0, describe: "The artifact to refile" },
    "<kind>": { kind: "text", word: 1, describe: "The kind it becomes" },
    "<fields>": { kind: "fields", describe: "Its fields as that kind" },
  },
  writes: true,
  async act(input, context: LibraryVerbContext): Promise<VerbAnswer> {
    const id = input["<id>"];
    const kind = input["<kind>"];
    if (!Object.hasOwn(ARTIFACT_KINDS, kind)) throw new VerbRefusal(`an artifact is refiled as a kind of artifact (${Object.keys(ARTIFACT_KINDS).join(", ")}), not a ${kind}`, { misuse: true });
    const refiled = await refusing(() => context.library.refile(id, kind as KnowledgeKind, givenFields(kind, input["<fields>"]) as never, context.writer));
    if (refiled === null) throw new VerbRefusal(`no artifact ${id} in this project`);
    return { text: `Refiled ${id} as ${kind}.`, data: { id } };
  },
});

export const RETIRE = verb({
  command: { family: "library", name: "retire", summary: "retire a record with a reason", usage: "library retire <id> --reason <why>" },
  tool: { absent: "retiring is done on the command line" },
  inputs: {
    id: { kind: "text", word: 0, describe: "The record to retire" },
    reason: { kind: "text", describe: "Why it is retired" },
  },
  writes: true,
  async act({ id, reason }, context: LibraryVerbContext): Promise<VerbAnswer> {
    const record = await context.library.get(id);
    if (record === null) throw new VerbRefusal(`no record ${id} in this project`);
    if (record.type === "contract") await refuseClaimed(context, id);
    if (["story", "capability", "contract", "edge"].includes(record.type)) {
      const claims = await context.claims();
      const held = await refusing(() => holdPlanChange(context.library, claims, context.session, { record: id, retire: reason }, context.writer ?? {}));
      if (held !== undefined) return { text: `Retiring ${record.type} ${id} is ${heldSaid(held)}`, data: { id }, next: [{ command: `library read ${held}`, why: "see the change it holds" }] };
    }
    await refusing(() => context.library.retire(id, reason, context.writer));
    return { text: `Retired ${id} (${record.type}).`, data: { id } };
  },
});
