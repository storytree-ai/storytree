// Capability 3 · Arc surface.
import { inCi, logReading, pullOf, type LogReading } from "@storytree/session-management/readings";
import type { BoardArcView, Hold, Line, NoteWait, PrCutover } from "@storytree/library";
import type { ClosedRange } from "./closed-range.js";
import { ciEstimate, ciLegs, type CiBar, type CiExpected } from "./ci-bars.js";
import { agentsOnBoard, type ArcWork, type BoardAgent } from "../agents/agents.js";
import { arcQueues, waitsOnBoard, type ArcQueue, type NamedWait, type WorkName } from "../waits/waits.js";
import { arcState, incrementState, questionsBehind, type ArcState, type IncrementReading } from "../work-states/board-states.js";

export type BoardScope = "active" | "parked" | "closed";
export interface BoardSnapshot {
  arcs: BoardArcView[];
  waits: Record<string, Hold[]>;
  heldOn: Record<string, string[]>;
  waitsFor?: Record<string, NoteWait[]>;
  cutover?: PrCutover;
}
export interface Bar {
  id: string;
  title: string;
  reading: IncrementReading;
  agents: BoardAgent[];
  waits: NamedWait[];
  noteWaits: NoteWait[];
  questionsBehind: string[];
  holdsUp: (WorkName & { reason: string })[];
  blockedBy?: WorkName;
}
export interface LaneNoteWait extends NoteWait {
  increment: { id: string; title: string };
}
export interface Lane {
  id: string;
  title: string;
  priority?: number;
  view: BoardArcView;
  bars: Bar[];
  ci: CiBar[];
  agents: BoardAgent[];
  state: ArcState;
  chip: string;
  idle?: { chip: string; agents: BoardAgent[] };
  count: string;
  lastActivity: number;
  waits: NamedWait[];
  noteWaits: LaneNoteWait[];
  holdsUp: (WorkName & { reason: string })[];
  cutover?: PrCutover;
}
export interface BoardView {
  scope: BoardScope;
  lanes: Lane[];
  queues: ArcQueue[];
  closed?: { range: ClosedRange; from: string; to: string; reading: boolean };
}
const rank: Record<ArcState, number> = { waiting: 0, blocked: 1, queued: 1, "in-progress": 2, idle: 3, ready: 4, quiet: 5, parked: 6, closed: 7 };
const time = (at: string) => Date.parse(at) || 0;
const withBlocker = (holder: string | undefined) => (holder === undefined ? {} : { blockedBy: holder });

function readyChip(machines: readonly (string | undefined)[]): string {
  const untagged = machines.filter((machine) => machine === undefined).length;
  const tagged = [...new Set(machines.filter((machine) => machine !== undefined))].sort();
  return ["ready", ...(untagged ? [`${untagged} to take`] : []), ...tagged.map((machine) => `on ${machine}`)].join(" · ");
}

export function claimedNow(agents: readonly BoardAgent[], increments: readonly ArcWork[]): Map<string, Set<string>> {
  const live = agents.filter(({ holder }) => holder === "live");
  const held = new Set(live.flatMap(({ increment }) => (increment === undefined ? [] : [increment])));
  const claimed = new Map<string, Set<string>>();
  const add = (capability: string, holder: string) => claimed.set(capability, (claimed.get(capability) ?? new Set()).add(holder));
  for (const { capability, under, session } of live) if (capability !== undefined) add(capability, under ?? session);
  for (const { id, fields } of increments) if (held.has(id)) for (const capability of fields.capabilities ?? []) add(capability, id);
  return claimed;
}

export function claimWaitsNow(waits: Readonly<Record<string, Hold[]>>, claimed: ReadonlyMap<string, ReadonlySet<string>>): Record<string, Hold[]> {
  const heldElsewhere = (waiter: string, capability: string) => [...(claimed.get(capability) ?? [])].some((holder) => holder !== waiter);
  return Object.fromEntries(Object.entries(waits).map(([id, holds]) => [id, holds.filter(({ claim, on }) => claim !== true || heldElsewhere(id, on))]));
}

export function openCapabilities(view: Pick<BoardArcView, "increments">): string[] {
  return [...new Set(view.increments.filter(({ fields }) => fields.status !== "closed").flatMap(({ fields }) => fields.capabilities ?? []))].sort();
}

export function openContracts(view: Pick<BoardArcView, "increments">): string[] {
  return [...new Set(view.increments.filter(({ fields }) => fields.status !== "closed").flatMap(({ fields }) => (fields.links ?? []).filter((id) => id.startsWith("contract_"))))].sort();
}

export function boardView(snapshot: BoardSnapshot, log: readonly Line[] | LogReading, now: Date, scope: BoardScope = "active", quietMs?: number, expected: CiExpected = {}): BoardView {
  const logged = logReading(log);
  const { lines } = logged;
  const agents = agentsOnBoard(logged, now, quietMs);
  const claimed = claimedNow(agents.all, snapshot.arcs.flatMap(({ increments }) => increments));
  snapshot = { ...snapshot, waits: claimWaitsNow(snapshot.waits, claimed) };
  const names = snapshot.arcs.flatMap(({ arc, increments }): WorkName[] => [
    { id: arc.id, title: arc.fields.title },
    ...increments.map((increment) => ({ id: increment.id, title: increment.fields.title, arc: { id: arc.id, title: arc.fields.title } })),
  ]);
  const waits = waitsOnBoard(names, new Map(Object.entries(snapshot.waits)));
  const openWork = snapshot.arcs.flatMap(({ increments }) => increments).filter(({ fields }) => fields.status !== "closed");
  const live = agents.all.filter(({ holder }) => holder === "live");
  const holding = new Map<string, string>([
    ...openWork.filter(({ id }) => live.some((agent) => agent.increment === id)).flatMap(({ id, fields }) => (fields.capabilities ?? []).map((capability): [string, string] => [capability, id])),
    ...live.flatMap(({ capability, under }): [string, string][] => capability !== undefined && under !== undefined && openWork.some(({ id }) => id === under) ? [[capability, under]] : []),
  ]);
  const blockedBy = (increment: BoardArcView["increments"][number]) => (increment.fields.capabilities ?? []).map((capability) => holding.get(capability)).find((holder) => holder !== undefined && holder !== increment.id);
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
    const ci: CiBar[] = [];
    const bars = ordered.map((increment): Bar => {
      const claim = agents.on(increment.id);
      const noteWaits = snapshot.waitsFor?.[increment.id] ?? [];
      const behind = questionsBehind(increment.id, snapshot);
      const pr = increment.fields.status === "closed" || claim === undefined ? undefined : pullOf(claim.session);
      const pull = pr === undefined ? undefined : logged.fold.openPull(pr);
      const building = pull !== undefined && inCi(pull);
      const estimate = building ? ciEstimate(pull, expected) : undefined;
      if (building) ci.push({ pr: pull.number, increment: { id: increment.id, title: increment.fields.title }, legs: ciLegs(pull, expected, now), ...(estimate === undefined ? {} : { estimate }), seenAgo: Math.max(0, Math.floor((now.getTime() - Date.parse(pull.at)) / 60_000)) });
      const reading = incrementState(increment.fields, { waits: snapshot.waits[increment.id] ?? [], heldOn: snapshot.heldOn[increment.id] ?? [], waitsFor: noteWaits, behind, ...(claim ? { claim } : {}), ...(increment.fields.status === "closed" ? {} : withBlocker(blockedBy(increment))), ...(building ? { inCi: true } : {}) });
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
      : state === "ready" ? readyChip(ordered.filter((_, index) => bars[index]!.reading.state === "open").map(({ fields }) => fields.machine)) : state.replaceAll("-", " ");
    const laneWaits = state !== "queued" ? waits.on(arc.id)
      : [...new Map(bars.flatMap((bar) => bar.waits).map((wait) => [wait.id, wait])).values()];
    const noteWaits = bars.flatMap((bar) => bar.noteWaits.filter(({ holds }) => holds).map((wait): LaneNoteWait => ({ ...wait, increment: { id: bar.id, title: bar.title } })));
    return { id: arc.id, title: arc.fields.title, ...(arc.fields.priority === undefined ? {} : { priority: arc.fields.priority }), view, bars, ci, agents: holders, state, chip, ...(state === "ready" && idleHolders.length ? { idle: { chip: idleChip(idleHolders), agents: idleHolders } } : {}), count, lastActivity, waits: laneWaits, noteWaits, holdsUp: waits.heldUpBy(arc.id), ...(snapshot.cutover ? { cutover: snapshot.cutover } : {}) };
  }).sort((a, b) => (a.priority ?? Infinity) - (b.priority ?? Infinity) || rank[a.state] - rank[b.state] || b.lastActivity - a.lastActivity || a.id.localeCompare(b.id));
  return { scope, lanes, queues: arcQueues(lanes) };
}

export function ownerWaits(lane: Lane) {
  return { questions: lane.view.questions.filter(({ fields }) => fields.lifecycle === "open"), owners: lane.noteWaits.filter(({ releaser }) => releaser === "owner") };
}
export const ownerCount = (lane: Lane) => { const { questions, owners } = ownerWaits(lane); return questions.length + new Set(owners.map(({ note }) => note)).size; };
export const waitingOnYou = (board: BoardView) => board.lanes.reduce((sum, lane) => sum + ownerCount(lane), 0);
