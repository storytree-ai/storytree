// Capability 17 · The library's commands
import type { Library } from "../../index.js";
import { editDecision } from "../../knowledge/decisions/index.js";
import { NOTE_TYPES } from "../../knowledge/notes/index.js";
import { titleOf } from "../../knowledge/search/index.js";
import { ANCHOR_ID, bareSaid, historyOf, PR_CUTOVER_ID } from "../../plan/index.js";
import { editPlanRecord, heldSaid, type PlanRecordType } from "../../work/arcs/index.js";
import type { LibraryVerbContext } from "../context.js";
import { refuseStaleEdit, refusing, verb, VerbRefusal, type VerbAnswer } from "../kit/index.js";
import { givenFields } from "./fields.js";

const PLAN_TYPES: readonly string[] = ["story", "capability", "contract", "edge", "arc", "increment"];

type Stored = NonNullable<Awaited<ReturnType<Library["get"]>>>;

function editedSaid(type: string, id: string, fields: readonly string[], removed: readonly string[]): string {
  const said = [...fields, ...(removed.length === 0 ? [] : [`removed ${removed.join(", ")}`])];
  return `Edited ${type} ${id}: ${said.join(", ")}.`;
}

function refuseOthers(given: Readonly<Record<string, unknown>>, allowed: readonly string[], what: string): void {
  const others = Object.keys(given).filter((field) => !allowed.includes(field));
  if (others.length > 0) throw new VerbRefusal(`${what} takes ${allowed.map((field) => `--${field}`).join(", ")} only, not ${others.map((field) => `--${field}`).join(", ")}; nothing was written`, { misuse: true });
}

async function anchorEdit(context: LibraryVerbContext, given: Readonly<Record<string, string>>): Promise<VerbAnswer> {
  refuseOthers(given, ["what", "audience"], "The project's anchor");
  await refusing(() => context.library.setAnchor(given, context.writer));
  return { text: `Wrote the project's anchor: ${Object.keys(given).join(", ")}.` };
}

async function cutoverEdit(context: LibraryVerbContext, given: Readonly<Record<string, string>>): Promise<VerbAnswer> {
  refuseOthers(given, ["at", "repository", "before"], "The repository cut-over");
  const held = await context.library.prCutover();
  const at = given["at"] ?? held?.at;
  const repository = given["repository"] ?? held?.repository;
  if (at === undefined || repository === undefined) throw new VerbRefusal("The repository cut-over needs --at <time> and --repository <owner/name>; nothing was written", { misuse: true });
  const before = given["before"] === "none" ? null : (given["before"] ?? (held === undefined ? historyOf(repository) : held.before));
  await refusing(() => context.library.setPrCutover({ at, repository, before }, context.writer));
  const earlier = before === null ? "in a deleted repository" : `${before}'s`;
  return { text: `Wrote the repository cut-over: pull requests before ${at} are ${earlier}; later ones are ${repository}'s.` };
}

async function planEdit(context: LibraryVerbContext, record: Stored, fields: Record<string, unknown>, live: boolean): Promise<VerbAnswer> {
  const { library, session } = context;
  const leaves = record.type === "contract" && fields["edge"] !== undefined ? record.fields.capability : undefined;
  const claims = await context.claims();
  const nesting = record.type === "capability" && typeof fields["parent"] === "string" ? fields["parent"] : undefined;
  const story = String(fields["story"] ?? (record.fields as { readonly story?: string }).story);
  const edit = nesting === "none" ? { ...fields, parent: undefined } : fields;
  const levels = nesting === undefined || nesting === "none" ? {} : { levels: (await context.levelsBehind?.(story, nesting)) ?? [] };
  const done = await refusing(() => editPlanRecord(library, claims, session, { type: record.type as PlanRecordType, id: record.id, fields: edit, live: live || nesting !== undefined }, { ...context.writer, ...levels }));
  if (done === null) throw new VerbRefusal(`no ${record.type} ${record.id} in the plan any more`);
  if ("refused" in done) throw new VerbRefusal(done.refused);
  if ("held" in done) {
    const way = `If ${done.held} will have no branch to merge, drop the change (storytree arc increment drop-pending ${done.held} ${record.id}) and run this edit again with --live.`;
    return { text: `Your change to ${record.type} ${JSON.stringify(titleOf(record))} (${record.id}) is ${heldSaid(done.held)} ${way}`, next: [{ command: `library read ${done.held}`, why: "see the change it holds" }] };
  }
  const bare = await bareSaid(library, leaves, `library new contract --capability ${leaves} --title <title>`);
  const nested = nesting === undefined ? "" : nesting === "none" ? " Its parent was cleared in the live plan at once." : " Its parent went to the live plan at once, since the levels behind it were read from the code as it stands now.";
  return { text: `${editedSaid(record.type, record.id, Object.keys(fields), [])}${bare}${nested}` };
}

async function noteEdit(context: LibraryVerbContext, record: Stored, fields: Record<string, unknown>, removed: readonly string[], read: string | undefined): Promise<string> {
  await refuseStaleEdit(context.library, record.id, context.writer, read);
  const edit = { ...fields, ...Object.fromEntries(removed.map((field) => [field, undefined])) };
  await refusing(() => (record.type === "decision" ? editDecision(context.library, record.id, edit, context.writer) : context.library.editNote(record.id, edit as never, context.writer)));
  return editedSaid(record.type, record.id, Object.keys(fields), removed);
}

export const EDIT = verb({
  command: { family: "library", name: "edit", summary: "change named fields of a record", usage: "library edit <id> --<field> <value> … [--remove <field> …] [--live] [--read <seq>]" },
  tool: { absent: "correct_note and edit_plan change records on the tool door", twin: "correct_note" },
  inputs: {
    "<id>": { kind: "text", word: 0, describe: "The record to change" },
    "<fields>": { kind: "fields", describe: "The fields to change, one --<field> <value> each" },
    remove: { kind: "text", many: true, optional: true, describe: "An optional field to remove" },
    live: { kind: "switch", describe: "Edit a story, capability or contract in the live plan even while you hold an increment" },
    read: { kind: "text", optional: true, describe: "The seq of the history entry you read the record at" },
  },
  writes: true,
  async act(input, context: LibraryVerbContext): Promise<VerbAnswer> {
    const id = input["<id>"];
    const given = input["<fields>"];
    const removed = input.remove ?? [];
    if (id === ANCHOR_ID) return await anchorEdit(context, given);
    if (id === PR_CUTOVER_ID) return await cutoverEdit(context, given);
    const record = await context.library.get(id);
    if (record === null) throw new VerbRefusal(`no record ${id} in this project`);
    const fields = givenFields(record.type, given);
    const doubled = removed.find((field) => Object.hasOwn(fields, field));
    if (doubled !== undefined) throw new VerbRefusal(`--${doubled} is given a value and --remove ${doubled} too: give one or the other, not both; nothing was written`, { misuse: true });
    if (PLAN_TYPES.includes(record.type)) {
      if (removed.length > 0) throw new VerbRefusal(`--remove takes no field of a ${record.type}: a story, capability or contract is corrected field by field; nothing was written`, { misuse: true });
      return await planEdit(context, record, fields, input.live ?? false);
    }
    if (record.type === "question") {
      await refusing(() => context.library.editQuestion(id, fields as never, context.writer));
      return { text: editedSaid(record.type, id, Object.keys(fields), []) };
    }
    if (NOTE_TYPES.includes(record.type)) return { text: await noteEdit(context, record, fields, removed, input.read) };
    if (record.type.includes(".")) {
      await refusing(() => context.library.editPluginRecord(id, fields, context.writer));
      return { text: editedSaid(record.type, id, Object.keys(fields), []) };
    }
    throw new VerbRefusal(`library edit does not change a ${record.type}`, { misuse: true });
  },
});
