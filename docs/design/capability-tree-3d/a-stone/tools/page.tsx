import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RootState } from "@react-three/fiber";
import type { AnnotatedTree } from "@storytree/library";
import { forestScene, storyNodes } from "@storytree/forest";
import { PlanetView, type GlobeControls } from "@storytree/forest/view";
import { workStates } from "@storytree/arc-surface";
import { createKnowledgeCore } from "@storytree/knowledge-core/view";
import { islandCoast } from "@storytree/forest-world/geometry";
import { SHEET_RADIUS } from "@storytree/forest-world/planet";
import "@storytree/forest/view/styles.css";
import "./page.css";
import measured from "../data.json" with { type: "json" };
import { islandLayer, type Layer, type Picked } from "./island.js";
import { Panel, SAMPLE } from "./panel.js";

type Data = typeof measured & { map: { tree: AnnotatedTree; changes: { type: string; action: string; recordId: string }[]; survey: Record<string, never> } };
const data = measured as unknown as Data;
const STORY = data.story.id;
const params = new URLSearchParams(location.search);
const REAL = params.has("real");
const GROUND = Number(params.get("ground") ?? 150);
const ROOM = Number(params.get("room") ?? 1.6);
const PANEL_WIDTH = 352;
const MARGIN = 28;

const seam = globalThis as { __storytreeCaptureGlobe?: (get: () => RootState) => void };

const own = (data.map.survey as Record<string, { files: { path: string; lines: number }[] }>)[STORY]!;
const lines = own.files.reduce((sum, file) => sum + file.lines, 0);
const survey = REAL ? data.map.survey : { ...data.map.survey, [STORY]: { ...own, files: [...own.files, { path: "(the mock's open land)", lines: Math.round(lines * (ROOM - 1)) }] } } as typeof data.map.survey;
const scene = forestScene(data.map.tree, data.map.changes, workStates([]), survey);
const island = scene.islands.find(one => one.story === STORY)!;
const coast = islandCoast(island);
const places = new Map(storyNodes(data.map.tree, data.map.changes, survey).map(node => [node.id, node.place]));

function Mock() {
  const core = useMemo(() => createKnowledgeCore("storytree"), []);
  const [controls, setControls] = useState<GlobeControls>();
  const [get, setGet] = useState<() => RootState>();
  const [layer, setLayer] = useState<Layer>();
  const [picked, setPicked] = useState<Picked>();
  const [sample, setSample] = useState(false);
  const [framed, setFramed] = useState(params.has("ground"));
  const ground = useRef(GROUND), side = useRef(-PANEL_WIDTH / 2);
  useState(() => { seam.__storytreeCaptureGlobe = state => setGet(() => state); });
  const ignore = useCallback(() => {}, []);
  useEffect(() => {
    if (!controls) return;
    let again: ReturnType<typeof setTimeout> | undefined, tries = 400;
    const aim = () => { if (controls.stop({ target: { kind: "story", story: STORY }, framing: ground.current / SHEET_RADIUS, sideOffset: -PANEL_WIDTH / 2, duration: 0 }) || tries-- <= 0) return; again = setTimeout(aim, 50); };
    aim();
    return () => clearTimeout(again);
  }, [controls]);
  useEffect(() => {
    if (!controls || !layer || !get || params.has("ground")) return;
    let tries = 8, timer: ReturnType<typeof setTimeout>, last = "", waited = 0;
    const frame = () => {
      get().invalidate();
      const box = layer.extent(), width = window.innerWidth - PANEL_WIDTH, height = window.innerHeight, key = [box.left, box.right, box.top, box.bottom].map(Math.round).join();
      if (key === last && waited++ < 20) { timer = setTimeout(frame, 150); return; }
      last = key; waited = 0;
      const need = Math.max((box.right - box.left) / (width - 2 * MARGIN), 2 * Math.max(box.bottom - height / 2, height / 2 - box.top) / (height - 2 * MARGIN));
      const off = (box.left + box.right) / 2 - width / 2;
      console.info("framing", ground.current, side.current, need, off, waited);
      if ((Math.abs(need - 1) < 0.03 && Math.abs(off) < 12) || tries-- <= 0) { setFramed(true); return; }
      ground.current *= Math.min(2, Math.max(0.5, need));
      side.current -= off / Math.max(1, need);
      controls.stop({ target: { kind: "story", story: STORY }, framing: ground.current / SHEET_RADIUS, sideOffset: side.current, duration: 0 });
      timer = setTimeout(frame, 150);
    };
    const tilt = Number(params.get("tilt") ?? 2);
    for (let k = 0; k < tilt; k++) { window.dispatchEvent(new KeyboardEvent("keydown", { key: "r" })); window.dispatchEvent(new KeyboardEvent("keyup", { key: "r" })); }
    timer = setTimeout(frame, 600);
    return () => clearTimeout(timer);
  }, [controls, layer, get]);
  useEffect(() => {
    if (!get || REAL) return;
    let timer: ReturnType<typeof setTimeout>, last = "", same = 0;
    const wait = () => {
      const state = get(), plate = state.scene.getObjectByName(`planet:${STORY}`);
      const borders = plate?.getObjectByName("territory-borders") as { geometry: { drawRange: { count: number } } } | undefined;
      const opacities: number[] = [];
      plate?.traverse(object => { if (object.name.startsWith("territory:")) opacities.push((object as unknown as { material: { opacity: number } }).material.opacity); });
      const lanes = state.scene.getObjectByName("pathways:selection-lanes");
      const key = borders && lanes && borders.geometry.drawRange.count === Infinity ? opacities.join() : "";
      same = key !== "" && key === last ? same + 1 : 0;
      last = key;
      if (same >= 2) { setLayer(islandLayer(state, STORY, data as never, host.current!, coast)); return; }
      timer = setTimeout(wait, 150);
    };
    wait();
    return () => clearTimeout(timer);
  }, [get]);
  useEffect(() => {
    if (!get || REAL) return;
    const hide = setInterval(() => { layer?.keepHidden(); const lanes = get().scene.getObjectByName("pathways:selection-lanes"); if (lanes?.visible) { lanes.visible = false; get().invalidate(); } }, 100);
    return () => clearInterval(hide);
  }, [get, layer]);
  useEffect(() => { layer?.showSample(sample); if (!sample && picked?.kind === "wrench" && picked.sample) setPicked(undefined); }, [layer, sample]);
  useEffect(() => {
    (window as { mock?: unknown }).mock = { layer, pick: (kind: string, id: string) => layer && setPicked(layer.find(kind, id)), sample: setSample, controls, get };
    document.body.dataset.state = REAL ? (get ? "ready" : "loading") : layer ? "ready" : "loading";
    document.body.dataset.framed = framed ? "yes" : "no";
  }, [layer, controls, get, framed]);
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
    <div ref={host} className={`mock-map${REAL ? "" : " mock-laid"}`} onPointerDown={onDown} onPointerUp={onUp}>
      <PlanetView core={core} scene={scene} places={places} wisps={[]} selected={STORY} library={false} aside={PANEL_WIDTH}
        surfaces={REAL ? { knowledgeCore: false } : { fileCircles: false, knowledgeCore: false }} onPick={ignore} onNote={ignore} onControls={setControls} />
    </div>
    {REAL ? <aside className="mock-panel" aria-label="Story panel"><header><p className="mock-kicker">Story</p><h2>{data.story.title}</h2></header></aside> : <Panel data={data} picked={picked} onPick={(kind, id) => layer && setPicked(layer.find(kind, id))} sample={sample} onSample={setSample} fills={layer?.fills ?? []} links={layer?.links} gates={layer?.gates} />}
  </>;
}

export { SAMPLE };
createRoot(document.getElementById("mock")!).render(<Mock />);
