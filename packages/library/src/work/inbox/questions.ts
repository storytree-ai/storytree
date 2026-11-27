// Capability 12 · Owner questions
import { PLAN_KINDS } from "../../plan/kinds.js";
import { MissingReferenceError, referTo, SchemaError, unstorable, type FieldsOf, type SchemaRecord, type SchemaRecords, type WriteOptions } from "../../storage/rules/index.js";
import { VERDICTS } from "./kinds.js";

export type NewQuestion = Omit<FieldsOf<"question">, "lifecycle" | "answer" | "settledAt" | "settledBy" | "verifiedAt">;

export interface QuestionEdit {
  readonly title?: string;
  readonly stakes?: string;
  readonly statement?: string;
  readonly context?: string;
  readonly options?: string;
  readonly analogy?: string | undefined;
  readonly diagram?: string | undefined;
  readonly recommendation?: string | undefined;
  readonly links?: readonly string[];
  readonly unbuilt?: readonly string[];
  readonly presenting?: { readonly session: string; readonly since: string } | undefined;
}

export interface Settlement {
  readonly answer: string;
  readonly decision?: string;
}

export interface Released {
  readonly id: string;
  readonly title: string;
}

export type SettledQuestion = SchemaRecord<"question"> & { released: Released[] };

export type WouldBeAnswer = Omit<FieldsOf<"prediction">, "question" | "at">;

export type Verdict = (typeof VERDICTS)[number];

export interface Score {
  readonly prediction?: Verdict;
  readonly recommendation?: Verdict;
  readonly by: string;
}

export interface Prep {
  readonly stance: "agrees" | "differs" | "retire";
  readonly reason?: string;
}

export interface DeviationBand {
  readonly band: "high" | "medium" | "low" | "none";
  readonly questions: number;
  readonly prediction?: Readonly<Record<Verdict, number>>;
  readonly recommendation: Readonly<Record<Verdict, number>>;
}

export interface QuestionDeviation {
  readonly settled: number;
  readonly unscored: number;
  readonly bands: readonly DeviationBand[];
}

export interface QuestionLease {
  readonly id: string;
  readonly state: "fresh" | "lapsed" | "settled";
  readonly verifiedAt?: string;
  readonly leaseDays: number;
  readonly lapsesAt?: string;
}

export class RetireRefusedError extends Error {
  override name = "RetireRefusedError";
  readonly id: string;
  readonly heldBy: readonly string[];

  constructor(id: string, heldBy: readonly string[], field: "heldOn" | "dependsOn" = "heldOn") {
    super(`${id} is not retired: ${heldBy.join(", ")} ${field === "heldOn" ? "is held on it; retireQuestion releases its holders" : "names it in dependsOn"}`);
    this.id = id;
    this.heldBy = heldBy;
  }
}

const DAY = 86_400_000;
const LEASE_DAYS = 7;
const WORDING = ["title", "stakes", "statement", "context", "options", "analogy", "diagram", "recommendation"] as const;
const EDITABLE: ReadonlySet<string> = new Set([...WORDING, "links", "unbuilt", "presenting"]);
const UNLINKED: ReadonlySet<string> = new Set([...Object.keys(PLAN_KINDS), "arc"]);
const LINKABLE = "note, decision, research, increment or question";
const NAMED = /(?<![\w.])[a-z][A-Za-z]*_[0-9a-f]{12}(?!\w)/g;
const BANDS = ["high", "medium", "low", "none"] as const;

export async function raiseQuestion(records: SchemaRecords, question: NewQuestion, options: WriteOptions = {}, arcCheck: (arc: SchemaRecord<"arc">) => void = () => {}): Promise<SchemaRecord<"question">> {
  const { links: given = [], ...rest } = question;
  const fields = { ...rest, lifecycle: "open" as const, verifiedAt: new Date().toISOString(), leaseDays: question.leaseDays ?? LEASE_DAYS };
  records.check("question", { ...fields, ...(question.links === undefined ? {} : { links: question.links }) });
  arcCheck(await referTo(records, "arc", question.arc, "arc"));
  await checkLinks(records, given);
  const links = [...new Set(given)];
  for (const id of await namedEvidence(records, fields, undefined)) if (!links.includes(id)) links.push(id);
  return await records.create("question", { ...fields, ...(links.length === 0 ? {} : { links }) }, options);
}

export async function checkQuestion(records: SchemaRecords, id: string, at: Date = new Date()): Promise<QuestionLease | null> {
  const question = await liveQuestion(records, id);
  return question === null ? null : leaseOf(question, at);
}

export async function renewQuestion(records: SchemaRecords, id: string, options: WriteOptions = {}): Promise<SchemaRecord<"question"> | null> {
  return await records.inOneWrite(async () => {
    const question = await liveQuestion(records, id);
    if (question === null) return null;
    if (question.fields.lifecycle !== "open") throw new RangeError(`${id} is settled: only an open question is renewed`);
    return (await records.edit(id, { verifiedAt: new Date().toISOString() }, options)) as SchemaRecord<"question">;
  }, options.signal);
}

export async function lapsedQuestions(records: SchemaRecords, at: Date = new Date()): Promise<SchemaRecord<"question">[]> {
  const open = await records.list("question", { where: { lifecycle: "open" } });
  const lapsed = open.map((question) => ({ question, lease: leaseOf(question, at) })).filter(({ lease }) => lease.state === "lapsed");
  return lapsed.sort((a, b) => (a.lease.lapsesAt ?? "").localeCompare(b.lease.lapsesAt ?? "")).map(({ question }) => question);
}

export async function editQuestion(records: SchemaRecords, id: string, edit: QuestionEdit, options: WriteOptions = {}): Promise<SchemaRecord<"question"> | null> {
  return await records.inOneWrite(async () => {
    const question = await liveQuestion(records, id);
    if (question === null) return null;
    const keys = Object.keys(edit);
    const other = keys.filter((key) => !EDITABLE.has(key));
    if (other.length > 0) throw new RangeError(`${other.join(", ")} of ${id} is not edited this way: only its wording, links, unbuilt capabilities and who is presenting it`);
    if (question.fields.lifecycle === "settled") {
      const had = question.fields.links ?? [];
      const drops = edit.links !== undefined && had.some((link) => !edit.links!.includes(link));
      if (drops || keys.some((key) => key !== "links" && key !== "unbuilt")) throw new RangeError(`${id} is settled: its answer stands, and it takes only new links and the capabilities its answer leaves unbuilt`);
    } else if (keys.includes("unbuilt")) throw new RangeError(`${id} is open: it has no answer yet to leave a capability unbuilt`);
    const worded = keys.some((key) => (WORDING as readonly string[]).includes(key));
    const prep = worded && question.fields.prep !== undefined ? { prep: { ...question.fields.prep, editedAt: new Date().toISOString() } } : {};
    const fields = { ...edit, ...prep } as Partial<FieldsOf<"question">>;
    records.check("question", present({ ...question.fields, ...fields }));
    if (edit.links !== undefined) await checkLinks(records, edit.links);
    for (const capability of edit.unbuilt ?? []) await referTo(records, "unbuilt", capability, "capability");
    return (await records.edit(id, fields, options)) as SchemaRecord<"question">;
  }, options.signal);
}

export async function linkNamedEvidence(records: SchemaRecords, id: string, options: WriteOptions = {}): Promise<SchemaRecord<"question"> | null> {
  return await records.inOneWrite(async () => {
    const question = await liveQuestion(records, id);
    if (question === null) return null;
    const had = question.fields.links ?? [];
    const found = (await namedEvidence(records, question.fields, id)).filter((link) => !had.includes(link));
    if (found.length === 0) return question;
    return (await records.edit(id, { links: [...had, ...found] }, options)) as SchemaRecord<"question">;
  }, options.signal);
}

export async function moveQuestion(records: SchemaRecords, id: string, arc: string, reason: string, options: WriteOptions, arcState: (arc: string) => Promise<string | undefined>): Promise<SchemaRecord<"question"> | null> {
  return await records.inOneWrite(async () => {
    const question = await liveQuestion(records, id);
    if (question === null) return null;
    if (question.fields.lifecycle !== "open") throw new RangeError(`${id} is settled: only an open question moves`);
    await referTo(records, "arc", arc, "arc");
    if (question.fields.arc === arc) throw new RangeError(`${id} is already on ${arc}`);
    if ((await arcState(arc)) === "closed") throw new RangeError(`${arc} is closed: an open question does not move onto it`);
    return (await records.edit(id, { arc }, { ...options, reason })) as SchemaRecord<"question">;
  }, options.signal);
}

export async function predictQuestion(records: SchemaRecords, id: string, answer: WouldBeAnswer, options: WriteOptions = {}): Promise<SchemaRecord<"prediction"> | null> {
  return await records.inOneWrite(async () => {
    const question = await liveQuestion(records, id);
    if (question === null) return null;
    if (question.fields.lifecycle !== "open") throw new RangeError(`${id} is settled: a would-be answer is recorded only while it is open`);
    const fields = { question: id, pick: answer.pick, confidence: answer.confidence, why: answer.why, at: new Date().toISOString() };
    records.check("prediction", fields);
    const existing = await questionPrediction(records, id);
    if (existing === null) return await records.create("prediction", fields, options);
    return (await records.edit(existing.id, fields, options)) as SchemaRecord<"prediction">;
  }, options.signal);
}

export async function questionPrediction(records: SchemaRecords, id: string): Promise<SchemaRecord<"prediction"> | null> {
  return (await records.list("prediction", { where: { question: id } }))[0] ?? null;
}

export async function scoreQuestion(records: SchemaRecords, id: string, score: Score, options: WriteOptions = {}): Promise<SchemaRecord<"question"> | null> {
  return await records.inOneWrite(async () => {
    const question = await liveQuestion(records, id);
    if (question === null) return null;
    if (question.fields.lifecycle === "open") throw new RangeError(`${id} is open: a question is scored once it is settled`);
    if (question.fields.score !== undefined) throw new RangeError(`${id} is already scored: it takes one score`);
    const predicted = (await questionPrediction(records, id)) !== null;
    if (predicted && score.prediction === undefined) throw new RangeError(`${id} has a would-be answer: its score says how it compared`);
    if (!predicted && score.prediction !== undefined) throw new RangeError(`${id} has no would-be answer to score`);
    if (declined(question.fields.recommendation) && score.recommendation !== undefined) throw new RangeError(`${id}'s raiser made no recommendation, so it takes no verdict`);
    const fields = {
      score: {
        ...(score.prediction === undefined ? {} : { prediction: score.prediction }),
        ...(score.recommendation === undefined ? {} : { recommendation: score.recommendation }),
        by: score.by,
        at: new Date().toISOString(),
      },
    };
    records.check("question", { ...question.fields, ...fields });
    return (await records.edit(id, fields, options)) as SchemaRecord<"question">;
  }, options.signal);
}

export async function prepQuestion(records: SchemaRecords, id: string, prep: Prep, options: WriteOptions = {}): Promise<SchemaRecord<"question"> | null> {
  return await records.inOneWrite(async () => {
    const question = await liveQuestion(records, id);
    if (question === null) return null;
    if (question.fields.lifecycle !== "open") throw new RangeError(`${id} is settled: only an open question is prepped`);
    const fields = { prep: { at: new Date().toISOString(), stance: prep.stance, ...(prep.reason === undefined ? {} : { reason: prep.reason }) } };
    records.check("question", { ...question.fields, ...fields });
    return (await records.edit(id, fields, options)) as SchemaRecord<"question">;
  }, options.signal);
}

export async function questionDeviation(records: SchemaRecords, since: Date): Promise<QuestionDeviation> {
  const settled = (await records.list("question", { where: { lifecycle: "settled" } })).filter(({ fields }) => Date.parse(fields.settledAt ?? "") >= since.getTime());
  const confidence = new Map((await records.list("prediction")).map(({ fields }) => [fields.question, fields.confidence]));
  const scored = settled.filter(({ fields }) => fields.score !== undefined);
  const bands = BANDS.flatMap((band): DeviationBand[] => {
    const asked = scored.filter(({ id }) => (confidence.get(id) ?? "none") === band);
    if (asked.length === 0) return [];
    const recommendation = tally(asked.flatMap(({ fields }) => (declined(fields.recommendation) ? [] : [fields.score?.recommendation])));
    if (band === "none") return [{ band, questions: asked.length, recommendation }];
    return [{ band, questions: asked.length, prediction: tally(asked.map(({ fields }) => fields.score?.prediction)), recommendation }];
  });
  return { settled: settled.length, unscored: settled.length - scored.length, bands };
}

export async function settleQuestion(records: SchemaRecords, id: string, settlement: Settlement, options: WriteOptions = {}): Promise<SettledQuestion | null> {
  return await records.inOneWrite(async () => {
    const question = await liveQuestion(records, id);
    if (question === null) return null;
    if (question.fields.lifecycle !== "open") throw new RangeError(`${id} is settled already: its answer stands`);
    if (typeof settlement.answer !== "string" || settlement.answer.trim() === "") throw new SchemaError("question", [{ field: "answer", problem: `settling ${id} needs an answer` }]);
    if (settlement.decision !== undefined) await referTo(records, "decision", settlement.decision, "decision");
    const fields = { lifecycle: "settled" as const, answer: settlement.answer, settledAt: new Date().toISOString(), presenting: undefined, ...(settlement.decision === undefined ? {} : { settledBy: settlement.decision }) };
    const settled = (await records.edit(id, fields, options)) as SchemaRecord<"question">;
    const released = (await unhold(records, id, `${id} was settled`, options)).filter(({ fields: held }) => held.status !== "closed");
    return { ...settled, released: released.map(({ id: held, fields: { title } }) => ({ id: held, title })) };
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

export async function retireUnheld(records: SchemaRecords, id: string, reason: string, options: WriteOptions = {}): Promise<void> {
  if (unstorable(id) !== undefined) return;
  await records.inOneWrite(async () => {
    const holders = (await records.list("increment", { names: id })).filter(({ fields }) => (fields.heldOn ?? []).includes(id));
    if (holders.length > 0) throw new RetireRefusedError(id, holders.map(({ id: held }) => held));
    await records.retire(id, reason, options);
  }, options.signal);
}

export async function openQuestions(records: SchemaRecords, ids?: readonly string[]): Promise<SchemaRecord<"question">[]> {
  if (ids !== undefined && ids.length === 0) return [];
  return (await records.select("question", ["arc", "lifecycle"], { where: { lifecycle: "open" }, ...(ids === undefined ? {} : { ids }) })) as SchemaRecord<"question">[];
}

function leaseOf(question: SchemaRecord<"question">, at: Date): QuestionLease {
  const { verifiedAt, leaseDays = LEASE_DAYS, lifecycle } = question.fields;
  const verified = verifiedAt === undefined ? {} : { verifiedAt };
  if (lifecycle !== "open") return { id: question.id, state: "settled", ...verified, leaseDays };
  if (verifiedAt === undefined) return { id: question.id, state: "lapsed", leaseDays };
  const lapses = Date.parse(verifiedAt) + leaseDays * DAY;
  return { id: question.id, state: at.getTime() < lapses ? "fresh" : "lapsed", verifiedAt, leaseDays, lapsesAt: new Date(lapses).toISOString() };
}

async function checkLinks(records: SchemaRecords, links: readonly string[]): Promise<void> {
  for (const id of links) {
    const record = await records.get(id);
    if (record === null || UNLINKED.has(record.type)) throw new MissingReferenceError("links", id, LINKABLE, record?.type);
  }
}

async function namedEvidence(records: SchemaRecords, fields: Partial<FieldsOf<"question">>, self: string | undefined): Promise<string[]> {
  const words = WORDING.map((field) => fields[field] ?? "").join("\n");
  const found: string[] = [];
  for (const id of new Set(words.match(NAMED) ?? [])) {
    if (id === self) continue;
    const record = await records.get(id);
    if (record !== null && !UNLINKED.has(record.type)) found.push(id);
  }
  return found;
}

function declined(recommendation: string | undefined): boolean {
  return recommendation === undefined || /^\s*none\b/i.test(recommendation);
}

function tally(verdicts: readonly (Verdict | undefined)[]): Record<Verdict, number> {
  const counts = Object.fromEntries(VERDICTS.map((verdict) => [verdict, 0])) as Record<Verdict, number>;
  for (const verdict of verdicts) if (verdict !== undefined) counts[verdict] += 1;
  return counts;
}

function present(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
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
