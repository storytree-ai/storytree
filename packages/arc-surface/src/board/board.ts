import type { Line } from "@storytree/agent-link";
import type { ArcView, Hold } from "@storytree/library";
import { agentsOnBoard, type BoardAgent } from "../agents/agents.js";
import { firstBriefing } from "../briefing/briefing.js";
import { arcQueues, waitsOnBoard, type ArcQueue, type NamedWait, type WorkName } from "../waits/waits.js";
import { arcState, incrementState, type ArcState, type IncrementReading } from "../work-states/board-states.js";

export type BoardScope = "active" | "parked" | "closed";
export interface BoardSnapshot {
  arcs: ArcView[];
  waits: Record<string, Hold[]>;
  heldOn: Record<string, string[]>;
}
export interface Bar {
  id: string;
  title: string;
  reading: IncrementReading;
  agents: BoardAgent[];
  waits: NamedWait[];
  holdsUp: (WorkName & { reason: string })[];
}
export interface Lane {
  id: string;
  title: string;
  view: ArcView;
  bars: Bar[];
  agents: BoardAgent[];
  state: ArcState;
  chip: string;
  count: string;
  lastActivity: number;
  waits: NamedWait[];
  holdsUp: (WorkName & { reason: string })[];
}
export interface BoardView {
  scope: BoardScope;
  lanes: Lane[];
  queues: ArcQueue[];
  selected: string | undefined;
}
const rank: Record<ArcState, number> = { waiting: 0, blocked: 1, claimed: 2, idle: 3, quiet: 4, parked: 5, closed: 6 };
const time = (at: string) => Date.parse(at) || 0;

export function boardView(snapshot: BoardSnapshot, lines: readonly Line[], now: Date, scope: BoardScope = "active", quietMs?: number): BoardView {
  const agents = agentsOnBoard(lines, now, quietMs);
  const names = snapshot.arcs.flatMap(({ arc, increments }): WorkName[] => [
    { id: arc.id, title: arc.fields.title },
    ...increments.map((increment) => ({ id: increment.id, title: increment.fields.title, arc: { id: arc.id, title: arc.fields.title } })),
  ]);
  const waits = waitsOnBoard(names, new Map(Object.entries(snapshot.waits)));
  const lanes = snapshot.arcs.filter(({ state }) => state === scope).map((view): Lane => {
    const { arc, increments, questions } = view;
    const holders = agents.onArc(increments);
    const state = arcState(view.state, { openQuestions: questions.filter(({ fields }) => fields.lifecycle === "open").length, waits: snapshot.waits[arc.id] ?? [], claims: holders });
    const ordered = [...increments].sort((a, b) => {
      const aClosed = a.fields.status === "closed", bClosed = b.fields.status === "closed";
      if (aClosed !== bClosed) return aClosed ? -1 : 1;
      const aTime = aClosed ? a.fields.outcome?.date ?? a.updatedAt : a.fields.parked ?? a.createdAt;
      const bTime = bClosed ? b.fields.outcome?.date ?? b.updatedAt : b.fields.parked ?? b.createdAt;
      return time(aTime) - time(bTime) || a.id.localeCompare(b.id);
    });
    const bars = ordered.map((increment): Bar => {
      const claim = agents.on(increment.id);
      return { id: increment.id, title: increment.fields.title,
        reading: incrementState(increment.fields, { waits: snapshot.waits[increment.id] ?? [], heldOn: snapshot.heldOn[increment.id] ?? [], ...(claim ? { claim } : {}) }),
        agents: agents.onArc([increment]), waits: waits.on(increment.id), holdsUp: waits.heldUpBy(increment.id) };
    });
    const landed = bars.filter(({ reading }) => reading.state === "landed").length;
    const failed = bars.filter(({ reading }) => reading.state === "not-completed").length;
    const open = bars.length - landed - failed;
    const count = [[landed, "landed"], [failed, "not completed"], [open, "open"]].filter(([n]) => n).map(([n, label]) => `${n} ${label}`).join(" · ") || "No increments";
    const work = new Set(increments.flatMap((increment) => [increment.id, ...(increment.fields.touches ?? [])]));
    const workLines = lines.filter((line) => ("increment" in line && work.has(line.increment ?? "")) || ("capability" in line && work.has(line.capability ?? "")));
    const lastActivity = Math.max(time(arc.updatedAt), ...increments.map((i) => time(i.updatedAt)), ...questions.map((q) => time(q.updatedAt)), ...holders.map((h) => time(h.lastSeenAt)), ...workLines.map((line) => time(line.at)));
    const chip = state === "idle" ? `idle · ${Math.min(...holders.map(({ quietMinutes }) => quietMinutes))} min` : state;
    return { id: arc.id, title: arc.fields.title, view, bars, agents: holders, state, chip, count, lastActivity, waits: waits.on(arc.id), holdsUp: waits.heldUpBy(arc.id) };
  }).sort((a, b) => rank[a.state] - rank[b.state] || b.lastActivity - a.lastActivity || a.id.localeCompare(b.id));
  return { scope, lanes, queues: arcQueues(lanes), selected: firstBriefing(lanes.map((lane) => ({ id: lane.id, questions: lane.view.questions }))) };
}
