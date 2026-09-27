/**
 * The forest's 3D picture (stories/forest.md, capability 3 · Story node render): 0.2's own forest
 * canvas (`ForestWorldCanvas`, ported whole in @storytree/forest-world), fed @storytree/forest's plan.
 * Every story node is one of 0.2's islands at its place on the spiral, its ground, coast and kit
 * trees drawn as 0.2 drew them, lit by 0.2's calibrated light. It pans and zooms as 0.2's did.
 *
 * On top of the picture, and drawn inside the same scene so they move with it, are what the 0.3
 * forest adds: each story's name over its island (3.4), a click that selects the island whose land
 * is under it (3.3), the selected island's ring, and the claim markers over each held capability's
 * tree (capability 5). A change recomputes only the islands it touched (3.2, `changedIslands`).
 *
 * The globe opens onto its knowledge core ("Look inside", stories/knowledge-core.md capability 4):
 * the sea and islands hide; the turn, the failure markers and the selection stay; and the core is
 * drawn by ./core-view.tsx from @storytree/knowledge-core.
 *
 * The look is 0.2's, ported as it stands (ADR-0632 D2, ADR-0633 D2), and judged by the owner's eye.
 * Only the export of the bought pine kit ships (dressing-kit.glb, sha256 9479bc81…), never the kit.
 */
import { useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { createRoot } from "react-dom/client";
import { Plane, Raycaster, Vector2, Vector3 } from "three";

import type { Line } from "@storytree/agent-link";
import { changedIslands, PLANET_RADIUS, type ForestScene, type Marker } from "@storytree/forest";
import {
  coreScene, knowledge, legend, lookInside, noteCard, noteTitle, pinnedLinks, ReadRecord, replayFrame, returnToGlobe, shown, toForest, underShelves,
  type AgentReplay, type CoreViewState, type SizeBy,
} from "@storytree/knowledge-core";
import type { Change } from "@storytree/library";
import { forestDescriptors, islandAt, type Descriptor3D } from "@storytree/forest-world";
import { ForestWorldCanvas, preloadKit } from "@storytree/forest-world/canvas";
import kitBytes from "@storytree/forest-world/assets/dressing-kit.glb";

import { CoreInside, CorePanel } from "./core-view.js";
import { Names, Claims, SelectionRing } from "./island-overlays.js";
import { PlanetView } from "./planet-view.js";

export interface ForestView {
  /** Draw `scene`, recomputing only the islands that changed since the last one. */
  show(scene: ForestScene, places: ReadonlyMap<string, number>): void;
  /** Show which agent holds which capability, each marker over its tree (capability 5). */
  showMarkers(markers: readonly Marker[]): void;
  /** The library's whole change history and the activity log's new lines, for the knowledge core. */
  showKnowledge(history: readonly Change[], lines: readonly Line[]): void;
  /** Mark `story` selected (undefined for none), as a click would. */
  select(story: string | undefined): void;
  /** Stop drawing and let go of the GPU. */
  dispose(): void;
}

/** What the page draws, as one value handed to React on every change. */
interface Drawn extends CoreViewState {
  places: ReadonlyMap<string, number>;
  scene: ForestScene;
  descriptors: Descriptor3D[];
  markers: readonly Marker[];
  viewport: { width: number; height: number } | undefined;
  /** The knowledge core's inputs and controls. */
  history: readonly Change[];
  session: string | undefined;
  /** True once the viewer chose a session, so a newer one never takes over. */
  sessionChosen: boolean;
  sizeBy: SizeBy;
  /** How far the replay has gone; Infinity shows the whole session. */
  step: number;
  playing: boolean;
  hidden: ReadonlySet<string>;
}

/** How fast the replay steps, one read a step. */
const REPLAY_STEP_MS = 700;

/** Open the forest in `container`. `onSelect` hears which story a click picked (undefined for the sea). */
export async function openForestView(container: HTMLElement, onSelect: (story: string | undefined) => void): Promise<ForestView> {
  await preloadKit(kitBytes);
  const root = createRoot(container);
  /** Each island's descriptors, kept until its island changes. */
  const cache = new Map<string, { key: string; descriptors: Descriptor3D[] }>();
  let drawn: Drawn = {
    places: new Map(), mode: "globe", scene: { islands: [] }, descriptors: [], markers: [], selected: undefined, pinned: undefined, viewport: undefined,
    history: [], session: undefined, sessionChosen: false, sizeBy: "visits", step: Infinity, playing: false, hidden: new Set(),
  };
  /** The project's recorded reads. A view is opened per project, so this never mixes two. */
  const reads = new ReadRecord("");
  let project: string | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  const stopTimer = (): void => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  };

  const render = (next: Partial<Drawn>): void => {
    drawn = { ...drawn, ...next };
    if (drawn.viewport === undefined) return;
    container.dataset.view = drawn.mode;
    root.render(<>
      <nav className="forest-views" aria-label="Forest view">
        {(["globe", "inside", "forest"] as const).map(mode => <button key={mode} type="button" data-view={mode}
          aria-pressed={drawn.mode === mode} onClick={() => render(VIEWS[mode](drawn))}>
          {VIEW_LABELS[mode]}
        </button>)}
      </nav>
      {drawn.mode === "forest" ? <Forest drawn={drawn} onPick={pick} /> : <Globe drawn={drawn} reads={reads} onPick={pick} on={core} />}
    </>);
  };
  const core: CoreControls = {
    pin: (pinned) => render({ pinned }),
    session: (session) => {
      stopTimer();
      render({ session, sessionChosen: true, step: Infinity, playing: false });
    },
    sizeBy: (sizeBy) => render({ sizeBy }),
    play: () => {
      stopTimer();
      render({ playing: true, step: drawn.step === Infinity ? 0 : drawn.step });
      timer = setInterval(() => {
        const session = drawn.session;
        const present = new Set(knowledge(drawn.history).notes.keys());
        const steps = session === undefined ? 0 : replayFrame(reads.replay(session, present).agents, 0, drawn.hidden).steps;
        if (drawn.step >= steps) {
          stopTimer();
          render({ playing: false });
        } else render({ step: drawn.step + 1 });
      }, REPLAY_STEP_MS);
    },
    pause: () => {
      stopTimer();
      render({ playing: false });
    },
    restart: () => {
      stopTimer();
      render({ step: 0, playing: false });
    },
    toggleAgent: (agent) => {
      const hidden = new Set(drawn.hidden);
      if (!hidden.delete(agent)) hidden.add(agent);
      render({ hidden });
    },
  };
  const pick = (story: string | undefined): void => {
    render({ selected: story });
    onSelect(story);
  };

  const observer = new ResizeObserver(() => {
    const { clientWidth: width, clientHeight: height } = container;
    if (width > 0 && height > 0) render({ viewport: { width, height } });
  });
  observer.observe(container);

  return {
    show(scene, places) {
      for (const story of changedIslands(drawn.scene, scene)) cache.delete(story);
      for (const island of scene.islands) {
        if (!cache.has(island.story)) cache.set(island.story, { key: island.key, descriptors: forestDescriptors({ islands: [island] }) });
      }
      // Preserve unchanged islands for the globe's memoized plates, as for the flat descriptor cache.
      const previous = new Map(drawn.scene.islands.map(island => [island.story, island]));
      scene = { islands: scene.islands.map(island => previous.get(island.story)?.key === island.key ? previous.get(island.story)! : island) };
      render({ scene, places, descriptors: scene.islands.flatMap(({ story }) => cache.get(story)?.descriptors ?? []) });
    },
    showKnowledge(history, lines) {
      const named = lines[0]?.project;
      if (project === undefined && named !== undefined) {
        project = named;
        reads.switchTo(named);
      }
      reads.add(lines);
      render({ history: [...history], ...(drawn.sessionChosen ? {} : { session: reads.sessions().at(-1) }) });
    },
    showMarkers(markers) {
      render({ markers });
    },
    select(story) {
      render({ selected: story });
    },
    dispose() {
      stopTimer();
      observer.disconnect();
      root.unmount();
      container.replaceChildren();
    },
  };
}

const VIEWS = { globe: returnToGlobe, inside: lookInside, forest: toForest } as const;
const VIEW_LABELS = { globe: "Globe", inside: "Look inside", forest: "Forest" } as const;

interface CoreControls {
  pin(note: string | undefined): void;
  session(session: string | undefined): void;
  sizeBy(sizeBy: SizeBy): void;
  play(): void;
  pause(): void;
  restart(): void;
  toggleAgent(agent: string): void;
}

/** The globe, and while looking inside, the knowledge core in it and its panel beside it. */
function Globe({ drawn, reads, onPick, on }: { drawn: Drawn; reads: ReadRecord; onPick: (story: string | undefined) => void; on: CoreControls }) {
  const view = shown(drawn);
  const known = useMemo(() => knowledge(drawn.history), [drawn.history]);
  const placed = useMemo(() => underShelves(drawn.history, known), [drawn.history, known]);
  const present = new Set(known.notes.keys());
  const replay = drawn.session === undefined ? undefined : reads.replay(drawn.session, present);
  const frame = replay === undefined ? undefined : replayFrame(replay.agents, drawn.step, drawn.hidden);
  const key = replay === undefined ? [] : legend(replay.agents);
  const links = pinnedLinks(drawn.pinned, known);
  const input = (spots: ReadonlyMap<string, { x: number; y: number; z: number }>) => ({
    changes: drawn.history, knowledge: known, core: placed, reads, spots, radius: PLANET_RADIUS, session: drawn.session, sizeBy: drawn.sizeBy,
    ...(frame === undefined ? {} : { frame }),
  });
  const titles = new Map([...known.notes.values()].map((note) => [note.id, noteTitle(note)]));
  const sessions = view.entrances ? reads.sessions().map((id) => ({ id, label: sessionLabel(id, reads.replay(id, present).agents) })) : [];
  return <>
    <PlanetView scene={drawn.scene} places={drawn.places} markers={drawn.markers} selected={drawn.selected}
      onPick={view.entrances ? undefined : onPick} surface={view.sea}
      inside={view.entrances ? (spots) => <CoreInside scene={coreScene(input(spots))} radius={PLANET_RADIUS} pinned={drawn.pinned} links={links}
        frame={frame} legend={key} selected={drawn.selected} onPin={on.pin} /> : undefined} />
    {view.entrances && <CorePanel scene={coreScene(input(new Map()))}
      counts={{ placed: placed.placed.size, outside: placed.outside.length, ghosts: known.ghosts.size, loops: placed.loops.length }}
      sessions={sessions} session={drawn.session} sizeBy={drawn.sizeBy} frame={frame} step={drawn.step} playing={drawn.playing}
      legend={key} hidden={drawn.hidden} card={drawn.pinned === undefined ? undefined : noteCard(drawn.pinned, input(new Map()))}
      links={links} titles={titles} on={{ ...on, unpin: () => on.pin(undefined) }} />}
  </>;
}

/** A session as the picker names it: when its first read was, and how many reads and agents it has. */
function sessionLabel(id: string, agents: readonly AgentReplay[]): string {
  const reads = agents.flatMap(({ lit }) => lit).sort((a, b) => a.seq - b.seq);
  const when = reads[0] === undefined ? id.slice(0, 8)
    : new Date(reads[0].at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  return `${when} · ${plural(reads.length, "read")} · ${plural(agents.length, "agent")}`;
}

function Forest({ drawn, onPick }: { drawn: Drawn; onPick: (story: string | undefined) => void }) {
  // The frame it is delivered into, so the canvas opens on 0.2's designed resting view (ADR-0471), as
  // 0.2's studio land view did.
  return (
    <ForestWorldCanvas descriptors={drawn.descriptors} viewport={drawn.viewport!} kitBytes={kitBytes}>
      <Names islands={drawn.scene.islands} selected={drawn.selected} />
      <Claims markers={drawn.markers} descriptors={drawn.descriptors} />
      <SelectionRing island={drawn.scene.islands.find(({ story }) => story === drawn.selected)} descriptors={drawn.descriptors} />
      <ClickToSelect descriptors={drawn.descriptors} onPick={onPick} />
    </ForestWorldCanvas>
  );
}

/** A click, not a drag, selects the island whose land is under the pointer; open sea selects none (3.3). */
function ClickToSelect({ descriptors, onPick }: { descriptors: readonly Descriptor3D[]; onPick: (story: string | undefined) => void }) {
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const down = useRef<{ x: number; y: number } | undefined>(undefined);
  useEffect(() => {
    const element = gl.domElement;
    const onDown = (event: PointerEvent): void => {
      down.current = { x: event.clientX, y: event.clientY };
    };
    const onUp = (event: PointerEvent): void => {
      const from = down.current;
      if (from === undefined || Math.hypot(event.clientX - from.x, event.clientY - from.y) > 5) return;
      const box = element.getBoundingClientRect();
      const ray = new Raycaster();
      ray.setFromCamera(new Vector2(((event.clientX - box.left) / box.width) * 2 - 1, -((event.clientY - box.top) / box.height) * 2 + 1), camera);
      const hit = ray.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), 0), new Vector3());
      onPick(hit === null ? undefined : islandAt(descriptors, hit.x, hit.z));
    };
    element.addEventListener("pointerdown", onDown);
    element.addEventListener("pointerup", onUp);
    return () => {
      element.removeEventListener("pointerdown", onDown);
      element.removeEventListener("pointerup", onUp);
    };
  }, [gl, camera, descriptors, onPick]);
  return null;
}
