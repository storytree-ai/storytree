/**
 * Capability 5 · Recorder. The field recorder's core (ADR-1001 D4): it is told of each trusted input with what the page showed at
 * it, of the page each frame while an action is under way, and of the browser's own entries (Event Timing, Long Animation Frames),
 * and turns each catalogue action its user takes into one reading. It never reads the page or the clock itself, so view.ts wires
 * it to the browser and the tests drive it with recorded entries.
 */
import { isSettled, type LagAction, type PageState } from "@storytree/forest/actions";

import type { LagReading } from "./bridge.js";

/** A browser entry, by its start and duration on the page's clock (performance.now()). */
export type Entry = { start: number; duration: number };

/** Event Timing reports an input after the paint: a reading is finished this many frames after settled. */
const FRAMES_AFTER_SETTLED = 2;
/** How long entries are kept for an action to claim: longer than any action's limit. */
const KEEP_ENTRIES_MS = 30_000;

/** The catalogue's field actions: one entry per field name, the first that carries it. */
function fieldActions(catalogue: readonly LagAction[]): (LagAction & { field: string })[] {
  const byField = new Map<string, LagAction & { field: string }>();
  for (const action of catalogue) if (action.field !== undefined && !byField.has(action.field)) byField.set(action.field, { ...action, field: action.field });
  return [...byField.values()];
}

/**
 * The story `page` shows `action` settled for, given what the page showed at the input (`start`), or false when it does not. The
 * field knows no island it clicked: an island action settles on a story selected that was not, a note action on a note that was
 * not on show, and any other on settled when it was not settled at the input.
 */
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
  /** Hands a batch of readings to the app. Called only by flush, and only when no action is under way. */
  send(readings: LagReading[]): Promise<void>;
  /** How many capabilities a story's island has, if known. */
  size?(story: string): number | undefined;
}

type Pending = {
  at: number;
  start: PageState;
  progress: boolean;
  /** The page has shown an answer since the input: something selected, opened or switched, or progress on show. */
  answered: boolean;
  /** The page at the latest frame. */
  last?: PageState;
  settled?: { action: LagAction & { field: string }; at: number; island?: string; frames: number };
};

/** Whether `page` shows an answer to an input made while it showed `start`; the globe turning is no answer. */
const answered = (start: PageState, page: PageState) => page.progress || page.selected !== start.selected || page.note !== start.note
  || page.panelOpen !== start.panelOpen || page.mode !== start.mode || page.sessionSelected !== start.sessionSelected;

export function createRecorder(options: RecorderOptions) {
  const actions = fieldActions(options.catalogue);
  const limitMs = Math.max(0, ...actions.map((action) => action.limitMs));
  let events: Entry[] = [];
  let frames: Entry[] = [];
  let readings: LagReading[] = [];
  let pending: Pending | undefined;
  /** A flush was asked for while an action was under way: it goes as soon as that action ends. */
  let flushWanted = false;

  function send(): void {
    flushWanted = false;
    if (readings.length === 0) return;
    const batch = readings;
    readings = [];
    void options.send(batch).catch(() => { /* Observation never breaks the app it observes. */ });
  }

  /** The action under way is over, recorded or not. */
  function end(): void {
    pending = undefined;
    if (flushWanted) send();
  }

  function finish(done: NonNullable<Pending["settled"]>, from: Pending): void {
    const ev = events.filter((e) => e.start >= from.at && e.start <= done.at);
    const loaf = frames.filter((e) => e.start + e.duration >= from.at && e.start <= done.at);
    const size = done.island === undefined ? undefined : options.size?.(done.island);
    // Kept to the whole millisecond: the browser's own entries are no finer than that.
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
    /** Whether an action is under way: from an input until its reading is finished or its limit passes. */
    get pending(): boolean {
      return pending !== undefined;
    },
    /**
     * A trusted input at `at`, with what the page showed then. While the page is still working on the input under way (it has
     * answered it, and the globe is moving or progress is on show), a later input belongs to it: an impatient second click.
     * Otherwise the later input restarts the watch, so an input the page showed no answer to (a drag, Escape with nothing open)
     * or one it has finished answering (switching to the Library) never holds the time of the action that follows it.
     */
    input(at: number, start: PageState): void {
      const working = pending !== undefined && pending.answered && pending.last !== undefined && (!pending.last.still || pending.last.progress);
      if (pending?.settled === undefined && !working) pending = { at, start, progress: false, answered: false };
    },
    /** The page as it showed at a frame. */
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
    /** The browser's entries as its observers deliver them. */
    observe(entries: { events?: readonly Entry[]; frames?: readonly Entry[] }): void {
      const latest = Math.max(0, ...[...(entries.events ?? []), ...(entries.frames ?? [])].map((e) => e.start));
      const kept = (e: Entry) => e.start >= latest - KEEP_ENTRIES_MS;
      events = [...events, ...(entries.events ?? [])].filter(kept);
      frames = [...frames, ...(entries.frames ?? [])].filter(kept);
    },
    /**
     * Hand the readings taken so far to the app in one batch, none when there are none. While an action is under way the batch
     * waits until it ends, so nothing is sent between an input and its settling.
     */
    flush(): void {
      if (pending === undefined) send();
      else flushWanted = true;
    },
  };
}

export type Recorder = ReturnType<typeof createRecorder>;
