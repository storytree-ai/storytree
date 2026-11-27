// Capability 12 · Owner's inbox
import { byCreation, checkReference, checkReferences, type Expected, type FieldsOf, liveRecord, type RecordType, type SchemaRecord, type SchemaRecords, type WriteOptions } from "../../records/index.js";
import { VERDICTS } from "../schema.js";
import { KNOWLEDGE_KINDS } from "../../knowledge/index.js";

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

export const DEFAULT_QUESTION_LEASE_DAYS = 7;

export interface QuestionLease {
  readonly id: string;
  readonly state: "fresh" | "lapsed" | "settled";
  readonly verifiedAt?: string;
  readonly leaseDays: number;
  readonly lapsesAt?: string;
}

const RETIRE_REFUSALS = {
  heldOn: { kind: "question", why: "hold on it (take it off their heldOn first, or settle it instead)" },
  dependsOn: { kind: "capability", why: "depend on it (take it off their dependsOn first)" },
  frontCoverOf: { kind: "capability", why: "name it as their frontCoverOf (edit each decision's frontCoverOf to the capability or story that took the work first)" },
} as const;

export class RetireRefusedError extends Error {
  readonly id: string;
  readonly heldBy: readonly string[];

  constructor(id: string, heldBy: readonly string[], field: keyof typeof RETIRE_REFUSALS = "heldOn") {
    const { kind, why } = RETIRE_REFUSALS[field];
    super(`${kind} ${JSON.stringify(id)} cannot be retired: ${heldBy.map((held) => JSON.stringify(held)).join(", ")} ${why}`);
    this.name = "RetireRefusedError";
    this.id = id;
    this.heldBy = [...heldBy];
  }
}

const QUESTION_WORDING: ReadonlySet<string> = new Set(["title", "stakes", "statement", "context", "options", "analogy", "diagram", "recommendation", "links", "unbuilt", "presenting"]);

const AFTER_ANSWER: ReadonlySet<string> = new Set(["links", "unbuilt"]);

export const EVIDENCE_TYPES: readonly RecordType[] = ["decision", "definition", ...KNOWLEDGE_KINDS, "increment", "question"];

const EVIDENCE: Expected = {
  name: "library record",
  types: EVIDENCE_TYPES,
  why: "a question links the evidence it cites: notes, decisions, research, increments and other questions, never the plan or an arc",
};

const NAMED_ID = /(?<![\w.])[a-z]+_[0-9a-f]{12}\b/g;

const NAMING_FIELDS = ["title", "stakes", "statement", "context", "options", "analogy", "diagram", "recommendation"] as const;

export async function raiseQuestion(
  records: SchemaRecords,
  parked: (arc: SchemaRecord<"arc">) => boolean,
  question: NewQuestion,
  options?: WriteOptions,
): Promise<SchemaRecord<"question">> {
  await checkReference(records, "arc", question.arc, "arc");
  await checkReferences(records, "links", question.links, EVIDENCE);
  const arc = await liveRecord(records, question.arc, ["arc"]);
  if (arc !== null && parked(arc)) {
    throw new RangeError(
      `arc ${JSON.stringify(question.arc)} is parked, so it raises no questions (ADR-0835): write what you would ask into the arc's residue, its owning increment's body, to be raised when the arc is unparked`,
    );
  }
  const links = [...new Set([...(question.links ?? []), ...(await namedEvidence(records, question))])];
  return records.create(
    "question",
    { ...question, ...(links.length === 0 ? {} : { links }), lifecycle: "open", verifiedAt: new Date().toISOString(), leaseDays: question.leaseDays ?? DEFAULT_QUESTION_LEASE_DAYS },
    options,
  );
}

export async function linkNamedEvidence(records: SchemaRecords, id: string, options?: WriteOptions): Promise<SchemaRecord<"question"> | null> {
  const question = await liveRecord(records, id, ["question"]);
  if (question === null) return null;
  const links = question.fields.links ?? [];
  const added = (await namedEvidence(records, question.fields)).filter((named) => named !== id && !links.includes(named));
  if (added.length === 0) return question;
  return (await records.edit(id, { links: [...links, ...added] }, options)) as SchemaRecord<"question"> | null;
}

async function namedEvidence(records: SchemaRecords, words: Partial<Record<(typeof NAMING_FIELDS)[number], string | undefined>>): Promise<string[]> {
  const named = new Set(NAMING_FIELDS.flatMap((field) => words[field]?.match(NAMED_ID) ?? []));
  const live: string[] = [];
  for (const id of named) if ((await liveRecord(records, id, EVIDENCE_TYPES)) !== null) live.push(id);
  return live;
}

export async function checkQuestion(records: SchemaRecords, id: string, at: Date): Promise<QuestionLease | null> {
  const question = await liveRecord(records, id, ["question"]);
  return question === null ? null : leaseOf(question, at);
}

export async function renewQuestion(records: SchemaRecords, id: string, options?: WriteOptions): Promise<SchemaRecord<"question"> | null> {
  const question = await liveRecord(records, id, ["question"]);
  if (question === null) return null;
  if (question.fields.lifecycle === "settled") {
    throw new RangeError(`question ${JSON.stringify(id)} is settled, so there is nothing to renew: its answer stands`);
  }
  return (await records.edit(id, { verifiedAt: new Date().toISOString() }, options)) as SchemaRecord<"question"> | null;
}

export async function editQuestion(records: SchemaRecords, id: string, fields: QuestionEdit, options?: WriteOptions): Promise<SchemaRecord<"question"> | null> {
  const other = Object.keys(fields).find((key) => !QUESTION_WORDING.has(key));
  if (other !== undefined) {
    throw new RangeError(`editQuestion changes ${[...QUESTION_WORDING].join(", ")}, not ${JSON.stringify(other)}: a question's arc moves with moveQuestion (question move), and its answer and lease through their own verbs`);
  }
  const question = await liveRecord(records, id, ["question"]);
  if (question === null) return null;
  if (question.fields.lifecycle === "settled") {
    const kept = fields.links === undefined || (question.fields.links ?? []).every((link) => fields.links!.includes(link));
    if (Object.keys(fields).some((key) => !AFTER_ANSWER.has(key)) || !kept) {
      throw new RangeError(`question ${JSON.stringify(id)} is settled, so its wording cannot change: its answer stands (it may only gain links, keeping those it has, and record the capabilities it leaves unbuilt)`);
    }
  } else if (Object.hasOwn(fields, "unbuilt")) {
    throw new RangeError(`question ${JSON.stringify(id)} is open: only the owner's answer can leave a capability unbuilt, so it records none until settled`);
  }
  await checkReferences(records, "links", fields.links, EVIDENCE);
  await checkReferences(records, "unbuilt", fields.unbuilt, "capability");
  const { prep } = question.fields;
  const reworded = prep !== undefined && Object.keys(fields).some((key) => key !== "presenting" && key !== "links");
  return (await records.edit(id, reworded ? { ...fields, prep: { ...prep, editedAt: new Date().toISOString() } } : fields, options)) as SchemaRecord<"question"> | null;
}

export async function questionPrediction(records: SchemaRecords, id: string): Promise<SchemaRecord<"prediction"> | null> {
  return (await records.list("prediction")).find((prediction) => prediction.fields.question === id) ?? null;
}

export async function predictQuestion(records: SchemaRecords, id: string, answer: WouldBeAnswer, options?: WriteOptions): Promise<SchemaRecord<"prediction"> | null> {
  const question = await liveRecord(records, id, ["question"]);
  if (question === null) return null;
  if (question.fields.lifecycle === "settled") {
    throw new RangeError(`question ${JSON.stringify(id)} is settled, so it takes no would-be answer: the owner has answered it`);
  }
  const fields = { pick: answer.pick, confidence: answer.confidence, why: answer.why, at: new Date().toISOString() };
  const earlier = await questionPrediction(records, id);
  if (earlier !== null) return (await records.edit(earlier.id, fields, options)) as SchemaRecord<"prediction"> | null;
  return records.create("prediction", { question: id, ...fields }, options);
}

function recommends(recommendation: string | undefined): boolean {
  return recommendation !== undefined && !/^\s*none\b/i.test(recommendation);
}

export async function scoreQuestion(records: SchemaRecords, id: string, score: Score, options?: WriteOptions): Promise<SchemaRecord<"question"> | null> {
  const question = await liveRecord(records, id, ["question"]);
  if (question === null) return null;
  const name = JSON.stringify(id);
  if (question.fields.lifecycle === "open") throw new RangeError(`question ${name} is open: it is scored once settled, against the owner's answer`);
  if (question.fields.score !== undefined) throw new RangeError(`question ${name} is already scored: it takes one score`);
  const predicted = (await questionPrediction(records, id)) !== null;
  const recommended = recommends(question.fields.recommendation);
  for (const [side, has, given] of [["a would-be answer", predicted, score.prediction], ["a recommendation", recommended, score.recommendation]] as const) {
    if (has && given === undefined) throw new RangeError(`question ${name} has ${side}, so its score needs a verdict for it`);
    if (!has && given !== undefined) throw new RangeError(`question ${name} has no ${side.slice(2)} to score`);
  }
  if (!predicted && !recommended) throw new RangeError(`question ${name} has no would-be answer and no recommendation: there is nothing to score`);
  const fields = {
    ...(score.prediction === undefined ? {} : { prediction: score.prediction }),
    ...(score.recommendation === undefined ? {} : { recommendation: score.recommendation }),
    by: score.by,
    at: new Date().toISOString(),
  };
  return (await records.edit(id, { score: fields }, options)) as SchemaRecord<"question"> | null;
}

export async function prepQuestion(records: SchemaRecords, id: string, prep: Prep, options?: WriteOptions): Promise<SchemaRecord<"question"> | null> {
  const question = await liveRecord(records, id, ["question"]);
  if (question === null) return null;
  if (question.fields.lifecycle === "settled") throw new RangeError(`question ${JSON.stringify(id)} is settled, so it takes no prep mark: the one it has is the record of its prep`);
  const mark = { at: new Date().toISOString(), stance: prep.stance, ...(prep.reason === undefined ? {} : { reason: prep.reason }) };
  return (await records.edit(id, { prep: mark }, options)) as SchemaRecord<"question"> | null;
}

export async function questionDeviation(records: SchemaRecords, since: Date): Promise<QuestionDeviation> {
  const settled = (await records.list("question")).filter(({ fields }) => fields.settledAt !== undefined && Date.parse(fields.settledAt) >= since.getTime());
  const confidence = new Map((await records.list("prediction")).map(({ fields }) => [fields.question, fields.confidence]));
  const tally = (): Record<Verdict, number> => Object.fromEntries(VERDICTS.map((verdict) => [verdict, 0])) as Record<Verdict, number>;
  const bands = (["high", "medium", "low", "none"] as const).map((band) => ({ band, questions: 0, prediction: tally(), recommendation: tally() }));
  for (const { id, fields } of settled) {
    const { score } = fields;
    if (score === undefined) continue;
    const band = bands.find((one) => one.band === (score.prediction === undefined ? "none" : (confidence.get(id) ?? "none")))!;
    band.questions += 1;
    if (score.prediction !== undefined) band.prediction[score.prediction] += 1;
    if (score.recommendation !== undefined && recommends(fields.recommendation)) band.recommendation[score.recommendation] += 1;
  }
  return {
    settled: settled.length,
    unscored: settled.filter(({ fields }) => fields.score === undefined).length,
    bands: bands.filter(({ questions }) => questions > 0).map(({ band, questions, prediction, recommendation }) => ({ band, questions, ...(band === "none" ? {} : { prediction }), recommendation })),
  };
}

export async function moveQuestion(
  records: SchemaRecords,
  closed: (arc: string) => Promise<boolean>,
  id: string,
  arc: string,
  reason: string,
  options?: WriteOptions,
): Promise<SchemaRecord<"question"> | null> {
  const question = await liveRecord(records, id, ["question"]);
  if (question === null) return null;
  if (question.fields.lifecycle === "settled") {
    throw new RangeError(`question ${JSON.stringify(id)} is settled, so it stays on the arc it was asked on: its answer stands there`);
  }
  await checkReference(records, "arc", arc, "arc");
  if (question.fields.arc === arc) throw new RangeError(`question ${JSON.stringify(id)} is already on arc ${JSON.stringify(arc)}`);
  if (await closed(arc)) throw new RangeError(`arc ${JSON.stringify(arc)} is closed and takes nothing new: move ${JSON.stringify(id)} to a live arc`);
  return (await records.edit(id, { arc }, { ...options, reason })) as SchemaRecord<"question"> | null;
}

export async function lapsedQuestions(records: SchemaRecords, at: Date): Promise<SchemaRecord<"question">[]> {
  const lapsed = (await records.list("question"))
    .map((question) => ({ question, lease: leaseOf(question, at) }))
    .filter(({ lease }) => lease.state === "lapsed");
  const runOut = (lease: QuestionLease): number => (lease.lapsesAt === undefined ? -Infinity : Date.parse(lease.lapsesAt));
  return lapsed.sort((a, b) => runOut(a.lease) - runOut(b.lease) || byCreation(a.question, b.question)).map(({ question }) => question);
}

export async function settleQuestion(records: SchemaRecords, id: string, settlement: Settlement, options?: WriteOptions): Promise<SchemaRecord<"question"> | null> {
  const question = await liveRecord(records, id, ["question"]);
  if (question === null) return null;
  if (question.fields.lifecycle === "settled") throw new RangeError(`question ${JSON.stringify(id)} is already settled`);
  await checkReference(records, "decision", settlement.decision, "decision");
  return (await records.edit(id, {
    lifecycle: "settled",
    answer: settlement.answer,
    settledAt: new Date().toISOString(),
    settledBy: settlement.decision,
    presenting: undefined,
  }, options)) as SchemaRecord<"question"> | null;
}

export async function heldOnQuestion(records: SchemaRecords, incrementId: string): Promise<string[]> {
  const increment = await liveRecord(records, incrementId, ["increment"]);
  if (increment === null || increment.fields.status === "closed") return [];
  return heldOnOpen(increment, await records.list("question"));
}

export async function refuseRetiringHeld(records: SchemaRecords, id: string): Promise<void> {
  const heldBy = (await records.list("increment")).filter((increment) => increment.fields.heldOn?.includes(id) === true);
  if (heldBy.length > 0) throw new RetireRefusedError(id, heldBy.sort(byCreation).map((increment) => increment.id));
}

export function heldOnOpen(
  increment: { readonly fields: { readonly heldOn?: readonly string[] | undefined } },
  questions: readonly { readonly id: string; readonly fields: { readonly lifecycle: string } }[],
): string[] {
  const open = new Set(questions.filter((question) => question.fields.lifecycle === "open").map(({ id }) => id));
  return [...new Set(increment.fields.heldOn ?? [])].filter((id) => open.has(id));
}

function leaseOf(question: SchemaRecord<"question">, at: Date): QuestionLease {
  const { verifiedAt, leaseDays = DEFAULT_QUESTION_LEASE_DAYS, lifecycle } = question.fields;
  const stamped = verifiedAt === undefined ? Number.NaN : Date.parse(verifiedAt);
  const lapsesAt = Number.isNaN(stamped) ? undefined : stamped + leaseDays * 86_400_000;
  const state = lifecycle === "settled" ? "settled" : lapsesAt !== undefined && at.getTime() < lapsesAt ? "fresh" : "lapsed";
  return {
    id: question.id,
    state,
    ...(verifiedAt === undefined ? {} : { verifiedAt }),
    leaseDays,
    ...(lapsesAt === undefined ? {} : { lapsesAt: new Date(lapsesAt).toISOString() }),
  };
}
