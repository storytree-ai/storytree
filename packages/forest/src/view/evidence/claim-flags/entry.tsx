import { useState } from "react";
import { createRoot } from "react-dom/client";
import { forestScene, sessionColour, storyNodes, type SessionWisp } from "@storytree/forest";
import { workStates } from "@storytree/arc-surface";
import { PlanetView, type GlobeControls } from "@storytree/forest/view";
import { createKnowledgeCore } from "@storytree/knowledge-core/view";

// The capture uses an existing saved reading; the claims are labelled fixtures, not a recording of live activity.
declare const __SEED__: any;
declare const __SURVEY__: any;
const seed = __SEED__, survey = { ...__SURVEY__ };
// The surveyed island with the most claimable territories, and a neighbour of it left with no code yet (ADR-0968 D4).
const surveyed = forestScene(seed.tree, seed.changes.changes, workStates([]), survey);
const built = [...surveyed.islands].filter(island => island.land?.files.length).sort((a, b) =>
  (b.land!.territories.filter(t => t.capability).length - a.land!.territories.filter(t => t.capability).length))[0]!;
const bare = surveyed.islands.find(island => island.story !== built.story && (seed.tree.stories.find((s: any) => s.id === island.story)?.capabilities.length ?? 0) >= 3)!;
delete survey[bare.story];
const scene = forestScene(seed.tree, seed.changes.changes, workStates([]), survey);
const places = new Map(storyNodes(seed.tree, seed.changes.changes, survey).map(node => [node.id, node.place]));
const core = createKnowledgeCore("storytree"); core.take(seed.changes.changes, []);
const caps = (story: string) => scene.islands.find(island => island.story === story)!.land!.territories.flatMap(t => t.capability ?? []);
const [a, b, c, d] = caps(built.story), [lotA, lotB] = caps(bare.story);
const wisp = (session: string, story: string, capabilities: string[], faded = false): SessionWisp => ({ session, story, colour: sessionColour(session), faded, capabilities });
// Three sessions on neighbouring capabilities in three colours, and one staking two lots on the island with no code.
const held = [wisp("3b229329-6239-408a-a88c-2669d839ca45", built.story, [a!]), wisp("6f840d71-eb64-48f6-a176-c7f28c62e1e0", built.story, [b!]),
  wisp("f0697f0c-0b04-458c-a539-c36eab0d0743", built.story, [c!]), wisp("a3f81c52-7d0e-4b96-8a14-2c5e9d10b7f3", bare.story, [lotA!, lotB!])];
const newcomer = (faded: boolean) => wisp("5be07d94-1c28-4f6a-b3d9-e8a4c60f2117", built.story, [d!], faded);
const demo = (window as any).demo = { built: built.story, bare: bare.story, claims: { a, b, c, d, lotA, lotB }, t: undefined as number | undefined,
  controls: undefined as GlobeControls | undefined, stage: (text: string) => { document.querySelector("#stage")!.textContent = text; } } as any;
const noop = () => {};
function Demo() {
  const [wisps, setWisps] = useState<readonly SessionWisp[]>(held);
  demo.arrive = () => setWisps([...held, newcomer(false)]);
  demo.quiet = () => setWisps([...held, newcomer(true)]);
  demo.release = () => setWisps(held);
  return <PlanetView core={core} scene={scene} places={places} wisps={wisps} library={false}
    selected={undefined} onPick={noop} onNote={noop} onControls={controls => { demo.controls = controls; }} />;
}
(globalThis as any).__storytreeCaptureGlobe = (get: any) => {
  demo.state = get;
  // A capture holds the globe's clock still at `demo.t`, so each picture of a claim's life is taken at a known moment.
  const clock = get().clock, real = clock.getElapsedTime.bind(clock);
  clock.getElapsedTime = () => demo.t ?? real();
};
createRoot(document.querySelector("#globe")!).render(<Demo />);
