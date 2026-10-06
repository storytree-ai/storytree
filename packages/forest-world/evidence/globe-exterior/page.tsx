// World 6.7, mounted: the globe as a host mounts it, in real Chromium, its exterior switched layer by layer.
// Two islands and the roads between them, as the planet's own tests lay them out.
import { createRoot } from 'react-dom/client';
import type { Object3D } from 'three';
import type { ForestScene, Island } from '../../src/scene.js';
import { PlanetWorldCanvas } from '../../src/planet/PlanetWorldCanvas.js';
import type { PlanetSurfaceVisibility } from '../../src/planet/exterior.js';

const R = 218;
const island = (story: string, capabilities: string[]): Island => ({
  story, title: story, x: 0, z: 0, key: story,
  trees: capabilities.map((capability, i) => ({ capability, form: 'green', status: 'healthy', contracts: 1, x: i, z: 0, scale: 1, turn: 0 })),
});
const scene: ForestScene = { islands: [island('a', ['a1', 'a2']), island('b', ['b1', 'b2'])], links: [{ from: 'a2', to: 'a1' }, { from: 'b1', to: 'a1' }, { from: 'b2', to: 'b1' }] };
const spots = new Map([['a', { x: R * Math.sin(0.3), y: 0, z: R * Math.cos(0.3) }], ['b', { x: -R * Math.sin(0.3), y: 0, z: R * Math.cos(0.3) }]]);
const stories = scene.islands.map(i => i.story);

let globe: (() => any) | undefined;
(globalThis as any).__storytreeCaptureGlobe = (get: () => any) => { globe = get; (globalThis as any).__globe = get(); };
const root = createRoot(document.querySelector<HTMLElement>('#globe')!);

/** Whether an object is drawn: it and every parent visible. */
const shown = (object: Object3D | undefined) => {
  if (object === undefined) return false;
  for (let node: Object3D | null = object; node !== null; node = node.parent) if (!node.visible) return false;
  return true;
};

(window as any).proof = {
  stories,
  mount(surface: boolean, surfaces?: Partial<PlanetSurfaceVisibility>) {
    root.render(<PlanetWorldCanvas scene={scene} spots={spots} radius={R} surface={surface} surfaces={surfaces}
      plateChildren={island => <mesh name={`mark:${island.story}`} />} />);
  },
  ready: () => globe !== undefined && stories.every(story => globe!().scene.getObjectByName(`island-surface:${story}`) !== undefined),
  /** What the mounted globe draws: its sea, each island's ground, its roads, and each island's host mark. */
  drawn() {
    const world = globe!().scene;
    const roads = world.getObjectByName('globe-roads');
    let pathways = 0;
    roads?.traverse((node: Object3D) => { if (node.name.startsWith('pathway:')) pathways++; });
    return {
      sea: shown(world.getObjectByName('planet:shell')),
      grounds: stories.map(story => shown(world.getObjectByName(`island-surface:${story}`))),
      roads: pathways > 0 && shown(roads),
      marks: stories.map(story => shown(world.getObjectByName(`mark:${story}`))),
    };
  },
  dispose() { root.unmount(); },
};
