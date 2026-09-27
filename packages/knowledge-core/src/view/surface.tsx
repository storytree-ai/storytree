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
import { coreScene, legend, noteCard, noteTitle, pinnedLinks, replayFrame, type CoreInput, type Point, type SizeBy } from "../look-inside/look-inside.js";
import { ReadRecord, type AgentReplay } from "../reads/reads.js";
import { underShelves } from "../shelves/shelves.js";
import { CoreInside, CorePanel } from "./drawing.js";

/** How fast the replay steps, one read a step. */
const REPLAY_STEP_MS = 700;

interface State {
  history: readonly Change[];
  /** Bumped whenever the reads change, since the record itself is kept in place. */
  version: number;
  session: string | undefined;
  /** True once the viewer chose a session, so a newer one never takes over. */
  sessionChosen: boolean;
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
  let state: State = {
    history: [], version: 0, session: undefined, sessionChosen: false, sizeBy: "visits", step: Infinity, playing: false, hidden: new Set(), pinned: undefined,
  };
  let timer: ReturnType<typeof setInterval> | undefined;
  const store: Store = {
    reads,
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
      store.set({ history: [...history], version: state.version + 1, ...(state.sessionChosen ? {} : { session: reads.sessions().at(-1) }) });
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
    changes: state.history, knowledge: known, core: placed, reads: store.reads, spots, radius, session: state.session, sizeBy: state.sizeBy,
    ...(frame === undefined ? {} : { frame }),
  };
  return { store, state, known, placed, present, frame, input, key: replay === undefined ? [] : legend(replay.agents), links: pinnedLinks(state.pinned, known) };
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
  const sessions = store.reads.sessions().map((id) => ({ id, label: sessionLabel(id, store.reads.replay(id, present).agents) }));
  return <CorePanel scene={coreScene(input)}
    counts={{ placed: placed.placed.size, outside: placed.outside.length, ghosts: known.ghosts.size, loops: placed.loops.length }}
    sessions={sessions} session={state.session} sizeBy={state.sizeBy} frame={frame} step={state.step} playing={state.playing}
    legend={key} hidden={state.hidden} card={state.pinned === undefined ? undefined : noteCard(state.pinned, input)}
    links={links} titles={titles}
    on={{
      session: (session) => {
        store.stop();
        store.set({ session, sessionChosen: true, step: Infinity, playing: false });
      },
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

/** A session as the picker names it: when its first read was, and how many reads and agents it has. */
function sessionLabel(id: string, agents: readonly AgentReplay[]): string {
  const reads = agents.flatMap(({ lit }) => lit).sort((a, b) => a.seq - b.seq);
  const when = reads[0] === undefined ? id.slice(0, 8)
    : new Date(reads[0].at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  return `${when} · ${plural(reads.length, "read")} · ${plural(agents.length, "agent")}`;
}
