// The globe's growth (world 7), replayed in the shipped engine from the website's own recordings:
// Conduit's saved growth stage by stage, or storytree's saved reading grown from one point.
// ?map=conduit|storytree  &seconds=<length>  &at=<seconds> fixes a moment; absent, it plays on the canvas's clock.
import { createRoot } from 'react-dom/client';
import { useFrame, useThree } from '@react-three/fiber';
import { PlanetWorldCanvas, growthPlan, crossingLength, SHIPPED_ELEVATION_DEG, type PlanetSpot } from '@storytree/forest-world/planet';
import { buildPlanetPathways } from '@storytree/forest-world/geometry';
import conduit from '../../src/conduit-snapshot.json' with { type: 'json' };
import storytree from '../../src/forest-snapshot.json' with { type: 'json' };

type Snapshot = { radius: number; scene: any; spots: [string, PlanetSpot][]; stages?: { id: string; scene: any }[] };
const query = new URLSearchParams(location.search);
const map = query.get('map') === 'storytree' ? 'storytree' : 'conduit';
const saved = (map === 'conduit' ? conduit : storytree) as unknown as Snapshot;
const spots = new Map(saved.spots);
const pathways = buildPlanetPathways(saved.scene, spots, saved.radius);
// Conduit's recorded stages; storytree's one saved reading, grown by its dependencies alone.
const stages = saved.stages?.map(({ id, scene }) => ({ id, scene })) ?? [{ id: 'saved', scene: saved.scene }];
const plan = growthPlan(stages, { fromPoint: true, seconds: Number(query.get('seconds') ?? 15), roadLength: link => crossingLength(pathways, link) });
const at = query.get('at');
// Turn the islands' middle toward the eye: the shortest turn from one unit direction to another.
const sum = [...spots.values()].reduce((m, s) => { const l = Math.hypot(s.x, s.y, s.z); return [m[0]! + s.x / l, m[1]! + s.y / l, m[2]! + s.z / l]; }, [0, 0, 0]);
const u = sum.map(c => c / Math.hypot(...sum));
const elevation = SHIPPED_ELEVATION_DEG * Math.PI / 180;
const v = [0, Math.sin(elevation), Math.cos(elevation)];
const q = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!, 1 + u[0]! * v[0]! + u[1]! * v[1]! + u[2]! * v[2]!];
const rotation = q.map(c => c / Math.hypot(...q)) as [number, number, number, number];

let draws = 0;
const intervals: number[] = [];
let last = 0;
(globalThis as any).__storytreeCaptureGlobe = (get: () => any) => {
  const { gl } = get();
  const render = gl.render.bind(gl);
  gl.render = (...args: any[]) => { draws++; const now = performance.now(); if (last) intervals.push(now - last); last = now; return render(...args); };
  (window as any).growthProof = {
    plan: { seconds: plan.seconds, stages: plan.stages, islands: plan.islands.size, roads: plan.roads.size, capabilities: plan.capabilities.size, files: plan.files.size },
    snapshot: () => {
      const { scene, clock } = get();
      const plates = scene.getObjectByName('globe').children.filter((c: any) => c.name.startsWith('planet:') && c.name !== 'planet:shell');
      return { draws, clock: clock.getElapsedTime(), visiblePlates: plates.filter((p: any) => p.visible).length, plates: plates.length };
    },
    frames: () => intervals.splice(0),
  };
};
// ?baseline=1: the same globe with no growth, redrawn every frame, for the frame rate to be read against.
const baseline = query.get('baseline') === '1';
function Redraw() { const invalidate = useThree(state => state.invalidate); useFrame(() => invalidate()); return null; }
createRoot(document.getElementById('globe')!).render(
  <PlanetWorldCanvas scene={saved.scene} spots={spots} radius={saved.radius} rotation={rotation}
    growth={baseline ? undefined : { plan, at: at === null ? undefined : Number(at) }}>{baseline && <Redraw />}</PlanetWorldCanvas>,
);
