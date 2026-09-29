/**
 * Capability 4's surface (the knowledge core story): everything the knowledge core shows, owned
 * here so the app only mounts it (ADR-0649 D2). The app makes one core per project it shows,
 * hands it the library's change history and the activity log's new lines as they come, and mounts
 * the two pieces while looking inside: `KnowledgeCoreInside` in the turning globe and
 * `KnowledgeCorePanel` beside it. The core keeps its own reads, session, size, replay and pin.
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";

import type { Line, SessionWindow } from "@storytree/agent-link";
import type { Change } from "@storytree/library";

import { knowledge, storedEdges } from "../ghosts/ghosts.js";
import { ORCHESTRATOR, coreScene, legend, lighting, noteCard, trails as readingPaths, agentPaths, noteTitle, pinnedLinks, replayFrame, stampOpens, windowReplays, windowView, type CoreInput, type Point, type RosterEntry, type SizeBy, type Trail } from "../look-inside/look-inside.js";
import { ReadRecord, type AgentReplay } from "../reads/reads.js";
import { underShelves } from "../shelves/shelves.js";
import { globePoints } from "../shelves/positions.js";
import { GlobePoints } from "./globe-points.js";
import { CoreInside, CorePanel, NoteCard } from "./drawing.js";

/** How fast the replay steps, one read a step. */
const REPLAY_STEP_MS = 700;
/** How often the selected session's window, or every listed session's with none selected, is read again, as often as the sessions list's bars. */
const WINDOW_EVERY_MS = 10_000;

/** The one read the core makes beyond what it is handed: a session's window (agent link 9.10), from the host: the selected session's, or every listed session's with none selected (ADR-0754 D1). */
export interface CoreReads {
  windowReading(project: string, session: string): Promise<SessionWindow>;
}

interface State {
  history: readonly Change[];
  /** Bumped whenever the reads change, since the record itself is kept in place. */
  version: number;
  /** Undefined shows every listed running session at once (ADR-0738 D1). */
  session: string | undefined;
  roster: readonly RosterEntry[];
  sizeBy: SizeBy;
  /** How far the replay has gone; Infinity shows the whole session. */
  step: number;
  playing: boolean;
  hidden: ReadonlySet<string>;
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
  /** The same pin is shared by the globe card and the inspection view. */
  pin(note: string | undefined): void;
  /** The running sessions the host lists, lit together while none is selected (ADR-0738 D2), each from its window when the host reads one (ADR-0754 D1). */
  showRoster(roster: readonly RosterEntry[]): void;
  /** Drill into one session's replay, or back to every running session with undefined (ADR-0738 D5). */
  select(session: string | undefined): void;
  /** Hears the selection, wherever it was made. */
  onSelect(listener: (session: string | undefined) => void): () => void;
  /** Stop the replay's timer. */
  dispose(): void;
}

interface Store extends KnowledgeCore {
  readonly reads: ReadRecord;
  get(): State;
  set(next: Partial<State>): void;
  subscribe(listener: () => void): () => void;
  play(): void;
  stop(): void;
}

/** A knowledge core for `project`; with `reads`, a selected session's window is drawn too (ADR-0746 D1). */
export function createKnowledgeCore(project: string, { reads: host }: { reads?: CoreReads } = {}): KnowledgeCore {
  const reads = new ReadRecord(project);
  const listeners = new Set<() => void>();
  const selections = new Set<(session: string | undefined) => void>();
  let state: State = {
    history: [], version: 0, session: undefined, roster: [], sizeBy: "visits", step: Infinity, playing: false, hidden: new Set(), pinned: undefined, window: undefined,
    windows: new Map(), stamps: new Map(),
  };
  let timer: ReturnType<typeof setInterval> | undefined;
  let windowTimer: ReturnType<typeof setInterval> | undefined;
  let rosterTimer: ReturnType<typeof setInterval> | undefined;
  /** The latest log line or window open seen, after which a newly seen open is stamped. */
  let clock = 0;
  /** Listed sessions whose window is being read, so a slow read is not asked again meanwhile. */
  const reading = new Set<string>();
  const listedMembers = (): Set<string> => new Set(state.roster.flatMap(({ members }) => members));
  /**
   * Read every listed session's window while none is selected (ADR-0754 D1), or, with `only`, those
   * not read yet. A session that has left the list meanwhile is dropped; a failed read keeps the last.
   */
  const readRosterWindows = (only = false): void => {
    if (host === undefined || state.session !== undefined) return;
    for (const member of listedMembers()) {
      if (reading.has(member) || (only && state.windows.has(member))) continue;
      reading.add(member);
      host.windowReading(project, member).then((window) => {
        if (!listedMembers().has(member)) return;
        const stamps = new Map(state.stamps);
        if (!("absent" in window)) {
          const stamped = stampOpens(state.stamps.get(member), window.opens.length, clock);
          clock = stamped.clock;
          stamps.set(member, stamped.stamps);
        }
        store.set({ windows: new Map([...state.windows, [member, window]]), stamps });
      }, () => {
        // A failed read leaves the window as it was; the next one tries again.
      }).finally(() => reading.delete(member));
    }
  };
  /** Read the selected session's window; an answer for a session no longer selected is dropped. */
  const readWindow = (session: string): void => {
    host?.windowReading(project, session).then((window) => {
      if (state.session === session) store.set({ window });
    }, () => {
      // A failed read leaves the window as it was; the next one tries again.
    });
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
      store.stop();
      if (windowTimer !== undefined) clearInterval(windowTimer);
      windowTimer = undefined;
      store.set({ session, step: Infinity, playing: false, hidden: new Set(), window: undefined });
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
      store.set({ history: [...history], version: state.version + 1 });
    },
    play() {
      store.stop();
      store.set({ playing: true, step: state.step === Infinity ? 0 : state.step });
      timer = setInterval(() => {
        const present = new Set(knowledge(state.history).notes.keys());
        const steps = state.session === undefined ? 0 : replayFrame(reads.replay(state.session, present).agents, 0, state.hidden).steps;
        if (state.step >= steps) {
          store.stop();
          store.set({ playing: false });
        } else store.set({ step: state.step + 1 });
      }, REPLAY_STEP_MS);
    },
    stop() {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    },
    dispose() {
      store.stop();
      if (windowTimer !== undefined) clearInterval(windowTimer);
      if (rosterTimer !== undefined) clearInterval(rosterTimer);
      listeners.clear();
      selections.clear();
    },
  };
  return store;
}

/** Everything both pieces draw, worked out from the core's state. */
function useCore(core: KnowledgeCore, spots: ReadonlyMap<string, Point>, radius: number) {
  const store = core as Store;
  const state = useSyncExternalStore(store.subscribe, store.get);
  const known = useMemo(() => knowledge(state.history), [state.history]);
  const placed = useMemo(() => underShelves(state.history, known), [state.history, known]);
  const present = new Set(known.notes.keys());
  const replay = state.session === undefined ? undefined : store.reads.replay(state.session, present);
  const frame = replay === undefined ? undefined : replayFrame(replay.agents, state.step, state.hidden);
  const windowed = useMemo(() => windowReplays(state.windows, new Set(known.notes.keys()), state.stamps), [state.windows, state.stamps, known]);
  const input: CoreInput = {
    changes: state.history, knowledge: known, core: placed, reads: store.reads, spots, radius, session: state.session, sizeBy: state.sizeBy, roster: state.roster, windowed,
    ...(frame === undefined ? {} : { frame }),
  };
  return { store, state, known, placed, present, frame, input, key: replay === undefined ? [] : legend(replay.agents, colourOf(state.roster, state.session)), links: pinnedLinks(state.pinned, known) };
}

/** The core inside the turning globe, in its coordinates: `spots` are each story's unit direction. */
export function KnowledgeCoreInside({ core, spots, radius, selected }: {
  core: KnowledgeCore;
  spots: ReadonlyMap<string, Point>;
  radius: number;
  /** The selected story, whose capabilities' entrances are named too. */
  selected: string | undefined;
}) {
  const { store, state, frame, input, key, links } = useCore(core, spots, radius);
  // Leaving the core lets the pin go, so the globe comes back as it was.
  useEffect(() => () => store.set({ pinned: undefined }), [store]);
  return <CoreInside scene={coreScene(input)} radius={radius} pinned={state.pinned} links={links} frame={frame} legend={key}
    selected={selected} onPin={(pinned) => store.set({ pinned })} />;
}

/** The panel beside the core: what is drawn, the session, the size, the replay, the legend and the card. */
export function KnowledgeCorePanel({ core }: { core: KnowledgeCore }) {
  const none = useMemo(() => new Map<string, Point>(), []);
  const { store, state, known, placed, present, frame, input, key, links } = useCore(core, none, 1);
  useEffect(() => () => store.stop(), [store]);
  const titles = new Map([...known.notes.values()].map((note) => [note.id, noteTitle(note)]));
  const listed = new Map(state.roster.map(({ session, label }) => [session, label]));
  const sessions = [...new Set([...listed.keys(), ...store.reads.sessions()])]
    .map((id) => ({ id, label: listed.get(id) ?? sessionLabel(id, store.reads.replay(id, present).agents) }));
  return <CorePanel scene={coreScene(input)}
    counts={{ placed: placed.placed.size, outside: placed.outside.length, ghosts: known.ghosts.size, loops: placed.loops.length }}
    sessions={sessions} roster={state.roster} session={state.session} sizeBy={state.sizeBy} frame={frame} step={state.step} playing={state.playing}
    legend={key} hidden={state.hidden} card={state.pinned === undefined ? undefined : noteCard(state.pinned, input)}
    links={links} titles={titles}
    on={{
      session: (session) => core.select(session),
      sizeBy: (sizeBy) => store.set({ sizeBy }),
      play: () => store.play(),
      pause: () => {
        store.stop();
        store.set({ playing: false });
      },
      restart: () => {
        store.stop();
        store.set({ step: 0, playing: false });
      },
      toggleAgent: (agent) => {
        const hidden = new Set(state.hidden);
        if (!hidden.delete(agent)) hidden.add(agent);
        store.set({ hidden });
      },
      unpin: () => store.set({ pinned: undefined }),
    }} />;
}

/** A listed session's colour, found by its own id or a child's. */
function colourOf(roster: readonly RosterEntry[], session: string | undefined): string | undefined {
  return session === undefined ? undefined : roster.find(({ members }) => members.includes(session))?.colour;
}

/** A session as the picker names it: when its first read was, and how many reads and agents it has. */
function sessionLabel(id: string, agents: readonly AgentReplay[]): string {
  const reads = agents.flatMap(({ lit }) => lit).sort((a, b) => a.seq - b.seq);
  const when = reads[0] === undefined ? id.slice(0, 8)
    : new Date(reads[0].at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  return `${when} · ${plural(reads.length, "read")} · ${plural(agents.length, "agent")}`;
}

/** The shared card alone, mounted in the globe's right-side story-panel slot. */
export function KnowledgeNoteCard({ core, onClose }: { core: KnowledgeCore; onClose: () => void }) {
  const none = useMemo(() => new Map<string, Point>(), []);
  const { state, input } = useCore(core, none, 1);
  const card = state.pinned === undefined ? undefined : noteCard(state.pinned, input);
  useEffect(() => {
    // A live retirement removes the card as well as its dot. Defer until React's commit ends.
    let mounted = true;
    if (state.pinned !== undefined && card === undefined) queueMicrotask(() => { if (mounted) onClose(); });
    return () => { mounted = false; };
  }, [state.pinned, card, onClose]);
  return card === undefined ? null : <NoteCard card={card} onClose={onClose} />;
}

/** Knowledge under the globe's islands, without story text, ghosts or replay: faint, or lit by the running sessions' reads (ADR-0738), with a selected session's window (ADR-0746 D1). */
export function KnowledgeGlobePoints({ core, spots, radius }: {
  core: KnowledgeCore; spots: ReadonlyMap<string, Point>; radius: number;
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
    : { ...windowView(state.window, new Set(known.notes.keys()), joined), colour }, [state.session, state.window, known, joined, colour]);
  // A selected session is drawn as its window's traversal, one line per step (ADR-0756); its log's reading-path
  // curves and their glow draw only when it has no window to read, and nothing is drawn while the window is read.
  const traversal = useMemo(() => window?.steps.map(({ from, to, edge, faded }, seq): Trail => ({ from, to, colour, seq, mover: state.session!, step: { edge, faded } })),
    [window, colour, state.session]);
  const drawnPaths = state.session === undefined || window?.status !== undefined ? paths : traversal ?? [];
  const glows = state.session === undefined || window?.status !== undefined ? replays : [];
  // A new selection starts its own history, so lines already taken when it opens do not grow (ADR-0742 D4).
  return <GlobePoints key={state.session ?? ""} points={points} radius={radius} notes={known.notes} lit={lit} trails={drawnPaths} paths={glows} window={window} />;
}
