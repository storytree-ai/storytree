/**
 * The hedgerow mock's page: the real map's own view (forest's PlanetView, drawing the glass sheet and every island as the
 * desktop app does) on the project's tree as snapshotted in data.json, aimed at The library's island, with the file dots
 * switched off by the view's own switch. On that island, and only there, the hedgerow layer (hedgerow.ts) is added under
 * the island's plate, laid on the island's own territory map. `?view=real` draws the map as it is today, with nothing added.
 */
import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Raycaster, Vector2, Vector3, type Camera, type Object3D, type Scene } from "three";
import type { AnnotatedCapability, AnnotatedTree } from "@storytree/library";
import { forestScene, storyNodes } from "@storytree/forest";
import { PlanetView, type GlobeControls } from "@storytree/forest/view";
import { createKnowledgeCore } from "@storytree/knowledge-core/view";
import "@storytree/forest/view/styles.css";
// The real map's own island geometry: the plate's coast and the territories cut to it, as the view's Territories draws them.
import { islandCoast } from "../../../../../packages/forest-world/src/planet/pathways.ts";
import { islandTerritories, onLand, territoryAt } from "../../../../../packages/forest/src/territories/territories.ts";
import { insideOf } from "../../../../../packages/forest/src/view/territory-land.ts";
import { hedgerowLayer, type Layer, type Link, type Picked, type Want } from "./hedgerow.ts";
import snapshot from "../data.json";
import "./mock.css";

type Data = { story: string; tree: AnnotatedTree; history: { type: string; action: string; recordId: string }[]; states: Record<string, "planned" | "in-progress" | "landed">;
  survey: Record<string, never>; wants: Record<string, Want[]>; measured: Record<string, unknown> };
const data = snapshot as unknown as Data;
const REAL = new URLSearchParams(location.search).get("view") === "real";
const STORY = data.story;

// Transitions (land drawing on, a selection's light) stand at their end, so the page is the same however fast it loads.
const REDUCE = "(prefers-reduced-motion: reduce)";
const media = window.matchMedia.bind(window);
window.matchMedia = query => query === REDUCE ? ({ matches: true, media: REDUCE, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false } as MediaQueryList) : media(query);

// The seam the forest's canvas hands a capture its live three.js state through (PlanetWorldCanvas's CAPTURE_SEAM).
type Globe = { scene: Scene; camera: Camera; gl: { domElement: HTMLCanvasElement }; invalidate(): void };
let globe: (() => Globe) | undefined;
(globalThis as Record<string, unknown>).__storytreeCaptureGlobe = (get: () => Globe) => { globe = get; Object.defineProperty(window, "__globe", { get, configurable: true }); };

const states = { part: (id: string) => data.states[id] ?? "planned" };
const scene = forestScene(data.tree, data.history as never, states, data.survey);
const places = new Map(storyNodes(data.tree, data.history as never, data.survey).map(node => [node.id, node.place]));
const core = createKnowledgeCore("storytree");
const capabilities = new Map(data.tree.stories.flatMap(story => story.capabilities.map(c => [c.id, { capability: c, story }] as const)));
const library = data.tree.stories.find(s => s.id === STORY)!;

/** The island's plate: the group the view's Territories laid this island's territory land in. */
function plateOf(world: Scene): Object3D | undefined {
  const planet = world.getObjectByName(`planet:${STORY}`);
  return planet?.getObjectByName("territory-land")?.parent ?? undefined;
}

/** The plate's surface, as the territories lie on it: its sphere found from a drawn border's ground point and height. */
function surfaceOf(plate: Object3D) {
  const lines = plate.getObjectByName("territory-borders") as unknown as { geometry: { attributes: { position: { array: ArrayLike<number> } } }; userData: { ground: number[] } };
  const ground = lines.userData.ground, drawn = lines.geometry.attributes.position.array;
  const LIFT = 0.05; // the view's TERRITORY_LIFT
  let sphere = Infinity, far = 0;
  for (let i = 0; i < ground.length / 2; i++) {
    const x = ground[i * 2]!, z = ground[i * 2 + 1]!, d2 = x * x + z * z, h = drawn[i * 3 + 1]! - LIFT;
    if (d2 > far && h < -1e-6) { far = d2; sphere = -(d2 + h * h) / (2 * h); }
  }
  return (p: { x: number; z: number }, lift = 0) => new Vector3(p.x, (Number.isFinite(sphere) ? Math.sqrt(Math.max(sphere * sphere - p.x * p.x - p.z * p.z, 0)) - sphere : 0) + LIFT + lift, p.z);
}

/** The island's links: each of its capabilities' dependsOn, inside the island or off its coast toward the other story's island. */
function linksOf(plate: Object3D, world: Scene): Link[] {
  return library.capabilities.flatMap(c => c.dependsOn.flatMap((to): Link[] => {
    const found = capabilities.get(to);
    if (!found) return [];
    const base = { id: `${c.id}->${to}`, from: c.id, to, toTitle: found.capability.title };
    if (found.story.id === STORY) return [base];
    const other = world.getObjectByName(`planet:${found.story.id}`);
    if (!other) return [];
    const local = plate.worldToLocal(other.getWorldPosition(new Vector3()));
    return [{ ...base, toStory: { id: found.story.id, title: found.story.title, toward: { x: local.x, z: local.z } } }];
  }));
}

type Card = { kind: "territory"; capability: string | undefined } | Picked;

function App() {
  const controls = useRef<GlobeControls>();
  const layer = useRef<Layer>();
  const [card, setCard] = useState<Card>();
  const [labels, setLabels] = useState<{ text: string; x: number; y: number; shown: boolean }[]>([]);
  const lastMockPick = useRef(0);

  // Aim at the island once the view hands its controls over and the island is drawn, then lay the layer on its plate.
  useEffect(() => {
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      const state = globe?.();
      const plate = state && plateOf(state.scene);
      if (!state || !plate || !controls.current) return void requestAnimationFrame(tick);
      controls.current.stop({ target: { kind: "story", story: STORY }, framing: Number(new URLSearchParams(location.search).get("framing") ?? 0.00125), duration: 0 });
      if (!REAL) {
        const island = scene.islands.find(i => i.story === STORY)!;
        const coast = islandCoast(island);
        const map = islandTerritories(island.land!.territories, coast);
        const borders = map.borders.flatMap(b => insideOf(b.from, b.to, coast).map(s => ({ ...s, between: b.between })));
        const sample = Object.keys(data.wants).length === 0 ? library.capabilities[0]?.id : undefined;
        layer.current = hedgerowLayer({ land: { ...map, borders }, surface: surfaceOf(plate), onLand: p => onLand(p, coast),
          territoryAt: p => { const t = territoryAt(map, p.x, p.z); const i = t === undefined ? -1 : map.territories.indexOf(t); return i < 0 ? undefined : i; }, links: linksOf(plate, state.scene), wants: data.wants, sample });
        plate.add(layer.current.root);
        (window as { __mockLayer?: Layer }).__mockLayer = layer.current;
        Object.assign(document.body.dataset, { gates: layer.current.gates, bushes: layer.current.hedgeBushes, tracks: layer.current.tracks });
      }
      state.invalidate();
      document.body.dataset.state = "ready";
    };
    tick();
    return () => { stopped = true; };
  }, []);

  // Labels for the roads off the coast follow the camera.
  useEffect(() => {
    let frame = 0;
    const follow = () => {
      const state = globe?.();
      if (state && layer.current) {
        const box = state.gl.domElement.getBoundingClientRect();
        const at = layer.current.labels.map(({ text, at }) => {
          const p = layer.current!.root.localToWorld(at.clone()).project(state.camera);
          return { text, x: (p.x + 1) / 2 * box.width + box.left, y: (1 - p.y) / 2 * box.height + box.top, shown: p.z < 1 };
        });
        setLabels(old => JSON.stringify(old) === JSON.stringify(at) ? old : at);
      }
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(frame);
  }, []);

  // A click on the layer's tracks, gates or wrenches opens its card; a click anywhere else goes on to the view.
  useEffect(() => {
    let down: { x: number; y: number } | undefined;
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
    const onUp = (e: PointerEvent) => {
      const state = globe?.();
      if (!state || !layer.current || !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5 || e.button !== 0) return;
      const box = state.gl.domElement.getBoundingClientRect();
      if (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) return;
      const ray = new Raycaster();
      ray.setFromCamera(new Vector2((e.clientX - box.left) / box.width * 2 - 1, -((e.clientY - box.top) / box.height) * 2 + 1), state.camera);
      const order = { wrench: 0, gate: 1, track: 2 } as const;
      const hit = ray.intersectObjects(layer.current.picks, false).sort((a, b) => order[(a.object.userData as Picked).kind] - order[(b.object.userData as Picked).kind] || a.distance - b.distance)[0];
      if (!hit) return;
      lastMockPick.current = performance.now();
      setCard(hit.object.userData as Picked);
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointerup", onUp, true);
    return () => { window.removeEventListener("pointerdown", onDown, true); window.removeEventListener("pointerup", onUp, true); };
  }, []);

  const onPick = useCallback((story: string | undefined, capability?: string) => {
    if (performance.now() - lastMockPick.current < 400) return;
    setCard(story === STORY ? { kind: "territory", capability } : undefined);
  }, []);

  return <>
    <div className="forest-globe">
      <PlanetView core={core} scene={scene} places={places} wisps={[]} selected={undefined} onPick={onPick} onNote={() => {}}
        onControls={c => { controls.current = c; }} library={false}
        surfaces={REAL ? { knowledgeCore: false } : { fileCircles: false, knowledgeCore: false, sessionTints: false }} />
    </div>
    {!REAL && labels.map(l => l.shown && <div key={l.text} className="mock-label" style={{ left: l.x, top: l.y }}>{l.text}</div>)}
    {!REAL && <header className="mock-title"><b>{library.title}</b> · hedgerow mock <span>click a territory, a track, a gate or the wrench · drag to pan, right-drag or R / F to tilt, Q / E to turn, wheel to zoom</span></header>}
    {card && <CardView card={card} onClose={() => setCard(undefined)} />}
  </>;
}

const word = (c: AnnotatedCapability) => c.parkedOn?.length ? "parked" : c.status;
const health = (h: { reported?: { state: string }; verified?: { state: string } } | undefined) => h?.verified?.state ?? h?.reported?.state ?? "not reported";

function Contracts({ id, open = true }: { id: string; open?: boolean }) {
  const found = capabilities.get(id);
  if (!found) return null;
  const { capability, story } = found;
  return <details className="mock-called" open={open}>
    <summary><b>{capability.title}</b> <small>{story.id === STORY ? "" : `· ${story.title} · `}{word(capability)} · {capability.contracts.length} contracts</small></summary>
    <ol>{capability.contracts.map(k => <li key={k.id} data-health={health(k.health)}>{k.title}<span>{health(k.health)}</span></li>)}</ol>
    {capability.contracts.length === 0 && <p>No contracts yet.</p>}
  </details>;
}

function CardView({ card, onClose }: { card: Card; onClose: () => void }) {
  const title = (id: string | undefined) => id === undefined ? "Unclaimed code" : capabilities.get(id)?.capability.title ?? id;
  const linksOf = (ids: readonly string[]) => ids.map(id => { const [from, to] = id.split("->"); return { from: from!, to: to! }; });
  let body;
  if (card.kind === "territory") {
    const c = card.capability === undefined ? undefined : capabilities.get(card.capability)?.capability;
    body = c === undefined ? <><h2>{library.title}</h2><p>{library.description || "No description yet."}</p><p>{library.capabilities.length} capabilities: click a territory for one of them.</p></>
      : <><h2>{c.title}</h2><p className="mock-word" data-word={word(c)}>{word(c)}</p><p>{c.description || "No description yet."}</p><Contracts id={c.id} /></>;
  } else if (card.kind === "track" || card.kind === "gate") {
    const links = linksOf(card.links);
    body = <>
      <h2>{card.kind === "gate" ? `Gate between ${title(card.between[0])} and ${title(card.between[1])}` : links.length === 1 ? "Track" : `Track shared by ${links.length} links`}</h2>
      <p>{links.length === 1 ? "One link passes here." : `${links.length} links pass here.`} Each calls the capability below; its contracts are what it promises.</p>
      {links.map((l, i) => <div key={`${l.from}->${l.to}`} className="mock-link"><p className="mock-from">{title(l.from)} → calls</p><Contracts id={l.to} open={i === 0} /></div>)}
    </>;
  } else {
    const wants = data.wants[card.capability] ?? [];
    const byArc = new Map<string, { title: string; increments: Want[] }>();
    for (const w of wants) byArc.set(w.arc, { title: w.arcTitle, increments: [...(byArc.get(w.arc)?.increments ?? []), w] });
    body = <>
      <h2>Wrench on {title(card.capability)}</h2>
      {card.sample ? <p className="mock-sample">Sample: no open increment names this capability today.</p>
        : <p>{wants.length === 1 ? "One open increment names" : `${wants.length} open increments name`} this capability in its capabilities list.</p>}
      {[...byArc].map(([id, arc]) => <section key={id} className="mock-arc"><h3>{arc.title}</h3>
        <ul>{arc.increments.map(i => <li key={i.increment}>{i.title}<span>{i.status}</span></li>)}</ul></section>)}
    </>;
  }
  return <aside className="mock-card" data-card={card.kind}><button type="button" className="mock-close" onClick={onClose} aria-label="Close">×</button>{body}</aside>;
}

createRoot(document.getElementById("root")!).render(<App />);
