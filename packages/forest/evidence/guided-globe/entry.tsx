import { useState } from "react";
import { createRoot } from "react-dom/client";
import { forestScene, storyNodes } from "@storytree/forest";
import { workStates } from "@storytree/arc-surface";
import { PlanetView, type GlobeControls, type GlobeSurfaces } from "@storytree/forest/view";
import { createKnowledgeCore } from "@storytree/knowledge-core/view";
import { mountArcSurface } from "@storytree/arc-surface/view";
import "@storytree/forest/view/styles.css";
import "@storytree/arc-surface/view/styles.css";

// The capture uses an existing saved reading; no app behavior is reproduced here.
declare const __SEED__: any;
declare const __SURVEY__: any;
const seed = __SEED__, survey = __SURVEY__;
const scene = forestScene(seed.tree, seed.changes.changes, workStates([]), survey);
const places = new Map(storyNodes(seed.tree, seed.changes.changes, survey).map(node => [node.id, node.place]));
const core = createKnowledgeCore("storytree"); core.take(seed.changes.changes, []);
const island = scene.islands.find(island => island.land?.files.some(file => file.capability))!;
const file = island.land!.files.find(file => file.capability)!;
// One labelled fixture claim proves its switch; it is not a recording of live activity.
const wisps = [{ session: "capture-fixture", story: island.story, colour: "#a688ed", phase: 0, faded: false, capabilities: [file.capability!] }];
const demo = (window as any).demo = { scene, story: island.story, capability: file.capability, path: file.path,
  controls: undefined as GlobeControls | undefined };
const onControls = (controls: GlobeControls | undefined) => { demo.controls = controls; };
const noop = () => {};
function Demo() {
  const [options, setOptions] = useState<{ surfaces?: Partial<GlobeSurfaces>; mode?: "forest" | "library"; highlighted?: string[] }>({});
  demo.options = setOptions;
  return <PlanetView core={core} scene={scene} places={places} wisps={wisps}
    selected={undefined} onPick={noop} onNote={noop} onWispHover={noop} onControls={onControls} {...options} />;
}
(globalThis as any).__storytreeCaptureGlobe = (get: any) => { demo.state = get; };
const root = createRoot(document.querySelector("#globe")!); root.render(<Demo />);
const arcs = mountArcSurface(document.querySelector("#arcs")!, { project: "camera-evidence", reads: {
  arcViews: async () => [], holds: async () => ({ waits: {}, heldOn: {} }),
  changesSince: async () => ({ changes: [], cursor: 0 }), linesSince: async () => ({ lines: [], cursor: 0 }),
} });
demo.arcs = arcs;
demo.dispose = () => { arcs.stop(); root.unmount(); core.dispose(); };
