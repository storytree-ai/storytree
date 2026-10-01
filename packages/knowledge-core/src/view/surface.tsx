/**
 * Capability 4's surface (the knowledge core story): everything the knowledge core shows, owned
 * here so the app only mounts it (ADR-0649 D2). The app makes one core per project it shows,
 * hands it the library's change history and the activity log's new lines as they come, and mounts
 * `KnowledgeGlobePoints` under the globe's islands and `KnowledgeNoteCard` in the story-panel slot.
 * The core keeps its own reads, selected session, windows and pin.
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";

import type { Line, SessionWindow } from "@storytree/agent-link";
import type { Change } from "@storytree/library";

import { knowledge, storedEdges } from "../ghosts/ghosts.js";
import { ORCHESTRATOR, lighting, noteCard, trails as readingPaths, agentPaths, stampOpens, traversalTrails, windowReplays, windowView, fileStop, type CodePlaces, type CodeState, type Point, type RosterEntry } from "../look-inside/look-inside.js";
import { ReadRecord } from "../reads/reads.js";
import { underShelves } from "../shelves/shelves.js";
import { globePoints } from "../shelves/positions.js";
import { GlobePoints } from "./globe-points.js";
import { NoteCard } from "./drawing.js";

/** How often the selected session's window, or every listed session's with none selected, is read again, as often as the sessions list's bars. */
const WINDOW_EVERY_MS = 10_000;

/** The one read the core makes beyond what it is handed: a session's window (agent link 9.10), from the host: the selected session's, or every listed session's in one ask with none selected (ADR-0754 D1). */
export interface CoreReads {
  windowReading(project: string, session: string): Promise<SessionWindow>;
  windowReadings(project: string, sessions: readonly string[]): Promise<readonly SessionWindow[]>;
}

interface State {
  history: readonly Change[];
  /** Bumped whenever the reads change, since the record itself is kept in place. */
  version: number;
  /** Undefined shows every listed running session at once (ADR-0738 D1). */
  session: string | undefined;
  roster: readonly RosterEntry[];
  pinned: string | undefined;
  /** The selected session's window, once read. */
  window: SessionWindow | undefined;
  /** Each listed session's (and child's) window, once read, drawn with no session selected (ADR-0754 D1). */
  windows: ReadonlyMap<string, SessionWindow>;
  /** When each of those windows' opens was first seen, so only new ones grow (ADR-0742 D4). */
  stamps: ReadonlyMap<string, readonly number[]>;
}

/** One project's knowledge core: its inputs, its controls, and a subscription for the pieces. */
export interface KnowledgeCore {
  /** The library's whole change history and the activity log's lines since the last call. */
  take(history: readonly Change[], lines: readonly Line[]): void;
  /** The note whose card is open, shared by the globe's dots and the card. */
  pin(note: string | undefined): void;
  /** The running sessions the host lists, lit together while none is selected (ADR-0738 D2), each from its window when the host reads one (ADR-0754 D1). */
  showRoster(roster: readonly RosterEntry[]): void;
  /** Drill into one session's traversal, or back to every running session with undefined (ADR-0738 D5). */
  select(session: string | undefined): void;
  /** Hears the selection, wherever it was made. */
  onSelect(listener: (session: string | undefined) => void): () => void;
  /** Stop the window reads' timers. */
  dispose(): void;
}

interface Store extends KnowledgeCore {
  readonly reads: ReadRecord;
  get(): State;
  set(next: Partial<State>): void;
  subscribe(listener: () => void): () => void;
}

/** A knowledge core for `project`; with `reads`, a selected session's window is drawn too (ADR-0746 D1). */
export function createKnowledgeCore(project: string, { reads: host }: { reads?: CoreReads } = {}): KnowledgeCore {
  const reads = new ReadRecord(project);
  const listeners = new Set<() => void>();
  const selections = new Set<(session: string | undefined) => void>();
  let state: State = {
    history: [], version: 0, session: undefined, roster: [], pinned: undefined, window: undefined,
    windows: new Map(), stamps: new Map(),
  };
  let windowTimer: ReturnType<typeof setInterval> | undefined;
  let rosterTimer: ReturnType<typeof setInterval> | undefined;
  /** The latest log line or window open seen, after which a newly seen open is stamped. */
  let clock = 0;
  /**
   * Whether a round of window reads is out. One is never started over another: each read goes
   * through the host's database, and rounds that overlap keep it so busy that a selected session's
   * own read times out and nothing is drawn (measured with 18 listed sessions, 2026-10-01).
   */
  let rosterOut = false;
  /** The selected session whose window is being read, so a slow read is not asked again over itself. */
  let windowOut: string | undefined;
  const listedMembers = (): Set<string> => new Set(state.roster.flatMap(({ members }) => members));
  /**
   * Read every listed session's window while none is selected (ADR-0754 D1), in one ask, or, with
   * `only`, those not read yet. A session that has left the list meanwhile is dropped; a failed read keeps the last.
   */
  const readRosterWindows = (only = false): void => {
    if (host === undefined || state.session !== undefined || rosterOut) return;
    const members = [...listedMembers()].filter((member) => !only || !state.windows.has(member));
    if (members.length === 0) return;
    rosterOut = true;
    host.windowReadings(project, members).then((windows) => {
      const listed = listedMembers();
      const read = new Map(state.windows);
      const stamps = new Map(state.stamps);
      windows.forEach((window, index) => {
        const member = members[index]!;
        if (!listed.has(member)) return;
        if (!("absent" in window)) {
          const stamped = stampOpens(state.stamps.get(member), window.opens.length, clock);
          clock = stamped.clock;
          stamps.set(member, stamped.stamps);
        }
        read.set(member, window);
      });
      store.set({ windows: read, stamps });
    }, () => {
      // A failed read leaves the windows as they were; the next round tries again.
    }).finally(() => { rosterOut = false; });
  };
  /** Read the selected session's window, never over its own last read; an answer for a session no longer selected is dropped. */
  const readWindow = (session: string): void => {
    if (host === undefined || windowOut === session) return;
    windowOut = session;
    host.windowReading(project, session).then((window) => {
      if (state.session === session) store.set({ window });
    }, () => {
      // A failed read leaves the window as it was; the next one tries again.
    }).finally(() => { if (windowOut === session) windowOut = undefined; });
  };
  const store: Store = {
    reads,
    pin: pinned => store.set({ pinned }),
    showRoster(roster) {
      const members = new Set(roster.flatMap(({ members: listed }) => listed));
      const kept = <T,>(map: ReadonlyMap<string, T>) => new Map([...map].filter(([member]) => members.has(member)));
      store.set({ roster, windows: kept(state.windows), stamps: kept(state.stamps) });
      readRosterWindows(true);
      if (host !== undefined && rosterTimer === undefined) rosterTimer = setInterval(() => readRosterWindows(), WINDOW_EVERY_MS);
    },
    select(session) {
      if (session === state.session) return;
      if (windowTimer !== undefined) clearInterval(windowTimer);
      windowTimer = undefined;
      store.set({ session, window: undefined });
      if (session !== undefined && host !== undefined) {
        readWindow(session);
        windowTimer = setInterval(() => readWindow(session), WINDOW_EVERY_MS);
      } else readRosterWindows();
      for (const listener of selections) listener(session);
    },
    onSelect(listener) {
      selections.add(listener);
      return () => selections.delete(listener);
    },
    get: () => state,
    set(next) {
      state = { ...state, ...next };
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    take(history, lines) {
      reads.add(lines);
      for (const { seq } of lines) clock = Math.max(clock, seq);
      // The same history again keeps its knowledge: only lines came (ADR-0836 D1).
      store.set({ history: history.length === state.history.length ? state.history : [...history], version: state.version + 1 });
    },
    dispose() {
      if (windowTimer !== undefined) clearInterval(windowTimer);
      if (rosterTimer !== undefined) clearInterval(rosterTimer);
      listeners.clear();
      selections.clear();
    },
  };
  return store;
}

/** A listed session's colour, found by its own id or a child's. */
function colourOf(roster: readonly RosterEntry[], session: string | undefined): string | undefined {
  return session === undefined ? undefined : roster.find(({ members }) => members.includes(session))?.colour;
}

/** The pinned note's card, mounted in the globe's right-side story-panel slot. */
export function KnowledgeNoteCard({ core, onClose }: { core: KnowledgeCore; onClose: () => void }) {
  const store = core as Store;
  const state = useSyncExternalStore(store.subscribe, store.get);
  const known = useMemo(() => knowledge(state.history), [state.history]);
  const card = state.pinned === undefined ? undefined : noteCard(state.pinned, known);
  useEffect(() => {
    // A live retirement removes the card as well as its dot. Defer until React's commit ends.
    let mounted = true;
    if (state.pinned !== undefined && card === undefined) queueMicrotask(() => { if (mounted) onClose(); });
    return () => { mounted = false; };
  }, [state.pinned, card, onClose]);
  return card === undefined ? null : <NoteCard card={card} onClose={onClose} />;
}

/** Knowledge under the globe's islands, without story text, ghosts or replay: faint, or lit by the running sessions' reads (ADR-0738), with a selected session's window (ADR-0746 D1). */
export function KnowledgeGlobePoints({ core, spots, radius, places }: {
  core: KnowledgeCore; spots: ReadonlyMap<string, Point>; radius: number;
  /** The code's surface, as the forest lays it on the globe (ADR-0804 D5): a selected session's file opens are stops on it, and a step to or from one crosses it. */
  places?: CodePlaces;
}) {
  const store = core as Store;
  const state = useSyncExternalStore(store.subscribe, store.get);
  const known = useMemo(() => knowledge(state.history), [state.history]);
  const points = useMemo(() => globePoints(underShelves(state.history, known), spots, radius, known.notes), [state.history, known, spots, radius]);
  // With none selected, every listed session is drawn from its window, or its log's reads when it has none (ADR-0754 D1).
  const windowed = useMemo(() => windowReplays(state.windows, new Set(known.notes.keys()), state.stamps), [state.windows, state.stamps, known]);
  const lit = useMemo(() => lighting(store.reads, state.roster, state.session, new Set(known.notes.keys()), windowed),
    // The record is kept in place, so its version stands in for its reads.
    [store.reads, state.version, state.roster, state.session, known, windowed]);
  const paths = useMemo(() => readingPaths(store.reads, state.roster, state.session, new Set(known.notes.keys()), windowed),
    [store.reads, state.version, state.roster, state.session, known, windowed]);
  const replays = useMemo(() => agentPaths(store.reads, state.roster, state.session, new Set(known.notes.keys()), windowed),
    [store.reads, state.version, state.roster, state.session, known, windowed]);
  const joined = useMemo(() => storedEdges(known), [known]);
  const colour = colourOf(state.roster, state.session) ?? ORCHESTRATOR;
  // Only a selected session's window is drawn, never every running session's at once (ADR-0746 D1).
  const window = useMemo(() => state.session === undefined || state.window === undefined ? undefined
    : { ...windowView(state.window, new Set(known.notes.keys()), joined, places), colour }, [state.session, state.window, known, joined, colour, places]);
  const stops = useMemo(() => places === undefined ? undefined : new Map([...places.files].map(([key, at]) => [fileStop(key), at] as const)), [places]);
  // A selected session is drawn as its window's traversal, one line per step (ADR-0756); its log's reading-path
  // curves and their glow draw only when it has no window to read, and nothing is drawn while the window is read.
  const traversal = useMemo(() => window === undefined ? undefined : traversalTrails(window.steps, colour, state.session!), [window, colour, state.session]);
  const drawnPaths = state.session === undefined || window?.status !== undefined ? paths : traversal ?? [];
  // A selected session replays as one head over its drawn steps instead of a glow per agent (ADR-0797); with none selected every agent glows (ADR-0742 D3).
  const glows = state.session === undefined ? replays : [];
  // A new selection starts its own history, so lines already taken when it opens do not grow (ADR-0742 D4).
  return <GlobePoints key={state.session ?? ""} points={points} radius={radius} notes={known.notes} lit={lit} trails={drawnPaths} paths={glows} window={window} replay={state.session !== undefined} stops={stops} />;
}

/** The land a selected session's window has opened (ADR-0804 D5), for the forest to light: the files and capabilities it opened, and the colour it wears. */
export interface CodeLighting {
  files: ReadonlyMap<string, CodeState>;
  capabilities: ReadonlyMap<string, CodeState>;
  colour: string;
}

const NOTHING_LIT: ReadonlyMap<string, CodeState> = new Map();

/** What a selected session's window has lit on the land; nothing while none is selected or its window is not read yet. */
export function useCodeLighting(core: KnowledgeCore, places: CodePlaces | undefined): CodeLighting {
  const store = core as Store;
  const state = useSyncExternalStore(store.subscribe, store.get);
  const colour = colourOf(state.roster, state.session) ?? ORCHESTRATOR;
  return useMemo(() => {
    if (places === undefined || state.session === undefined || state.window === undefined) return { files: NOTHING_LIT, capabilities: NOTHING_LIT, colour };
    const { code } = windowView(state.window, new Set(), () => false, places);
    return { ...code, colour };
  }, [places, state.session, state.window, colour]);
}
