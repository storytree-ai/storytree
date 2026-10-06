/** Capability 5 · Briefing: an arc's intent and its questions, without proposals or a write affordance. */
import type { FieldsOf } from "@storytree/library";

export interface Question {
  id: string;
  fields: FieldsOf<"question">;
}
export interface Option {
  summary: string;
  for: string;
  against: string;
}
export interface QuestionReading {
  id: string;
  title: string;
  words: number;
  hasDiagram: boolean;
  lead: { label: string; text: string }[];
  diagram: string;
  options: Option[];
  recommendation?: { label: string; text: string };
  folds: { label: string; text: string; words: number }[];
  answer?: string;
}
export interface Briefing {
  intent: string;
  waitingLabel: string;
  waiting: QuestionReading[];
  settled: QuestionReading[];
  blockedNote: string;
}

const wordsIn = (text: string | undefined) => text?.trim() ? text.trim().split(/\s+/u).length : 0;

/** Options follow the existing FOR:/AGAINST: convention; older prose remains intact. */
function optionsIn(text: string): Option[] {
  return text.split(/\n\s*\n/u).map((paragraph) => {
    const parts = /^(.*?)\bFOR:\s*(.*?)\bAGAINST:\s*(.*)$/su.exec(paragraph.trim());
    return parts ? { summary: parts[1]!.trim(), for: parts[2]!.trim(), against: parts[3]!.trim() } : { summary: paragraph.trim(), for: "", against: "" };
  }).filter((option) => option.summary || option.for || option.against);
}

export function questionReading({ id, fields: q }: Question): QuestionReading {
  const hasDiagram = Boolean(q.diagram?.trim());
  return {
    id, title: q.title,
    words: [q.statement, q.stakes, q.diagram, q.options, q.recommendation, q.analogy, q.context].reduce<number>((total, text) => total + wordsIn(text), 0),
    hasDiagram,
    lead: [{ label: "Statement", text: q.statement }, { label: "Stakes", text: q.stakes }],
    diagram: hasDiagram ? q.diagram! : "No diagram stored",
    options: optionsIn(q.options),
    ...(q.recommendation ? { recommendation: { label: "Recommendation (not binding)", text: q.recommendation } } : {}),
    folds: [{ label: "Analogy", text: q.analogy ?? "" }, { label: "Context", text: q.context }].filter(({ text }) => text.trim()).map((field) => ({ ...field, words: wordsIn(field.text) })),
    ...(q.answer === undefined ? {} : { answer: q.answer }),
  };
}

/** A parked arc's open questions are parked with it until it is unparked (ADR-0835 D2). */
export function briefing(intent: string, questions: readonly Question[], { parked = false }: { parked?: boolean } = {}): Briefing {
  const waiting = questions.filter(({ fields }) => fields.lifecycle === "open").map(questionReading);
  return {
    intent, waiting,
    waitingLabel: !waiting.length ? "Nothing is waiting on you here" : parked ? "Parked with the arc: these wait for it to be unparked" : "Waiting on you",
    settled: questions.filter(({ fields }) => fields.lifecycle === "settled").map(questionReading),
    blockedNote: '"Blocked" comes only from waits on other work.',
  };
}

/** The caller gives arcs in lane order and in the current scope. */
export function firstBriefing(arcs: readonly { id: string; parked?: boolean; questions: readonly Question[] }[]): string | undefined {
  return (arcs.find(({ parked, questions }) => !parked && questions.some(({ fields }) => fields.lifecycle === "open")) ?? arcs[0])?.id;
}
