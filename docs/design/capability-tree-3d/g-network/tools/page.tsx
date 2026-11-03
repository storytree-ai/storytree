/** Capability tree mock, round 10: the real map's view of The library with the story selected, its territories laid out by
 * their links and shrunk off the coast onto open land (territories-shim.ts, layout.json), and its links drawn as one shared
 * road network between settlements that passes a gate at every border it crosses (overlay.ts, network.ts). `?real&layout=today` draws the selected story as the map does today, with nothing added. */
import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RootState } from "@react-three/fiber";
import type { AnnotatedTree } from "@storytree/library";
import { forestScene, storyNodes } from "@storytree/forest";
import { PlanetView, type GlobeControls } from "@storytree/forest/view";
import { workStates } from "@storytree/arc-surface";
import { createKnowledgeCore } from "@storytree/knowledge-core/view";
import { islandCoast } from "@storytree/forest-world/geometry";
import { islandTerritories } from "../../../../../packages/forest/src/territories/territories.js";
import { SHEET_RADIUS } from "@storytree/forest-world/planet";
import { Vector3, type Camera } from "three";
import "@storytree/forest/view/styles.css";
import "./page.css";
import measured from "../data.json" with { type: "json" };
import layout from "../layout.json" with { type: "json" };
import { overlayLayer, type Layer, type Picked } from "./overlay.js";
import { Panel } from "./panel.js";

type Data = typeof measured & { map: { tree: AnnotatedTree; changes: { type: string; action: string; recordId: string }[]; survey: Record<string, never> } };
const data = measured as unknown as Data;
const STORY = data.story.id;
const params = new URLSearchParams(location.search);
const REAL = params.has("real");
const GROUND = Number(params.get("ground") ?? 150);
const PANEL_WIDTH = 352;
/** The rest view's margin around the island, in CSS pixels. */
const MARGIN = 28;

/** The capture build's seam, the only one the forest offers a host for its canvas's live state (PlanetWorldCanvas.tsx). */
const seam = globalThis as { __storytreeCaptureGlobe?: (get: () => RootState) => void };

const scene = forestScene(data.map.tree, data.map.changes, workStates([]), data.map.survey);
const island = scene.islands.find(one => one.story === STORY)!;
const coast = islandCoast(island);
const cut = islandTerritories(island.land!.territories, coast);
const places = new Map(storyNodes(data.map.tree, data.map.changes, data.map.survey).map(node => [node.id, node.place]));

/** The island's box on the page: the rest view is framed on it. */
function extentOf(state: RootState) {
  const plate = state.scene.getObjectByName(`planet:${STORY}`), land = plate?.getObjectByName("territory-land");
  if (!land?.parent) return undefined;
  const root = land.parent; state.camera.updateMatrixWorld(); root.updateMatrixWorld(true);
  const rect = state.gl.domElement.getBoundingClientRect();
  const pts = coast.flat().map(q => { const w = new Vector3(q.x, 0, q.z).applyMatrix4(root.matrixWorld).project(state.camera as Camera); return { x: rect.left + (w.x + 1) / 2 * rect.width, y: rect.top + (1 - w.y) / 2 * rect.height }; });
  return { left: Math.min(...pts.map(c => c.x)), right: Math.max(...pts.map(c => c.x)), top: Math.min(...pts.map(c => c.y)) - 14, bottom: Math.max(...pts.map(c => c.y)) + 30 };
}

function Mock() {
  const core = useMemo(() => createKnowledgeCore("storytree"), []);
  const [controls, setControls] = useState<GlobeControls>();
  const [get, setGet] = useState<() => RootState>();
  const [layer, setLayer] = useState<Layer>();
  const [picked, setPicked] = useState<Picked>();
  const [framed, setFramed] = useState(params.has("ground"));
  const ground = useRef(GROUND), side = useRef(-PANEL_WIDTH / 2);
  useState(() => { seam.__storytreeCaptureGlobe = state => setGet(() => state); });
  const ignore = useCallback(() => {}, []);
  // Aim at the island, as the app flies to a story a click selects; again until the sheet has drawn it.
  useEffect(() => {
    if (!controls) return;
    let again: ReturnType<typeof setTimeout> | undefined, tries = 400;
    const aim = () => { if (controls.stop({ target: { kind: "story", story: STORY }, framing: ground.current / SHEET_RADIUS, sideOffset: -PANEL_WIDTH / 2, duration: 0 }) || tries-- <= 0) return; again = setTimeout(aim, 50); };
    aim();
    return () => clearTimeout(again);
  }, [controls]);
  // Then framed on the island, as large as the map's side of the window holds with a margin.
  useEffect(() => {
    if (!controls || !get || framed) return;
    let tries = 10, timer: ReturnType<typeof setTimeout>, last = "", waited = 0;
    const frame = () => {
      get().invalidate();
      const box = extentOf(get());
      if (!box) { timer = setTimeout(frame, 150); return; }
      const width = window.innerWidth - PANEL_WIDTH, height = window.innerHeight, key = [box.left, box.right, box.top, box.bottom].map(Math.round).join();
      if (key === last && waited++ < 20) { timer = setTimeout(frame, 150); return; }
      last = key; waited = 0;
      const need = Math.max((box.right - box.left) / (width - 2 * MARGIN), 2 * Math.max(box.bottom - height / 2, height / 2 - box.top) / (height - 2 * MARGIN));
      const off = (box.left + box.right) / 2 - width / 2;
      if ((Math.abs(need - 1) < 0.03 && Math.abs(off) < 12) || tries-- <= 0) { setFramed(true); return; }
      ground.current *= Math.min(2, Math.max(0.5, need));
      side.current -= off / Math.max(1, need);
      controls.stop({ target: { kind: "story", story: STORY }, framing: ground.current / SHEET_RADIUS, sideOffset: side.current, duration: 0 });
      timer = setTimeout(frame, 150);
    };
    timer = setTimeout(frame, 600);
    return () => clearTimeout(timer);
  }, [controls, get, framed]);
  // Lay the lines once the view is framed and the map has drawn its territories, names and lanes in full.
  useEffect(() => {
    if (!get || REAL || !framed) return;
    let timer: ReturnType<typeof setTimeout>, last = "", same = 0;
    const wait = () => {
      const state = get(), plate = state.scene.getObjectByName(`planet:${STORY}`);
      const borders = plate?.getObjectByName("territory-borders") as { geometry: { drawRange: { count: number } } } | undefined;
      const lanes = state.scene.getObjectByName("pathways:selection-lanes");
      const names = host.current?.querySelectorAll(".planet-nameplate.capability").length ?? 0;
      const key = borders && lanes && borders.geometry.drawRange.count === Infinity ? `${names}:${lanes.children.length}` : "";
      same = key !== "" && key === last ? same + 1 : 0;
      last = key;
      if (same >= 4) { setLayer(overlayLayer(state, STORY, data as never, host.current!, cut, coast, layout)); return; }
      timer = setTimeout(wait, 200);
    };
    wait();
    return () => clearTimeout(timer);
  }, [get, framed]);
  // The map draws its lanes again when it likes; they are cut at the coast each time.
  useEffect(() => {
    if (!layer) return;
    const keep = setInterval(() => layer.keep(), 250);
    return () => clearInterval(keep);
  }, [layer]);
  useEffect(() => {
    (window as { mock?: unknown }).mock = { layer, pick: (kind: string, id: string) => layer && setPicked(layer.find(kind, id)), controls, get };
    document.body.dataset.state = REAL ? (get && framed ? "ready" : "loading") : layer ? "ready" : "loading";
    document.body.dataset.framed = framed ? "yes" : "no";
  }, [layer, controls, get, framed]);
  // A click (a press that hardly moved) picks what is under it; a drag stays the map's.
  const host = useRef<HTMLDivElement>(null);
  const down = useRef<{ x: number; y: number }>();
  const onDown = (event: React.PointerEvent) => { down.current = { x: event.clientX, y: event.clientY }; };
  const onUp = (event: React.PointerEvent) => {
    const from = down.current; down.current = undefined;
    if (!layer || !from || event.button !== 0 || Math.hypot(event.clientX - from.x, event.clientY - from.y) > 5) return;
    setPicked(layer.pick(event.clientX, event.clientY));
  };
  useEffect(() => { layer?.highlight(picked); }, [layer, picked]);
  return <>
    <div ref={host} className="mock-map" onPointerDown={onDown} onPointerUp={onUp}>
      <PlanetView core={core} scene={scene} places={places} wisps={[]} selected={STORY} library={false} aside={PANEL_WIDTH}
        surfaces={{ fileCircles: false, knowledgeCore: false }} onPick={ignore} onNote={ignore} onControls={setControls} />
    </div>
    {REAL ? <aside className="mock-panel" aria-label="Story panel"><header><p className="mock-kicker">Story</p><h2>{data.story.title}</h2></header><section className="mock-picked"><p className="mock-muted">{params.get("layout") === "today" ? "The map today, The library selected." : "The link layout, nothing added: the map draws it as it draws any island."}</p></section></aside>
      : <Panel data={data} picked={picked} onPick={(kind, id) => layer && setPicked(layer.find(kind, id))} layer={layer} />}
  </>;
}

createRoot(document.getElementById("mock")!).render(<Mock />);
