/**
 * Capability 4's surface (the knowledge core story): everything the knowledge core shows, owned
 * here so the app only mounts it (ADR-0649 D2). The app makes one core per project it shows,
 * hands it the library's change history and the activity log's new lines as they come, and mounts
 * the two pieces while looking inside: `KnowledgeCoreInside` in the turning globe and
 * `KnowledgeCorePanel` beside it. The core keeps its own reads, session, size, replay and pin.
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";

import type { Line } from "@storytree/agent-link";
import type { Change } from "@storytree/library";

import { knowledge } from "../ghosts/ghosts.js";
import { coreScene, legend, noteCard, noteTitle, pinnedLinks, replayFrame, type CoreInput, type Point, type RosterEntry, type SizeBy } from "../look-inside/look-inside.js";
import { ReadRecord, type AgentReplay } from "../reads/reads.js";
import { underShelves } from "../shelves/shelves.js";
import { globePoints } from "../shelves/positions.js";
import { GlobePoints } from "./globe-points.js";
import { CoreInside, CorePanel, NoteCard } from "./drawing.js";

/** How fast the replay steps, one read a step. */
const REPLAY_STEP_MS = 700;

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
}

/** One project's knowledge core: its inputs, its controls, and a subscription for the pieces. */
export interface KnowledgeCore {
  /** The library's whole change history and the activity log's lines since the last call. */
  take(history: readonly Change[], lines: readonly Line[]): void;
  /** The same pin is shared by the globe card and the inspection view. */
  pin(note: string | undefined): void;
  /** The running sessions the host lists, lit together while none is selected (ADR-0738 D2). */
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

/** A knowledge core for `project`. */
export function createKnowledgeCore(project: string): KnowledgeCore {
  const reads = new ReadRecord(project);
  const listeners = new Set<() => void>();
  const selections = new Set<(session: string | undefined) => void>();
  let state: State = {
    history: [], version: 0, session: undefined, roster: [], sizeBy: "visits", step: Infinity, playing: false, hidden: new Set(), pinned: undefined,
  };
  let timer: ReturnType<typeof setInterval> | undefined;
  const store: Store = {
    reads,
    pin: pinned => store.set({ pinned }),
    showRoster: roster => store.set({ roster }),
    select(session) {
      if (session === state.session) return;
      store.stop();
      store.set({ session, step: Infinity, playing: false, hidden: new Set() });
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
  const input: CoreInput = {
    changes: state.history, knowledge: known, core: placed, reads: store.reads, spots, radius, session: state.session, sizeBy: state.sizeBy, roster: state.roster,
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

/** Faint knowledge under the globe's islands, without story text, ghosts or replay. */
export function KnowledgeGlobePoints({ core, spots, radius }: {
  core: KnowledgeCore; spots: ReadonlyMap<string, Point>; radius: number;
}) {
  const store = core as Store;
  const state = useSyncExternalStore(store.subscribe, store.get);
  const known = useMemo(() => knowledge(state.history), [state.history]);
  const points = useMemo(() => globePoints(underShelves(state.history, known), spots, radius, known.notes), [state.history, known, spots, radius]);
  return <GlobePoints points={points} radius={radius} notes={known.notes} />;
}
