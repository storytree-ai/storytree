/** Capability tree, 3D mock 1 (stone): the real map's view of The library, as the desktop app draws it, with drystone walls,
 * stone gates, cobbled pathways and wrenches laid on its island (stone.ts). `?real` draws the island as the map does today,
 * file dots and all, with nothing added: the left half of the side-by-side. */
import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RootState } from "@react-three/fiber";
import type { AnnotatedTree } from "@storytree/library";
import { forestScene, storyNodes } from "@storytree/forest";
import { PlanetView, type GlobeControls } from "@storytree/forest/view";
import { workStates } from "@storytree/arc-surface";
import { createKnowledgeCore } from "@storytree/knowledge-core/view";
import { SHEET_RADIUS } from "@storytree/forest-world/planet";
import "@storytree/forest/view/styles.css";
import "./page.css";
import measured from "../data.json" with { type: "json" };
import { stoneLayer, type Layer, type Picked } from "./stone.js";
import { Panel, SAMPLE } from "./panel.js";

type Data = typeof measured & { map: { tree: AnnotatedTree; changes: { type: string; action: string; recordId: string }[]; survey: Record<string, never> } };
const data = measured as unknown as Data;
const STORY = data.story.id;
const params = new URLSearchParams(location.search);
const REAL = params.has("real");
/** How much of the sheet half the window's short side spans at rest, in ground units: The library close up. */
const GROUND = Number(params.get("ground") ?? 105);
const PANEL_WIDTH = 352;

/** The capture build's seam, the only one the forest offers a host for its canvas's live state (PlanetWorldCanvas.tsx). */
const seam = globalThis as { __storytreeCaptureGlobe?: (get: () => RootState) => void };

const scene = forestScene(data.map.tree, data.map.changes, workStates([]), data.map.survey);
const places = new Map(storyNodes(data.map.tree, data.map.changes, data.map.survey).map(node => [node.id, node.place]));

function Mock() {
  const core = useMemo(() => createKnowledgeCore("storytree"), []);
  const [controls, setControls] = useState<GlobeControls>();
  const [get, setGet] = useState<() => RootState>();
  const [layer, setLayer] = useState<Layer>();
  const [picked, setPicked] = useState<Picked>();
  const [sample, setSample] = useState(false);
  useState(() => { seam.__storytreeCaptureGlobe = state => setGet(() => state); });
  const ignore = useCallback(() => {}, []);
  // Aim at the island, close up, as the app flies to a story a click selects; again until the sheet has drawn it.
  useEffect(() => {
    if (!controls) return;
    let again: ReturnType<typeof setTimeout> | undefined, tries = 400;
    const aim = () => { if (controls.stop({ target: { kind: "story", story: STORY }, framing: GROUND / SHEET_RADIUS, sideOffset: -PANEL_WIDTH / 2, duration: 0 }) || tries-- <= 0) return; again = setTimeout(aim, 50); };
    aim();
    return () => clearTimeout(again);
  }, [controls]);
  // Lay the stone on the island once the map has drawn its territories in full.
  useEffect(() => {
    if (!get || REAL) return;
    let timer: ReturnType<typeof setTimeout>, last = "", same = 0;
    const wait = () => {
      const state = get(), plate = state.scene.getObjectByName(`planet:${STORY}`);
      const borders = plate?.getObjectByName("territory-borders") as { geometry: { drawRange: { count: number } } } | undefined;
      const opacities: number[] = [];
      plate?.traverse(object => { if (object.name.startsWith("territory:")) opacities.push((object as unknown as { material: { opacity: number } }).material.opacity); });
      const key = borders && borders.geometry.drawRange.count === Infinity ? opacities.join() : "";
      same = key !== "" && key === last ? same + 1 : 0;
      last = key;
      if (same >= 2) { setLayer(stoneLayer(state, STORY, data)); return; }
      timer = setTimeout(wait, 150);
    };
    wait();
    return () => clearTimeout(timer);
  }, [get]);
  // The selection lights its links to other islands as lanes across the land (the map's selection lanes); on the mock the
  // pathways and the road off the coast stand for those links, so the lanes are hidden whenever the map draws them.
  useEffect(() => {
    if (!get || REAL) return;
    const hide = setInterval(() => { const lanes = get().scene.getObjectByName("pathways:selection-lanes"); if (lanes?.visible) { lanes.visible = false; get().invalidate(); } }, 100);
    return () => clearInterval(hide);
  }, [get]);
  useEffect(() => { layer?.showSample(sample); if (!sample && picked?.kind === "wrench" && picked.sample) setPicked(undefined); }, [layer, sample]);
  useEffect(() => {
    (window as { mock?: unknown }).mock = { layer, pick: (kind: string, id: string) => layer && setPicked(layer.find(kind, id)), sample: setSample, controls, get };
    document.body.dataset.state = REAL ? (get ? "ready" : "loading") : layer ? "ready" : "loading";
  }, [layer, controls, get]);
  // A click (a press that hardly moved) picks what is under it; a drag stays the map's.
  const down = useRef<{ x: number; y: number }>();
  const onDown = (event: React.PointerEvent) => { down.current = { x: event.clientX, y: event.clientY }; };
  const onUp = (event: React.PointerEvent) => {
    const from = down.current; down.current = undefined;
    if (!layer || !from || event.button !== 0 || Math.hypot(event.clientX - from.x, event.clientY - from.y) > 5) return;
    setPicked(layer.pick(event.clientX, event.clientY));
  };
  useEffect(() => { layer?.highlight(picked); }, [layer, picked]);
  return <>
    <div className="mock-map" onPointerDown={onDown} onPointerUp={onUp}>
      <PlanetView core={core} scene={scene} places={places} wisps={[]} selected={STORY} library={false} aside={PANEL_WIDTH}
        surfaces={REAL ? { knowledgeCore: false } : { fileCircles: false, knowledgeCore: false }} onPick={ignore} onNote={ignore} onControls={setControls} />
    </div>
    {REAL ? <aside className="mock-panel" aria-label="Story panel"><header><p className="mock-kicker">Story</p><h2>{data.story.title}</h2></header></aside> : <Panel data={data} picked={picked} onPick={(kind, id) => layer && setPicked(layer.find(kind, id))} sample={sample} onSample={setSample} fills={layer?.fills ?? []} />}
  </>;
}

export { SAMPLE };
createRoot(document.getElementById("mock")!).render(<Mock />);
