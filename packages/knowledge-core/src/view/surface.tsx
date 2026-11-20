// Capability 4 · Look inside and inspect an artifact
import { useEffect, useMemo, useSyncExternalStore } from "react";

import type { Change, Line, RecordEnvelope, SchemaRecord } from "@storytree/library";
import { outageSaidOnce } from "@storytree/library/connection-error";

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

const WINDOW_EVERY_MS = 10_000;

export interface CoreReads {
  windowReading(project: string, session: string): Promise<SessionWindow>;
  inherited?(project: string): Promise<readonly SchemaRecord[]>;
}

interface State {
  history: readonly Change[];
  drawn: readonly Change[];
  factory: ReadonlySet<string>;
  inherited: readonly Change[];
  version: number;
  session: string | undefined;
  roster: readonly RosterEntry[];
  pinned: string | undefined;
  dismissed: string | undefined;
  hidden: ReadonlySet<string>;
  window: SessionWindow | undefined;
}

export interface KnowledgeCore {
  take(history: readonly Change[], lines: readonly Line[]): void;
  pin(note: string | undefined): void;
  showKind(kind: string, shown: boolean): void;
  showRoster(roster: readonly RosterEntry[]): void;
  select(session: string | undefined): void;
  onSelect(listener: (session: string | undefined) => void): () => void;
  dispose(): void;
}

interface Store extends KnowledgeCore {
  readonly reads: ReadRecord;
  view(): () => void;
  get(): State;
  set(next: Partial<State>): void;
  subscribe(listener: () => void): () => void;
}

export function createKnowledgeCore(project: string, { reads: host }: { reads?: CoreReads } = {}): KnowledgeCore {
  const reads = new ReadRecord(project);
  const listeners = new Set<() => void>();
  const selections = new Set<(session: string | undefined) => void>();
  let state: State = {
    history: [], drawn: [], factory: new Set(), inherited: [], version: 0, session: undefined, roster: [], pinned: undefined, dismissed: undefined, hidden: HIDDEN_AT_START, window: undefined,
  };
  let windowTimer: ReturnType<typeof setInterval> | undefined;
  let windowOut: string | undefined;
  const windowOutage = outageSaidOnce((line, ...error) => console.error(`knowledge-core: ${line}`, ...error));
  const readWindow = (session: string): void => {
    if (host === undefined || windowOut === session) return;
    windowOut = session;
    host.windowReading(project, session).then((window) => {
      windowOutage.answered();
      if (state.session === session) store.set({ window });
    }, (error: unknown) => {
      windowOutage.failed("the selected session's window could not be read", error);
    }).finally(() => { if (windowOut === session) windowOut = undefined; });
  };
  let inheritedOut = false, inheritedAgain = false;
  let viewers = 0, inheritedStale = true;
  const readInherited = (): void => {
    if (host?.inherited === undefined) return;
    if (viewers === 0) { inheritedStale = true; return; }
    inheritedStale = false;
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
    view() {
      viewers += 1;
      if (inheritedStale) readInherited();
      let open = true;
      return () => { if (open) { open = false; viewers -= 1; } };
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
      if (history.length === state.history.length) {
        store.set({ version: state.version + 1 });
        return;
      }
      const taken = [...history];
      store.set({ history: taken, ...drawing(state.inherited, taken), version: state.version + 1 });
      readInherited();
    },
    dispose() {
      if (windowTimer !== undefined) clearInterval(windowTimer);
      listeners.clear();
      selections.clear();
    },
  };
  return store;
}

function drawing(inherited: readonly Change[], history: readonly Change[]): Pick<State, "drawn" | "factory"> {
  const own = new Set(history.map(({ recordId }) => recordId));
  return {
    drawn: inherited.length === 0 ? history : [...inherited, ...history],
    factory: new Set(inherited.map(({ recordId }) => recordId).filter((id) => !own.has(id))),
  };
}

function colourOf(roster: readonly RosterEntry[], session: string | undefined): string | undefined {
  return session === undefined ? undefined : roster.find(({ members }) => members.includes(session))?.colour;
}

export function KnowledgeNoteCard({ core, onClose }: { core: KnowledgeCore; onClose: () => void }) {
  const store = core as Store;
  const state = useSyncExternalStore(store.subscribe, store.get);
  const known = useMemo(() => knowledge(state.drawn), [state.drawn]);
  const card = state.pinned === undefined || state.pinned === state.dismissed ? undefined : noteCard(state.pinned, known, state.factory);
  useEffect(() => {
    let mounted = true;
    if (state.pinned !== undefined && card === undefined) queueMicrotask(() => { if (mounted) onClose(); });
    return () => { mounted = false; };
  }, [state.pinned, card, onClose]);
  return card === undefined ? null : <NoteCard card={card} onClose={onClose} />;
}

export interface CoreUnderSheet extends SheetHanging {
  place(at: ShelfPoint): Point;
  storyOf(node: string): string | undefined;
  selected: string | undefined;
}

const SHEET_DOT_SCALE = 360;

export function KnowledgeGlobePoints({ core, places, growth, sheet, onHung }: {
  core: KnowledgeCore;
  onHung?: (() => void) | undefined;
  sheet: CoreUnderSheet;
  growth?: CoreGrowth | undefined;
  places?: CodePlaces;
}) {
  const store = core as Store;
  useEffect(() => store.view(), [store]);
  const state = useSyncExternalStore(store.subscribe, store.get);
  const known = useMemo(() => knowledge(state.drawn), [state.drawn]);
  const layout = useMemo(sheetLayout, []);
  const laid = useInSteps(() => layout(underShelves(state.drawn, known), sheet, known.notes),
    [layout, state.drawn, known, sheet.shelfAt, sheet.floor, sheet.depthStep]);
  const hung = useMemo(() => {
    if (laid === undefined) return undefined;
    const { points, floor } = laid;
    const corners = floor.notes === 0 ? undefined
      : [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => sheet.place({ x: floor.x + u! * floor.width, y: floor.y + v! * floor.height, z: floor.z }));
    return { laid: points, points: points.map(point => ({ ...point, at: sheet.place(point.at) })), floor: corners === undefined ? undefined : { corners, notes: floor.notes } };
  }, [laid, sheet.place]);
  const laidOnce = hung !== undefined;
  useEffect(() => { if (laidOnce) onHung?.(); }, [laidOnce]);
  const placed = useMemo(() => hung?.points ?? [], [hung]);
  const lit = useMemo(() => lighting(store.reads, state.roster, state.session, new Set(known.notes.keys())),
    [store.reads, state.version, state.roster, state.session, known]);
  const paths = useMemo(() => readingPaths(store.reads, state.roster, state.session, new Set(known.notes.keys())),
    [store.reads, state.version, state.roster, state.session, known]);
  const joined = useMemo(() => storedEdges(known), [known]);
  const colour = colourOf(state.roster, state.session) ?? ORCHESTRATOR;
  const window = useMemo(() => state.session === undefined || state.window === undefined ? undefined
    : { ...windowView(state.window, new Set(known.notes.keys()), joined, places), colour }, [state.session, state.window, known, joined, colour, places]);
  const points = useMemo(() => {
    const steps = window === undefined || window.status !== undefined ? paths : window.steps;
    const kept = new Set([...lit.keys(), ...(window?.notes ?? []), ...(window?.faded ?? []), ...(window?.glimpsed ?? []), ...steps.flatMap(({ from, to }) => [from, to])]);
    return drawnPoints(placed, known.notes, state.hidden, kept);
  }, [placed, known, state.hidden, lit, paths, window]);
  const sizes = useMemo(() => dotSizes(store.reads.reach(Date.now()), points.map(({ id }) => id)), [store.reads, state.version, points]);
  const traversal = useMemo(() => window === undefined ? undefined : traversalTrails(window.steps, colour, state.session!), [window, colour, state.session]);
  const drawnPaths = window?.status !== undefined ? paths : traversal ?? [];
  const { selected, storyOf } = sheet;
  const [bright, quiet] = useMemo(() => {
    if (selected === undefined || hung === undefined) return [undefined, undefined];
    const own = sheetLit(hung.points, selected, storyOf);
    return [new Set(points.filter(({ id }) => own.has(id)).map(({ id }) => id)), new Set(points.filter(({ id }) => !own.has(id)).map(({ id }) => id))];
  }, [points, hung, selected, storyOf]);
  const drawn = <GlobePoints key={state.session ?? ""} points={points} radius={SHEET_DOT_SCALE} notes={known.notes} sizes={sizes} lit={lit} trails={drawnPaths} window={window} replay={state.session !== undefined} growth={growth} quiet={quiet} shaded />;
  const roots = useMemo(() => hung === undefined ? undefined
    : sheetRoots(hung.laid, bright).map(([from, to]) => [sheet.place(from), sheet.place(to)] as const), [hung, bright, sheet.place]);
  return roots === undefined ? drawn : <>{drawn}<NoteRoots roots={roots} />{hung?.floor && <SeaFloor {...hung.floor} />}</>;
}

export function KnowledgeKinds({ core }: { core: KnowledgeCore }) {
  const store = core as Store;
  const state = useSyncExternalStore(store.subscribe, store.get);
  const known = useMemo(() => knowledge(state.drawn), [state.drawn]);
  const rows = useMemo(() => kindRows(known, state.hidden), [known, state.hidden]);
  return <KindList rows={rows} onShow={core.showKind} />;
}

export interface CodeLighting {
  capabilities: ReadonlyMap<string, WindowState>;
  colour: string;
}

const NOTHING_LIT: ReadonlyMap<string, never> = new Map<string, never>();

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
