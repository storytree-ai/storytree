/** Capability 5 · Briefing: an arc's intent, its questions and its increments as rows that open, without a write affordance. */
import type { FieldsOf, NoteWait } from "@storytree/library";
import type { BoardAgent } from "../agents/agents.js";
import type { Bar, Lane } from "../board/board.js";
import type { NamedWait, WorkName } from "../waits/waits.js";

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
  status: "open" | "settled";
  answer?: string;
}
export interface Briefing {
  intent: string;
  /** Open questions first, then settled ones. */
  questions: QuestionReading[];
  /** Said once on the questions when a parked arc has open ones (ADR-0835 D2). */
  parkedNote?: string;
}
export interface IncrementChip {
  kind: "you" | "work" | "event" | "check-back" | "blocked" | "agent" | "free" | "not-completed" | "landed";
  text: string;
}
export interface IncrementRow {
  id: string;
  title: string;
  color: Bar["reading"]["color"];
  chips: IncrementChip[];
  landed: boolean;
  /** What opening the row reads: objective and waits, never the planning body. */
  detail: { objective: string; waits: string[]; questionsBehind: string[]; holdsUp: string[]; heldBy: string[]; close?: string };
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
    status: q.lifecycle === "settled" ? "settled" : "open",
    ...(q.answer === undefined ? {} : { answer: q.answer }),
  };
}

/** A parked arc's open questions are parked with it until it is unparked (ADR-0835 D2). */
export function briefing(intent: string, questions: readonly Question[], { parked = false }: { parked?: boolean } = {}): Briefing {
  const open = questions.filter(({ fields }) => fields.lifecycle === "open");
  return {
    intent,
    questions: [...open, ...questions.filter(({ fields }) => fields.lifecycle === "settled")].map(questionReading),
    ...(parked && open.length ? { parkedNote: "Parked with the arc: the open ones wait for it to be unparked" } : {}),
  };
}

const workText = (work: WorkName) => `${work.title}${work.arc ? ` (${work.arc.title})` : ""}`;
const waitText = (wait: NamedWait) => `${workText(wait)}: ${wait.reason}${wait.warning ? ` — ${wait.warning}` : ""}`;
const noteText = (wait: NoteWait) => !wait.holds ? `check-back passed ${wait.checkBack}: ${wait.note}`
  : wait.releaser === "owner" ? `waits for you: ${wait.note}` : `waits for an event: ${wait.note} (check back ${wait.checkBack})`;
const agentText = (agent: BoardAgent) => `${agent.label} · ${agent.quietMinutes} min quiet`;
/** "storytree-ai/storytree#131", ".../pull/131" and "131" all read "#131". */
const prNumber = (pr: string) => `#${/(\d+)\D*$/u.exec(pr)?.[1] ?? pr}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** One short cell: a chip per kind of wait, never a sentence. */
function chipsOf(bar: Bar, pr: string | undefined): IncrementChip[] {
  if (bar.reading.state === "landed") return [{ kind: "landed", text: pr ? prNumber(pr) : "landed" }];
  if (bar.reading.state === "not-completed") return [{ kind: "not-completed", text: "not completed" }];
  const holding = bar.noteWaits.filter(({ holds }) => holds);
  const chips: IncrementChip[] = [
    ...(bar.reading.state === "waiting-on-you" || bar.questionsBehind.length || holding.some(({ releaser }) => releaser === "owner") ? [{ kind: "you" as const, text: "you" }] : []),
    ...(bar.waits.length ? [{ kind: "work" as const, text: plural(bar.waits.length, "increment") }] : []),
    ...(holding.some(({ releaser }) => releaser !== "owner") ? [{ kind: "event" as const, text: "event" }] : []),
    ...(bar.noteWaits.some(({ holds }) => !holds) ? [{ kind: "check-back" as const, text: "check-back passed" }] : []),
    ...(bar.blockedBy ? [{ kind: "blocked" as const, text: "blocked" }] : []),
    ...bar.agents.map((agent) => ({ kind: "agent" as const, text: agentText(agent) })),
  ];
  return chips.length ? chips : [{ kind: "free", text: "to take" }];
}
const waiting = new Set<IncrementChip["kind"]>(["you", "work", "event", "blocked"]);
/** Waiting first, then in progress, then free to take, then not completed, then landed. */
const rank = ({ chips }: IncrementRow) => chips.some(({ kind }) => waiting.has(kind)) ? 0
  : chips.some(({ kind }) => kind === "agent") ? 1 : chips[0]!.kind === "not-completed" ? 3 : chips[0]!.kind === "landed" ? 4 : 2;

/** Every increment on the lane as a row, read from its bar and its record; bar order breaks ties. */
export function incrementRows(lane: Lane): IncrementRow[] {
  const records = new Map(lane.view.increments.map((increment) => [increment.id, increment.fields]));
  const rows = lane.bars.map((bar): IncrementRow => {
    const fields = records.get(bar.id);
    const outcome = fields?.outcome;
    return {
      id: bar.id, title: bar.title, color: bar.reading.color, chips: chipsOf(bar, outcome?.pr), landed: bar.reading.state === "landed",
      detail: {
        objective: fields?.objective ?? "",
        waits: [...bar.waits.map(waitText), ...bar.noteWaits.map(noteText), ...(bar.blockedBy ? [`blocked: ${workText(bar.blockedBy)} holds a capability it lists`] : [])],
        questionsBehind: bar.questionsBehind,
        holdsUp: bar.holdsUp.map((work) => `${workText(work)}: ${work.reason}`),
        heldBy: bar.agents.map((agent) => `${agentText(agent)}: ${agent.reason}`),
        ...(outcome ? { close: [outcome.disposition, ...(outcome.pr ? [`PR ${outcome.pr}`] : []), ...(outcome.note ? [outcome.note] : [])].join(" · ") } : {}),
      },
    };
  });
  return rows.map((row, index) => ({ row, index })).sort((a, b) => rank(a.row) - rank(b.row) || a.index - b.index).map(({ row }) => row);
}

/** The caller gives arcs in lane order and in the current scope. */
export function firstBriefing(arcs: readonly { id: string; parked?: boolean; questions: readonly Question[] }[]): string | undefined {
  return (arcs.find(({ parked, questions }) => !parked && questions.some(({ fields }) => fields.lifecycle === "open")) ?? arcs[0])?.id;
}
