// Capability 10 · Work in flight
import { referTo, type FieldsOf, type SchemaRecord, type SchemaRecords, type WriteOptions } from "../../storage/rules/index.js";

export type NewQuestion = Omit<FieldsOf<"question">, "lifecycle" | "answer" | "settledAt">;

export interface Settlement {
  readonly answer: string;
  readonly decision?: string;
}

export interface Released {
  readonly id: string;
  readonly title: string;
}

export type SettledQuestion = SchemaRecord<"question"> & { released: Released[] };

export async function raiseQuestion(records: SchemaRecords, question: NewQuestion, options: WriteOptions = {}): Promise<SchemaRecord<"question">> {
  const fields = { ...question, lifecycle: "open" as const };
  records.check("question", fields);
  await referTo(records, "arc", question.arc, "arc");
  return await records.create("question", fields, options);
}

export async function settleQuestion(records: SchemaRecords, id: string, settlement: Settlement, options: WriteOptions = {}): Promise<SettledQuestion | null> {
  return await records.inOneWrite(async () => {
    const question = await liveQuestion(records, id);
    if (question === null) return null;
    if (question.fields.lifecycle !== "open") throw new RangeError(`${id} is settled already: its answer stands`);
    if (settlement.answer.trim() === "") throw new RangeError(`settling ${id} needs an answer`);
    const settled = (await records.edit(id, { lifecycle: "settled", answer: settlement.answer, settledAt: new Date().toISOString() }, options)) as SchemaRecord<"question">;
    const released = (await unhold(records, id, `${id} was settled`, options)).filter(({ fields }) => fields.status !== "closed");
    return { ...settled, released: released.map(({ id: held, fields }) => ({ id: held, title: fields.title })) };
  }, options.signal);
}

export async function retireQuestion(records: SchemaRecords, id: string, reason: string, options: WriteOptions = {}): Promise<string[] | null> {
  return await records.inOneWrite(async () => {
    if ((await liveQuestion(records, id)) === null) return null;
    const released = await unhold(records, id, `${id} was retired: ${reason}`, options);
    await records.retire(id, reason, options);
    return released.map(({ id: held }) => held);
  }, options.signal);
}

export async function openQuestions(records: SchemaRecords, ids?: readonly string[]): Promise<SchemaRecord<"question">[]> {
  if (ids !== undefined && ids.length === 0) return [];
  return (await records.select("question", ["arc", "lifecycle"], { where: { lifecycle: "open" }, ...(ids === undefined ? {} : { ids }) })) as SchemaRecord<"question">[];
}

async function liveQuestion(records: SchemaRecords, id: string): Promise<SchemaRecord<"question"> | null> {
  const record = await records.get(id);
  return record?.type === "question" ? record : null;
}

async function unhold(records: SchemaRecords, question: string, reason: string, options: WriteOptions): Promise<SchemaRecord<"increment">[]> {
  const held = await records.list("increment", { names: question });
  const released: SchemaRecord<"increment">[] = [];
  for (const increment of held) {
    const heldOn = increment.fields.heldOn ?? [];
    if (!heldOn.includes(question)) continue;
    const left = heldOn.filter((one) => one !== question);
    await records.edit(increment.id, { heldOn: left.length === 0 ? undefined : left }, { ...options, reason });
    released.push(increment);
  }
  return released;
}
