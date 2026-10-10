/** Capability 3 · Arc surface. */
import { logReading, type Line, type LogReading } from "@storytree/agent-link/readings";
import type { ArcView, Hold, NoteWait } from "@storytree/library";
import { agentsOnBoard, type BoardAgent } from "../agents/agents.js";
import { firstBriefing } from "../briefing/briefing.js";
import { arcQueues, waitsOnBoard, type ArcQueue, type NamedWait, type WorkName } from "../waits/waits.js";
import { arcState, incrementState, questionsBehind, type ArcState, type IncrementReading } from "../work-states/board-states.js";

export type BoardScope = "active" | "parked" | "closed";
export interface BoardSnapshot {
  arcs: ArcView[];
  waits: Record<string, Hold[]>;
  heldOn: Record<string, string[]>;
  /** Each open increment's waits for the owner or an event (ADR-0938); a board kept by an older build has none. */
  waitsFor?: Record<string, NoteWait[]>;
}
export interface Bar {
  id: string;
  title: string;
  reading: IncrementReading;
  agents: BoardAgent[];
  waits: NamedWait[];
  /** Its waits for the owner or an event, including one whose check-back has passed (it reads as no longer holding). */
  noteWaits: NoteWait[];
  /** The titles of the owner's questions its waits on other work end on (its reading's `behind`). */
  questionsBehind: string[];
  holdsUp: (WorkName & { reason: string })[];
  /** The increment holding a capability its list names, when it reads blocked (ADR-0949 D3). */
  blockedBy?: WorkName;
}
/** A note wait that still holds, with the increment it holds. */
export interface LaneNoteWait extends NoteWait {
  increment: { id: string; title: string };
}
export interface Lane {
  id: string;
  title: string;
  /** The arc's priority, 1 first; an unranked arc has none (ADR-0963). */
  priority?: number;
  view: ArcView;
  bars: Bar[];
  agents: BoardAgent[];
  state: ArcState;
  chip: string;
  /** A ready lane's idle claims, named in its chip's hover (ADR-0938 D3, ADR-0980). */
  idle?: { chip: string; agents: BoardAgent[] };
  /** What landed and what is open, spoken on the bars' label and never shown (ADR-0980). */
  count: string;
  lastActivity: number;
  waits: NamedWait[];
  /** The waits for the owner or an event that still hold some increment, in bar order (ADR-0938). */
  noteWaits: LaneNoteWait[];
  holdsUp: (WorkName & { reason: string })[];
}
export interface BoardView {
  scope: BoardScope;
  lanes: Lane[];
  queues: ArcQueue[];
  selected: string | undefined;
}
const rank: Record<ArcState, number> = { waiting: 0, blocked: 1, queued: 1, "in-progress": 2, idle: 3, ready: 4, quiet: 5, parked: 6, closed: 7 };
const time = (at: string) => Date.parse(at) || 0;
const withBlocker = (holder: string | undefined) => (holder === undefined ? {} : { blockedBy: holder });

/** The log is the lines themselves, or a reading that holds its claims folded and keeps its claim lines. */
export function boardView(snapshot: BoardSnapshot, log: readonly Line[] | LogReading, now: Date, scope: BoardScope = "active", quietMs?: number): BoardView {
  const reading = logReading(log);
  const { lines } = reading;
  const agents = agentsOnBoard(reading, now, quietMs);
  const names = snapshot.arcs.flatMap(({ arc, increments }): WorkName[] => [
    { id: arc.id, title: arc.fields.title },
    ...increments.map((increment) => ({ id: increment.id, title: increment.fields.title, arc: { id: arc.id, title: arc.fields.title } })),
  ]);
  const waits = waitsOnBoard(names, new Map(Object.entries(snapshot.waits)));
  // ADR-0949 D3: each capability a live session holds for an open increment, by that increment: its own claim lights its list, a capability claim counts for the increment it was taken under.
  const openWork = snapshot.arcs.flatMap(({ increments }) => increments).filter(({ fields }) => fields.status !== "closed");
  const live = agents.all.filter(({ holder }) => holder === "live");
  const holding = new Map<string, string>([
    ...openWork.filter(({ id }) => live.some((agent) => agent.increment === id)).flatMap(({ id, fields }) => (fields.capabilities ?? []).map((capability): [string, string] => [capability, id])),
    ...live.flatMap(({ capability, under }): [string, string][] => capability !== undefined && under !== undefined && openWork.some(({ id }) => id === under) ? [[capability, under]] : []),
  ]);
  const blockedBy = (increment: ArcView["increments"][number]) => (increment.fields.capabilities ?? []).map((capability) => holding.get(capability)).find((holder) => holder !== undefined && holder !== increment.id);
  const questionTitles = new Map(snapshot.arcs.flatMap(({ questions }) => questions.map((question): [string, string] => [question.id, question.fields.title])));
  const lanes = snapshot.arcs.filter(({ state }) => state === scope).map((view): Lane => {
    const { arc, increments, questions } = view;
    const holders = agents.onArc(increments);
    const ordered = [...increments].sort((a, b) => {
      const aClosed = a.fields.status === "closed", bClosed = b.fields.status === "closed";
      if (aClosed !== bClosed) return aClosed ? -1 : 1;
      const aTime = aClosed ? a.fields.outcome?.date ?? a.updatedAt : a.fields.parked ?? a.createdAt;
      const bTime = bClosed ? b.fields.outcome?.date ?? b.updatedAt : b.fields.parked ?? b.createdAt;
      return time(aTime) - time(bTime) || a.id.localeCompare(b.id);
    });
    const bars = ordered.map((increment): Bar => {
      const claim = agents.on(increment.id);
      const noteWaits = snapshot.waitsFor?.[increment.id] ?? [];
      const behind = questionsBehind(increment.id, snapshot);
      const reading = incrementState(increment.fields, { waits: snapshot.waits[increment.id] ?? [], heldOn: snapshot.heldOn[increment.id] ?? [], waitsFor: noteWaits, behind, ...(claim ? { claim } : {}), ...(increment.fields.status === "closed" ? {} : withBlocker(blockedBy(increment))) });
      return { id: increment.id, title: increment.fields.title, reading,
        agents: claim ? [claim] : [], waits: waits.on(increment.id), noteWaits,
        questionsBehind: (reading.behind ?? []).map((question) => questionTitles.get(question) ?? question), holdsUp: waits.heldUpBy(increment.id),
        ...(reading.blockedBy ? { blockedBy: names.find(({ id }) => id === reading.blockedBy) ?? { id: reading.blockedBy, title: reading.blockedBy } } : {}) };
    });
    const state = arcState(view.state, { openQuestions: questions.filter(({ fields }) => fields.lifecycle === "open").length, waits: snapshot.waits[arc.id] ?? [], claims: holders, increments: bars.map(({ reading }) => reading) });
    const landed = bars.filter(({ reading }) => reading.state === "landed").length;
    const failed = bars.filter(({ reading }) => reading.state === "not-completed").length;
    const open = bars.length - landed - failed;
    const count = [[landed, "landed"], [failed, "not completed"], [open, "open"]].filter(([n]) => n).map(([n, label]) => `${n} ${label}`).join(" · ") || "No increments";
    const work = new Set(increments.flatMap((increment) => [increment.id, ...(increment.fields.capabilities ?? [])]));
    const workLines = lines.filter((line) => ("increment" in line && work.has(line.increment ?? "")) || ("capability" in line && work.has(line.capability ?? "")));
    const lastActivity = Math.max(time(arc.updatedAt), ...increments.map((i) => time(i.updatedAt)), ...questions.map((q) => time(q.updatedAt)), ...holders.map((h) => time(h.lastSeenAt)), ...workLines.map((line) => time(line.at)));
    const idleChip = (agents: readonly BoardAgent[]) => `in progress · idle ${Math.min(...agents.map(({ quietMinutes }) => quietMinutes))} min`;
    const idleHolders = holders.filter(({ holder }) => holder === "idle");
    const chip = state === "idle" ? idleChip(holders)
      : state === "ready" ? `ready · ${bars.filter(({ reading }) => reading.state === "open").length} to take` : state.replaceAll("-", " ");
    // A queued lane names what its increments wait on, once per blocker (ADR-0760 D1; counted in its hourglass mark, ADR-0980).
    const laneWaits = state !== "queued" ? waits.on(arc.id)
      : [...new Map(bars.flatMap((bar) => bar.waits).map((wait) => [wait.id, wait])).values()];
    const noteWaits = bars.flatMap((bar) => bar.noteWaits.filter(({ holds }) => holds).map((wait): LaneNoteWait => ({ ...wait, increment: { id: bar.id, title: bar.title } })));
    return { id: arc.id, title: arc.fields.title, ...(arc.fields.priority === undefined ? {} : { priority: arc.fields.priority }), view, bars, agents: holders, state, chip, ...(state === "ready" && idleHolders.length ? { idle: { chip: idleChip(idleHolders), agents: idleHolders } } : {}), count, lastActivity, waits: laneWaits, noteWaits, holdsUp: waits.heldUpBy(arc.id) };
  // ADR-0963 D2: ranked arcs first, 1 first, unranked last; one priority keeps the state and activity order.
  }).sort((a, b) => (a.priority ?? Infinity) - (b.priority ?? Infinity) || rank[a.state] - rank[b.state] || b.lastActivity - a.lastActivity || a.id.localeCompare(b.id));
  return { scope, lanes, queues: arcQueues(lanes), selected: firstBriefing(lanes.map((lane) => ({ id: lane.id, parked: lane.view.state === "parked", questions: lane.view.questions }))) };
}
