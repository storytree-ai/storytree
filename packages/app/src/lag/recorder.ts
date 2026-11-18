// Capability 5 · Recorder
import { isSettled, turnFrames, type LagAction, type PageState } from "@storytree/forest/actions";

import type { LagReading } from "./bridge.js";

export type Entry = { start: number; duration: number };

const FRAMES_AFTER_SETTLED = 2;
const KEEP_ENTRIES_MS = 30_000;

function fieldActions(catalogue: readonly LagAction[]): (LagAction & { field: string })[] {
  const byField = new Map<string, LagAction & { field: string }>();
  for (const action of catalogue) if (action.field !== undefined && !byField.has(action.field)) byField.set(action.field, { ...action, field: action.field });
  return [...byField.values()];
}

export function settledFrom(action: LagAction, start: PageState, page: PageState): { island?: string } | false {
  const island = action.settled.selected === "island" ? page.selected : undefined;
  if (action.settled.selected === "island" && (island === undefined || island === start.selected)) return false;
  if (action.settled.note === "any" && page.note === start.note) return false;
  if (!isSettled(action.settled, page, island)) return false;
  if (island === undefined && action.settled.note === undefined && isSettled(action.settled, start)) return false;
  return island === undefined ? {} : { island };
}

export interface RecorderOptions {
  catalogue: readonly LagAction[];
  send(readings: LagReading[]): Promise<void>;
  size?(story: string): number | undefined;
}

type Pending = {
  at: number;
  start: PageState;
  progress: boolean;
  answered: boolean;
  last?: PageState;
  settled?: { action: LagAction & { field: string }; at: number; island?: string; frames: number };
};

const answered = (start: PageState, page: PageState) => page.progress || page.selected !== start.selected || page.note !== start.note
  || page.panelOpen !== start.panelOpen || page.mode !== start.mode || page.sessionSelected !== start.sessionSelected;

type Turning = { at: number; view: "forest" | "library"; moved: boolean; frames: number[]; movedAt: number; stirred: boolean; ended?: { at: number; frames: number } };

export function createRecorder(options: RecorderOptions) {
  const actions = fieldActions(options.catalogue);
  const turnActions = options.catalogue.filter((action): action is LagAction & { field: string } => action.turns !== undefined && action.field !== undefined);
  const limitMs = Math.max(0, ...actions.map((action) => action.limitMs));
  let events: Entry[] = [];
  let frames: Entry[] = [];
  let readings: LagReading[] = [];
  let pending: Pending | undefined;
  let turning: Turning | undefined;
  let flushWanted = false;

  function send(): void {
    flushWanted = false;
    if (readings.length === 0) return;
    const batch = readings;
    readings = [];
    void options.send(batch).catch(() => { });
  }

  function end(): void {
    pending = undefined;
    if (flushWanted && turning === undefined) send();
  }

  function endTurn(done: Turning): void {
    turning = undefined;
    const action = turnActions.find((one) => one.turns === done.view), ended = done.ended;
    if (done.moved && ended !== undefined && action !== undefined) {
      const loaf = frames.filter((e) => e.start + e.duration >= done.at && e.start <= ended.at);
      const read = turnFrames(done.frames, action.budget.frameMs);
      readings.push({
        name: action.field, response: 0, longFrames: loaf.length, longestFrame: Math.round(Math.max(0, ...loaf.map((e) => e.duration))), settled: 0, progress: false,
        frames: { p50: Math.round(read.p50), p95: Math.round(read.p95), max: Math.round(read.max), over: read.over },
      });
    }
    if (flushWanted && pending === undefined) send();
  }

  function finish(done: NonNullable<Pending["settled"]>, from: Pending): void {
    const ev = events.filter((e) => e.start >= from.at && e.start <= done.at);
    const loaf = frames.filter((e) => e.start + e.duration >= from.at && e.start <= done.at);
    const size = done.island === undefined ? undefined : options.size?.(done.island);
    readings.push({
      name: done.action.field,
      response: Math.round(Math.max(0, ...ev.map((e) => e.duration))),
      longFrames: loaf.length,
      longestFrame: Math.round(Math.max(0, ...loaf.map((e) => e.duration))),
      settled: Math.round(done.at - from.at),
      progress: from.progress,
      ...(size === undefined ? {} : { size }),
    });
  }

  return {
    get pending(): boolean {
      return pending !== undefined || turning !== undefined;
    },
    turnStart(at: number, view: "forest" | "library"): void {
      turning = { at, view, moved: false, frames: [], movedAt: at, stirred: false };
    },
    turnMove(): void {
      if (turning !== undefined && turning.ended === undefined) turning.moved = turning.stirred = true;
    },
    turnFrame(at: number): void {
      const under = turning;
      if (under === undefined) return;
      if (under.ended !== undefined) {
        if (++under.ended.frames >= FRAMES_AFTER_SETTLED) endTurn(under);
        return;
      }
      if (under.stirred) [under.movedAt, under.stirred] = [at, false];
      if (at - under.movedAt > limitMs) endTurn(under);
      else under.frames.push(at);
    },
    turnEnd(at: number): void {
      if (turning !== undefined && turning.ended === undefined) turning.ended = { at, frames: 0 };
    },
    input(at: number, start: PageState): void {
      const working = pending !== undefined && pending.answered && pending.last !== undefined && (!pending.last.still || pending.last.progress);
      if (pending?.settled === undefined && !working) pending = { at, start, progress: false, answered: false };
    },
    scripted(): void {
      if (pending !== undefined && pending.settled === undefined) end();
    },
    frame(at: number, page: PageState): void {
      const under = pending;
      if (under === undefined) return;
      if (under.settled !== undefined) {
        if (++under.settled.frames < FRAMES_AFTER_SETTLED) return;
        finish(under.settled, under);
        end();
        return;
      }
      if (page.progress) under.progress = true;
      if (answered(under.start, page)) under.answered = true;
      under.last = page;
      for (const action of actions) {
        const settled = settledFrom(action, under.start, page);
        if (settled === false) continue;
        under.settled = { action, at, frames: 0, ...settled };
        return;
      }
      if (at - under.at > limitMs) end();
    },
    observe(entries: { events?: readonly Entry[]; frames?: readonly Entry[] }): void {
      const latest = Math.max(0, ...[...(entries.events ?? []), ...(entries.frames ?? [])].map((e) => e.start));
      const kept = (e: Entry) => e.start >= latest - KEEP_ENTRIES_MS;
      events = [...events, ...(entries.events ?? [])].filter(kept);
      frames = [...frames, ...(entries.frames ?? [])].filter(kept);
    },
    flush(): void {
      if (pending === undefined && turning === undefined) send();
      else flushWanted = true;
    },
  };
}

export type Recorder = ReturnType<typeof createRecorder>;
