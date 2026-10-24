// The LinkedIn clip's page: storytree's own map growing on the glass sheet in the shipped engine, from the reading read.ts
// made (served as /reading.json), the map alone with no knowledge core under the glass, and its sessions' claims, held at a moment the
// capture sets frame by frame (window.clip.at). ?ground=<the view's short half-side, in the sheet's ground units>.
import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { growthPlan } from "@storytree/forest-world/planet";
import { SHEET_RADIUS } from "@storytree/forest-world/planet";
import { createKnowledgeCore } from "@storytree/knowledge-core/view";
import { PlanetView, globeLayers, type GlobeControls, type GlobeSurfaces } from "@storytree/forest/view";

const query = new URLSearchParams(location.search);
const reading = await (await fetch("/reading.json")).json();
const plan = growthPlan(reading.stages, { seconds: Number(query.get("seconds") ?? 18), until: reading.capturedAt });
const core = createKnowledgeCore(reading.project);
const places = new Map<string, number>(reading.places.map((p: { id: string; place: number }) => [p.id, p.place]));
const surfaces: GlobeSurfaces = { grounds: true, roads: true, nameplates: true, territories: "health", fileCircles: true, knowledgeCore: false, sessionTints: true };
const layers = globeLayers({ stories: true, library: true }, true);
const framing = Number(query.get("ground") ?? 520) / SHEET_RADIUS;
const none = () => {};

let draws = 0;
(globalThis as any).__storytreeCaptureGlobe = (get: () => any) => {
  const { gl } = get();
  const render = gl.render.bind(gl);
  gl.render = (...args: any[]) => { draws++; return render(...args); };
};
const frames = (n: number) => new Promise<void>(done => { const step = () => (n-- <= 0 ? done() : requestAnimationFrame(step)); step(); });

function Clip() {
  const [at, setAt] = useState(0);
  const [controls, setControls] = useState<GlobeControls>();
  useEffect(() => {
    if (!controls) return;
    void (async () => {
      // The sheet framed whole, aimed again until it is drawn; the capture then tilts it as a hand would (a right-drag).
      for (let tries = 0; tries < 400 && !controls.stop({ target: { kind: "core" }, framing, duration: 0, sideOffset: 0 }); tries++) await frames(2);
      await new Promise(done => setTimeout(done, 1500));
      (window as any).clip = {
        seconds: plan.seconds, stages: plan.stages.length,
        /** Holds the replay at `seconds` and resolves once the canvas has drawn it and stopped drawing. */
        async at(seconds: number) {
          setAt(seconds);
          let last = -1;
          for (let still = 0; still < 3;) { await frames(1); still = draws === last ? still + 1 : 0; last = draws; }
        },
      };
    })();
  }, [controls]);
  return <PlanetView core={core} scene={reading.scene} places={places} frame={reading.scene} wisps={[]} selected={undefined}
    onPick={none} onNote={none} onControls={setControls} surfaces={surfaces} framing={framing} sideOffset={0}
    mode={layers.mode} library={layers.library} growth={{ plan, at }} recordedSessions={reading.sessions} />;
}
createRoot(document.getElementById("map")!).render(<Clip />);
