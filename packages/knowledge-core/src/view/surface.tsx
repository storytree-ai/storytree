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
import { ORCHESTRATOR, lighting, noteCard, trails as readingPaths, traversalTrails, windowView, fileStop, type CodePlaces, type WindowState, type Point, type RosterEntry } from "../look-inside/look-inside.js";
import { ReadRecord } from "../reads/reads.js";
import { underShelves } from "../shelves/shelves.js";
import { globePoints } from "../shelves/positions.js";
import { GlobePoints, type CoreGrowth } from "./globe-points.js";
import { NoteCard } from "./drawing.js";

/** How often the selected session's window is read again, as often as the sessions list's bars. */
const WINDOW_EVERY_MS = 10_000;

/** The one read the core makes beyond what it is handed: the selected session's window (agent link 9.10), from the host; none with none selected (ADR-0921). */
export interface CoreReads {
  windowReading(project: string, session: string): Promise<SessionWindow>;
}

interface State {
  history: readonly Change[];
  /** Bumped whenever the reads change, since the record itself is kept in place. */
  version: number;
  /** Undefined shows no session's traversal (ADR-0921). */
  session: string | undefined;
  roster: readonly RosterEntry[];
  pinned: string | undefined;
  /** The selected session's window, once read. */
  window: SessionWindow | undefined;
}

/** One project's knowledge core: its inputs, its controls, and a subscription for the pieces. */
export interface KnowledgeCore {
  /** The library's whole change history and the activity log's lines since the last call. */
  take(history: readonly Change[], lines: readonly Line[]): void;
  /** The note whose card is open, shared by the globe's dots and the card. */
  pin(note: string | undefined): void;
  /** The running sessions the host lists, for a selected session's colour (ADR-0738 D2, D5). */
  showRoster(roster: readonly RosterEntry[]): void;
  /** Show one session's traversal, or none with undefined (ADR-0738 D5, ADR-0921). */
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
  };
  let windowTimer: ReturnType<typeof setInterval> | undefined;
  /** The selected session whose window is being read, so a slow read is not asked again over itself. */
  let windowOut: string | undefined;
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
    showRoster: roster => store.set({ roster }),
    select(session) {
      if (session === state.session) return;
      if (windowTimer !== undefined) clearInterval(windowTimer);
      windowTimer = undefined;
      store.set({ session, window: undefined });
      if (session !== undefined && host !== undefined) {
        readWindow(session);
        windowTimer = setInterval(() => readWindow(session), WINDOW_EVERY_MS);
      }
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
      // The same history again keeps its knowledge: only lines came (ADR-0836 D1).
      store.set({ history: history.length === state.history.length ? state.history : [...history], version: state.version + 1 });
    },
    dispose() {
      if (windowTimer !== undefined) clearInterval(windowTimer);
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

/** Knowledge under the globe's islands, without story text or ghosts: faint, or lit by a selected session's reads and window (ADR-0738 D5, ADR-0746 D1); with none selected, unlit (ADR-0921). */
export function KnowledgeGlobePoints({ core, spots, radius, places, growth }: {
  core: KnowledgeCore; spots: ReadonlyMap<string, Point>; radius: number;
  /** A replay to grow with (capability 1.9): the globe's growth reader, read inside the globe. */
  growth?: CoreGrowth | undefined;
  /** The code's surface, as the forest lays it on the globe (ADR-0804 D5): a selected session's file opens are stops on it, and a step to or from one crosses it. */
  places?: CodePlaces;
}) {
  const store = core as Store;
  const state = useSyncExternalStore(store.subscribe, store.get);
  const known = useMemo(() => knowledge(state.history), [state.history]);
  const points = useMemo(() => globePoints(underShelves(state.history, known), spots, radius, known.notes), [state.history, known, spots, radius]);
  // With none selected, no session's traversal shows (ADR-0921): nothing lights and no path draws.
  const lit = useMemo(() => lighting(store.reads, state.roster, state.session, new Set(known.notes.keys())),
    // The record is kept in place, so its version stands in for its reads.
    [store.reads, state.version, state.roster, state.session, known]);
  const paths = useMemo(() => readingPaths(store.reads, state.roster, state.session, new Set(known.notes.keys())),
    [store.reads, state.version, state.roster, state.session, known]);
  const joined = useMemo(() => storedEdges(known), [known]);
  const colour = colourOf(state.roster, state.session) ?? ORCHESTRATOR;
  // Only a selected session's window is drawn, never every running session's at once (ADR-0746 D1).
  const window = useMemo(() => state.session === undefined || state.window === undefined ? undefined
    : { ...windowView(state.window, new Set(known.notes.keys()), joined, places), colour }, [state.session, state.window, known, joined, colour, places]);
  const stops = useMemo(() => places === undefined ? undefined : new Map([...places.files].map(([key, at]) => [fileStop(key), at] as const)), [places]);
  // A selected session is drawn as its window's traversal, one line per step (ADR-0756); its log's reading-path
  // curves and their glow draw only when it has no window to read, and nothing is drawn while the window is read.
  const traversal = useMemo(() => window === undefined ? undefined : traversalTrails(window.steps, colour, state.session!), [window, colour, state.session]);
  const drawnPaths = window?.status !== undefined ? paths : traversal ?? [];
  // A new selection starts its own history, so lines already taken when it opens do not grow (ADR-0742 D4).
  return <GlobePoints key={state.session ?? ""} points={points} radius={radius} notes={known.notes} lit={lit} trails={drawnPaths} window={window} replay={state.session !== undefined} stops={stops} growth={growth} />;
}

/** The land the selected session's window has opened (ADR-0804 D5), for the forest to light: the files and capabilities opened, and the colour they wear. */
export interface CodeLighting {
  files: ReadonlyMap<string, WindowState>;
  capabilities: ReadonlyMap<string, WindowState>;
  colour: string;
}

const NOTHING_LIT: ReadonlyMap<string, never> = new Map<string, never>();

/** What the selected session's window has lit on the land: its files and capabilities, nothing until its window is read, and nothing with none selected (ADR-0921). */
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
