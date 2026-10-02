import { useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { useThree, type RootState } from '@react-three/fiber';
import { Vector3, type Mesh } from 'three';
import { ForestWorldCanvas, type ForestWorldCanvasProps } from '../../src/ForestWorldCanvas.js';
import { buildRelaxedCells, buildScene, hexCenter } from '../../src/core/index.js';
import { shippedInput, shippedTerritory } from '../../src/core/testing/scene-fixture.js';
import { worldTo3D } from '../../src/world-to-3d.js';
import { GROUND_STATUS_ATTRIBUTE } from '../../src/banded-ground-material.js';
import kitBytes from '../../assets/dressing-kit.glb';

// A World-owned scene: three adjacent parcels, one attributed tree and one session wisp.
const tiles = [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 0, r: 1 }];
const drawTiles = tiles.map(h => ({ h, owner: 0 }));
const wheatSets = [new Set<string>()];
const centre = hexCenter(tiles[0]!);
const descriptors = worldTo3D(buildScene(shippedInput({
  offset: { x: 0, y: 0 }, drawTiles, wheatSets, empties: [], vegetation: {},
  relaxedCells: buildRelaxedCells(drawTiles, wheatSets, 'world-browser-proof'),
  trails: { segments: [], edges: [], caves: [], dropped: [] },
  territories: [shippedTerritory({
    id: 'world-proof', centroid: centre, treeSpot: centre,
    plants: [{ id: 'world-proof-cap', status: 'healthy', ...centre, title: 'World proof' }],
    wisps: [{ runId: 'world-proof-session', title: 'World proof session' }],
  })],
})));

let state: RootState;
let draws = 0;
let targets: unknown[] = [];
const ready: Array<{ state: string; canvas: boolean; targets: number }> = [];
const root = createRoot(document.getElementById('root')!);
const rendererState: ForestWorldCanvasProps['onRendererState'] = value => {
  ready.push({ state: value, canvas: !!document.querySelector('canvas'), targets: targets.length });
};
const nativeTargets: ForestWorldCanvasProps['onNativePropTargets'] = value => { targets = [...value]; };
let props: ForestWorldCanvasProps = {
  descriptors, kitBytes, onRendererState: rendererState, onNativePropTargets: nativeTargets,
};

// Observe the actual R3F root through the canvas's existing children seam; rendering still runs.
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

function show(change: Partial<ForestWorldCanvasProps> = {}) {
  props = { ...props, ...change };
  flushSync(() => root.render(<ForestWorldCanvas {...props}><Observe /></ForestWorldCanvas>));
}

function snapshot() {
  const core = state.scene.getObjectByName('WispCore') as Mesh | undefined;
  const shell = state.scene.getObjectByName('WispShell') as Mesh | undefined;
  const glow = state.scene.getObjectByName('WispGlow');
  const ground: Mesh[] = [];
  state.scene.traverse(object => {
    if ((object as Mesh).geometry?.hasAttribute(GROUND_STATUS_ATTRIBUTE)) ground.push(object as Mesh);
  });
  const wisp = core && shell ? (() => {
    core.geometry.computeBoundingBox(); shell.geometry.computeBoundingBox();
    return {
      inside: shell.geometry.boundingBox!.containsBox(core.geometry.boundingBox!),
      size: shell.geometry.boundingBox!.getSize(new Vector3()).toArray(),
      triangles: [core, shell].reduce((n, mesh) => n + (mesh.geometry.index?.count ?? mesh.geometry.attributes.position!.count) / 3, 0),
      glow: !!glow,
    };
  })() : null;
  return {
    ready, targets, draws, wisp, ground: ground.length,
    camera: { zoom: state.camera.zoom, position: state.camera.position.toArray() },
    controls: !!state.controls, backdrop: state.scene.background !== null,
    pointerEvents: getComputedStyle(document.querySelector('canvas')!.parentElement!).pointerEvents,
    triangles: state.gl.info.render.triangles,
  };
}

Object.assign(window, { worldProof: {
  snapshot,
  registered: (zoom: number, x: number, z: number, active = true, plants = false) => {
    const before = draws;
    show({ registered: { zoom, target: { x, z }, props: plants }, active });
    return { before, after: draws, camera: { zoom: state.camera.zoom, position: state.camera.position.toArray() } };
  },
  unmount: () => { flushSync(() => root.unmount()); },
  targets: () => targets,
} });
show();
