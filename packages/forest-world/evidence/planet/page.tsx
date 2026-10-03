import { useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { useFrame, useThree, type RootState } from '@react-three/fiber';
import { PlanetWorldCanvas } from '../../src/planet/PlanetWorldCanvas.js';
import type { ForestScene, Island } from '../../src/scene.js';

// A World-owned globe: two islands and the link between them, as the planet's own tests lay them.
const island = (story: string, capabilities: string[]): Island => ({
  story, title: story, x: 0, z: 0, radius: 1, key: story,
  trees: capabilities.map((capability, i) => ({ capability, form: 'green', status: 'healthy', contracts: 1, x: i, z: 0, scale: 1, turn: 0 })),
});
const scene: ForestScene = { islands: [island('a', ['a1', 'a2']), island('b', ['b1', 'b2'])], links: [{ from: 'a2', to: 'a1' }, { from: 'b1', to: 'a1' }] };
const spots = new Map([['a', { x: Math.sin(0.3), y: 0, z: Math.cos(0.3) }], ['b', { x: -Math.sin(0.3), y: 0, z: Math.cos(0.3) }]]);

let state: RootState | undefined;
let draws = 0;

// Observe the actual R3F root through the canvas's children seam; rendering still runs.
function Observe() {
  const current = useThree();
  state = current;
  useLayoutEffect(() => {
    const render = current.gl.render.bind(current.gl);
    current.gl.render = (...args) => { draws++; return render(...args); };
    return () => { current.gl.render = render; };
  }, [current.gl]);
  return null;
}

// An animating globe, as the site's is while its core and camera move: every frame asks for the next.
function Turning() {
  const invalidate = useThree(current => current.invalidate);
  useFrame(({ scene: world }) => { world.rotation.y += 0.004; invalidate(); });
  return null;
}

function snapshot() {
  return {
    created: state !== undefined, draws, frameloop: state?.frameloop,
    // Reading the clock advances it, as the canvas's own frames do.
    clock: state?.clock.getElapsedTime(), at: performance.now(),
    camera: state ? { zoom: state.camera.zoom, position: state.camera.position.toArray() } : undefined,
    plates: state?.scene.getObjectByName('globe')?.children.length,
    top: document.querySelector('canvas')?.getBoundingClientRect().top,
  };
}

Object.assign(window, { planetProof: { snapshot } });
createRoot(document.getElementById('globe')!).render(
  <PlanetWorldCanvas scene={scene} spots={spots} radius={218}><Observe /><Turning /></PlanetWorldCanvas>,
);
