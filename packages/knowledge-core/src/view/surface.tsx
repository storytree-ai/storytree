/**
 * Capability 4 · Look inside and inspect an artifact. Capability 4's surface (the knowledge core story): everything the knowledge core shows, owned
 * here so the app only mounts it (ADR-0649 D2). The app makes one core per project it shows,
 * hands it the library's change history and the activity log's new lines as they come, and mounts
 * `KnowledgeGlobePoints` under the glass sheet and `KnowledgeNoteCard` in the story-panel slot.
 * The core keeps its own reads, selected session, windows and pin.
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";

import type { Change, Line, RecordEnvelope, SchemaRecord } from "@storytree/library";

import { knowledge, storedEdges } from "../ghosts/ghosts.js";
import { HIDDEN_AT_START, drawnPoints, kindRows } from "../kinds/kinds.js";
import { ORCHESTRATOR, dotSizes, lighting, noteCard, trails as readingPaths, traversalTrails, windowView, type CodePlaces, type WindowState, type Point, type RosterEntry, type SessionWindow } from "../look-inside/look-inside.js";
import { ReadRecord } from "../reads/reads.js";
import { underShelves } from "../shelves/shelves.js";
import type { Point as ShelfPoint } from "../shelves/positions.js";
import { sheetLayout, sheetLit, sheetRoots, type SheetHanging } from "../shelves/sheet.js";
import { GlobePoints, NoteRoots, SeaFloor, type CoreGrowth } from "./globe-points.js";
import { KindList, NoteCard } from "./drawing.js";
import { useInSteps } from "./in-steps.js";

/** How often the selected session's window is read again, as often as the sessions list's bars. */
const WINDOW_EVERY_MS = 10_000;

/** The reads the core makes beyond what it is handed: the selected session's window (Session management 9.10), from the host, none with none selected (ADR-0921); and, where the host has it, the system notes a product reads from its factory (library 1.19). */
export interface CoreReads {
  windowReading(project: string, session: string): Promise<SessionWindow>;
  inherited?(project: string): Promise<readonly SchemaRecord[]>;
}

interface State {
  history: readonly Change[];
  /** What the core draws: the notes read from the factory, as changes ahead of the history, then the history, so the product's own writes win. */
  drawn: readonly Change[];
  /** The notes drawn from the factory that the history holds no change of: their card says so. */
  factory: ReadonlySet<string>;
  /** The factory's notes, last read, as changes ahead of the history. */
  inherited: readonly Change[];
  /** Bumped whenever the reads change, since the record itself is kept in place. */
  version: number;
  /** Undefined shows no session's traversal (ADR-0921). */
  session: string | undefined;
  roster: readonly RosterEntry[];
  pinned: string | undefined;
  /** The pinned note whose kind was switched off since: its card closes (capability 5, D2). */
  dismissed: string | undefined;
  /** The kinds switched off: their dots are not drawn (capability 5, D2). */
  hidden: ReadonlySet<string>;
  /** The selected session's window, once read. */
  window: SessionWindow | undefined;
}

/** One project's knowledge core: its inputs, its controls, and a subscription for the pieces. */
export interface KnowledgeCore {
  /** The library's whole change history and the activity log's lines since the last call. */
  take(history: readonly Change[], lines: readonly Line[]): void;
  /** The note whose card is open, shared by the globe's dots and the card. */
  pin(note: string | undefined): void;
  /** Draw a kind's dots, or stop drawing them (capability 5). */
  showKind(kind: string, shown: boolean): void;
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
    history: [], drawn: [], factory: new Set(), inherited: [], version: 0, session: undefined, roster: [], pinned: undefined, dismissed: undefined, hidden: HIDDEN_AT_START, window: undefined,
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
    }, (error: unknown) => {
      // A failed read leaves the window as it was; the next one tries again.
      console.error("knowledge-core: the selected session's window could not be read", error);
    }).finally(() => { if (windowOut === session) windowOut = undefined; });
  };
  /** Whether a read of the factory's notes is out, and whether another was asked for meanwhile. */
  let inheritedOut = false, inheritedAgain = false;
  /** Read the notes the project reads from its factory again, never over its own last read; a failed read keeps the last, and is logged. */
  const readInherited = (): void => {
    if (host?.inherited === undefined) return;
    if (inheritedOut) { inheritedAgain = true; return; }
    inheritedOut = true;
    host.inherited(project).then((records) => {
      const inherited = records.map((record): Change => ({ seq: 0, recordId: record.id, type: record.type, action: "created", record: record as RecordEnvelope }));
      store.set({ inherited, ...drawing(inherited, state.history) });
    }, (error: unknown) => {
      console.error("knowledge-core: the factory's notes could not be read", error);
    }).finally(() => {
      inheritedOut = false;
      if (inheritedAgain) { inheritedAgain = false; readInherited(); }
    });
  };
  const store: Store = {
    reads,
    pin: pinned => store.set({ pinned, dismissed: undefined }),
    showKind(kind, shown) {
      if (state.hidden.has(kind) !== shown) return;
      const hidden = new Set(state.hidden);
      if (shown) hidden.delete(kind);
      else hidden.add(kind);
      const pinned = state.pinned === undefined ? undefined : knowledge(state.drawn).notes.get(state.pinned);
      store.set({ hidden, dismissed: !shown && pinned?.type === kind ? state.pinned : state.dismissed });
    },
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
      if (history.length === state.history.length) {
        store.set({ version: state.version + 1 });
        return;
      }
      const taken = [...history];
      store.set({ history: taken, ...drawing(state.inherited, taken), version: state.version + 1 });
      // A longer history may be an edit of a factory note, or follow a change to the factory: read its notes again.
      readInherited();
    },
    dispose() {
      if (windowTimer !== undefined) clearInterval(windowTimer);
      listeners.clear();
      selections.clear();
    },
  };
  readInherited();
  return store;
}

/** What the core draws from the factory's notes and the project's history, and which drawn notes are the factory's alone. */
function drawing(inherited: readonly Change[], history: readonly Change[]): Pick<State, "drawn" | "factory"> {
  const own = new Set(history.map(({ recordId }) => recordId));
  return {
    drawn: inherited.length === 0 ? history : [...inherited, ...history],
    factory: new Set(inherited.map(({ recordId }) => recordId).filter((id) => !own.has(id))),
  };
}

/** A listed session's colour, found by its own id or a child's. */
function colourOf(roster: readonly RosterEntry[], session: string | undefined): string | undefined {
  return session === undefined ? undefined : roster.find(({ members }) => members.includes(session))?.colour;
}

/** The pinned note's card, mounted in the globe's right-side story-panel slot. */
export function KnowledgeNoteCard({ core, onClose }: { core: KnowledgeCore; onClose: () => void }) {
  const store = core as Store;
  const state = useSyncExternalStore(store.subscribe, store.get);
  const known = useMemo(() => knowledge(state.drawn), [state.drawn]);
  const card = state.pinned === undefined || state.pinned === state.dismissed ? undefined : noteCard(state.pinned, known, state.factory);
  useEffect(() => {
    // A live retirement, or its kind switched off, removes the card as well as its dot. Defer until React's commit ends.
    let mounted = true;
    if (state.pinned !== undefined && card === undefined) queueMicrotask(() => { if (mounted) onClose(); });
    return () => { mounted = false; };
  }, [state.pinned, card, onClose]);
  return card === undefined ? null : <NoteCard card={card} onClose={onClose} />;
}

/** Under the glass sheet (ADR-1043 D5, ADR-1063): where each shelf stands, the islands' footprint the sea floor spreads across, and where a place under the sheet is drawn. */
export interface CoreUnderSheet extends SheetHanging {
  /** Where a place in the sheet's own frame (x east, y north, z up from the glass) is drawn, in the host's frame. */
  place(at: ShelfPoint): Point;
  /** The story a shelf belongs to. */
  storyOf(node: string): string | undefined;
  /** The selected story: the notes pulled toward its island are lit and hang on roots, the rest fade back (ADR-1043 D3, ADR-1063 D4, ADR-1260). */
  selected: string | undefined;
}

/** A note's dot under the sheet is sized as on a globe of this radius: about two ground units at the floor. */
const SHEET_DOT_SCALE = 360;

/** Knowledge hung under the glass sheet over a faint sea floor, the selected story's on roots, without ghosts: faint, or lit by a selected session's reads and window (ADR-0738 D5, ADR-0746 D1); with none selected, unlit (ADR-0921). */
export function KnowledgeGlobePoints({ core, places, growth, sheet }: {
  core: KnowledgeCore;
  /** Where the notes hang under the glass sheet. */
  sheet: CoreUnderSheet;
  /** A replay to grow with (capability 1.9): the globe's growth reader, read inside the globe. */
  growth?: CoreGrowth | undefined;
  /** The code's surface, as the forest lays it on the globe: the territories a selected session's window lights (ADR-1212 D3). */
  places?: CodePlaces;
}) {
  const store = core as Store;
  const state = useSyncExternalStore(store.subscribe, store.get);
  const known = useMemo(() => knowledge(state.drawn), [state.drawn]);
  // Live updates that change nothing the sheet lays out keep its layout (Live updates never freeze the globe).
  const layout = useMemo(sheetLayout, []);
  // Laid out a few steps to a task, so a shelf moving as the map opens runs no long task (1.17); the layout before stays meanwhile.
  const laid = useInSteps(() => layout(underShelves(state.drawn, known), sheet, known.notes),
    [layout, state.drawn, known, sheet.shelfAt, sheet.floor, sheet.depthStep]);
  const hung = useMemo(() => {
    if (laid === undefined) return undefined;
    const { points, floor } = laid;
    const corners = floor.notes === 0 ? undefined
      : [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => sheet.place({ x: floor.x + u! * floor.width, y: floor.y + v! * floor.height, z: floor.z }));
    return { laid: points, points: points.map(point => ({ ...point, at: sheet.place(point.at) })), floor: corners === undefined ? undefined : { corners, notes: floor.notes } };
  }, [laid, sheet.place]);
  // No note is drawn until its first layout is.
  const placed = useMemo(() => hung?.points ?? [], [hung]);
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
  // A switched-off kind's dots are not drawn, so they cannot be picked; what the selected session touched stays (capability 5, D2, D5).
  const points = useMemo(() => {
    const steps = window === undefined || window.status !== undefined ? paths : window.steps;
    const kept = new Set([...lit.keys(), ...(window?.notes ?? []), ...(window?.faded ?? []), ...(window?.glimpsed ?? []), ...steps.flatMap(({ from, to }) => [from, to])]);
    return drawnPoints(placed, known.notes, state.hidden, kept);
  }, [placed, known, state.hidden, lit, paths, window]);
  // Sized by how widely each note was read in the last 90 days, whoever is selected (ADR-0926); no reads leave every dot at the floor.
  const sizes = useMemo(() => dotSizes(store.reads.reach(Date.now()), points.map(({ id }) => id)), [store.reads, state.version, points]);
  // A selected session is drawn as its window's traversal, one line per step (ADR-0756); its log's reading-path
  // curves and their glow draw only when it has no window to read, and nothing is drawn while the window is read.
  const traversal = useMemo(() => window === undefined ? undefined : traversalTrails(window.steps, colour, state.session!), [window, colour, state.session]);
  const drawnPaths = window?.status !== undefined ? paths : traversal ?? [];
  // A new selection starts its own history, so lines already taken when it opens do not grow (ADR-0742 D4).
  // On the sheet the notes pulled toward a selected story's island are lit, those between it and another island too, and the
  // rest faded back, so whose notes are whose reads at a glance (ADR-1260 D3).
  const { selected, storyOf } = sheet;
  const [bright, quiet] = useMemo(() => {
    if (selected === undefined || hung === undefined) return [undefined, undefined];
    const own = sheetLit(hung.points, selected, storyOf);
    return [new Set(points.filter(({ id }) => own.has(id)).map(({ id }) => id)), new Set(points.filter(({ id }) => !own.has(id)).map(({ id }) => id))];
  }, [points, hung, selected, storyOf]);
  const drawn = <GlobePoints key={state.session ?? ""} points={points} radius={SHEET_DOT_SCALE} notes={known.notes} sizes={sizes} lit={lit} trails={drawnPaths} window={window} replay={state.session !== undefined} growth={growth} quiet={quiet} shaded />;
  // Each lit note's root, laid in the sheet's frame and drawn where the sheet places it; a switched-off kind's go with its dots.
  const roots = useMemo(() => hung === undefined ? undefined
    : sheetRoots(hung.laid, bright).map(([from, to]) => [sheet.place(from), sheet.place(to)] as const), [hung, bright, sheet.place]);
  return roots === undefined ? drawn : <>{drawn}<NoteRoots roots={roots} />{hung?.floor && <SeaFloor {...hung.floor} />}</>;
}

/** The kind list (capability 5, D1): each kind with a dot, its colour and its count, switched on or off by a press. */
export function KnowledgeKinds({ core }: { core: KnowledgeCore }) {
  const store = core as Store;
  const state = useSyncExternalStore(store.subscribe, store.get);
  const known = useMemo(() => knowledge(state.drawn), [state.drawn]);
  const rows = useMemo(() => kindRows(known, state.hidden), [known, state.hidden]);
  return <KindList rows={rows} onShow={core.showKind} />;
}

/** The land the selected session's window has opened (ADR-1212 D3), for the forest to light: the capabilities opened, and the colour they wear. */
export interface CodeLighting {
  capabilities: ReadonlyMap<string, WindowState>;
  colour: string;
}

const NOTHING_LIT: ReadonlyMap<string, never> = new Map<string, never>();

/** What the selected session's window has lit on the land: its capabilities, nothing until its window is read, and nothing with none selected (ADR-0921). */
export function useCodeLighting(core: KnowledgeCore, places: CodePlaces | undefined): CodeLighting {
  const store = core as Store;
  const state = useSyncExternalStore(store.subscribe, store.get);
  const colour = colourOf(state.roster, state.session) ?? ORCHESTRATOR;
  return useMemo(() => {
    if (places === undefined || state.session === undefined || state.window === undefined) return { capabilities: NOTHING_LIT, colour };
    const { code } = windowView(state.window, new Set(), () => false, places);
    return { ...code, colour };
  }, [places, state.session, state.window, colour]);
}
