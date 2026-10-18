import { useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { useFrame, useThree, type RootState } from '@react-three/fiber';
import { PlanetWorldCanvas, SHEET_RADIUS, sheetSpot } from '../../src/planet/PlanetWorldCanvas.js';
import type { ForestScene, Island } from '../../src/scene.js';

// A World-owned glass sheet: two islands and the link between them, laid on the sheet.
const island = (story: string, capabilities: string[]): Island => ({
  story, title: story, x: 0, z: 0, radius: 1, key: story,
  trees: capabilities.map((capability, i) => ({ capability, form: 'green', status: 'healthy', contracts: 1, x: i, z: 0, scale: 1, turn: 0 })),
});
const scene: ForestScene = { islands: [island('a', ['a1', 'a2']), island('b', ['b1', 'b2'])], links: [{ from: 'a2', to: 'a1' }, { from: 'b1', to: 'a1' }] };
const spots = new Map([['a', sheetSpot({ x: 60, y: 0 })], ['b', sheetSpot({ x: -60, y: 0 })]]);
const sheet = { width: 260, height: 160 };

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

// An animating map, as the site's is while its core and camera move: every frame asks for the next.
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

// The canvas's WebGL context, so a capture can lose and restore it as a busy GPU would (6.15). A lost
// context hands out no extensions, so the one asked for before the loss is kept.
let losing: WEBGL_lose_context | null | undefined;
const context = () => losing ??= state?.gl.getContext().getExtension('WEBGL_lose_context');

Object.assign(window, { planetProof: { snapshot, loseContext: () => context()?.loseContext(), restoreContext: () => context()?.restoreContext() } });
// `?idle` mounts a still map, which draws only when something asks it to (6.15).
const idle = new URLSearchParams(location.search).has('idle');
createRoot(document.getElementById('globe')!).render(
  <PlanetWorldCanvas scene={scene} spots={spots} radius={SHEET_RADIUS} sheet={sheet}><Observe />{!idle && <Turning />}</PlanetWorldCanvas>,
);
