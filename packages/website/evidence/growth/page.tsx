// The globe's growth (world 7), replayed in the shipped engine from the website's own recordings:
// Conduit's saved growth stage by stage, or storytree's saved reading grown from one point by its own dated history,
// its knowledge core growing with it.
// ?map=conduit|storytree  &seconds=<length>  &at=<seconds> fixes a moment; absent, it plays on the canvas's clock.
import { createRoot } from 'react-dom/client';
import { PlanetWorldCanvas, growthPlan, crossingLength, SHIPPED_ELEVATION_DEG, type PlanetSpot } from '@storytree/forest-world/planet';
import { createKnowledgeCore } from '@storytree/knowledge-core/view';
import { PlanetView } from '@storytree/forest/view';
import { buildPlanetPathways } from '@storytree/forest-world/geometry';
import conduit from '../../src/conduit-snapshot.json' with { type: 'json' };
import storytree from '../../src/forest-snapshot.json' with { type: 'json' };

type Change = { recordId: string; action: string; record: { createdAt: string } };
type Snapshot = { radius: number; scene: any; spots: [string, PlanetSpot][]; capturedAt: string; project: string; places: { id: string; place: number }[];
  stages?: { id: string; at: string; scene: any }[]; changes?: Change[] };
const query = new URLSearchParams(location.search);
const map = query.get('map') === 'storytree' ? 'storytree' : 'conduit';
const saved = (map === 'conduit' ? conduit : storytree) as unknown as Snapshot;
const spots = new Map(saved.spots);
const pathways = buildPlanetPathways(saved.scene, spots, saved.radius);
// Conduit's recorded stages; storytree's saved reading, staged by when its library recorded each story and capability.
const stages = saved.stages?.map(({ id, at, scene }) => ({ id, at, scene })) ?? datedStages(saved);
const plan = growthPlan(stages, { fromPoint: true, seconds: Number(query.get('seconds') ?? 15), roadLength: link => crossingLength(pathways, link),
  until: saved.stages?.at(-1)?.at ?? saved.capturedAt });

/** The saved plan as it stood when each story was recorded (stories recorded in the same minute together), then whole
 * as saved: an island once its story was created, a capability once it was, a link once both its ends were. Nothing else. */
function datedStages({ scene, changes = [], capturedAt }: Snapshot) {
  const created = new Map(changes.filter(c => c.action === 'created').map(c => [c.recordId, c.record.createdAt]));
  const born = (id: string | undefined) => (id === undefined ? undefined : created.get(id)) ?? '';
  const minutes = new Map<string, string>();
  for (const island of scene.islands) {
    const at = born(island.story), minute = at.slice(0, 16);
    if (at > (minutes.get(minute) ?? '')) minutes.set(minute, at);
  }
  const state = (at: string) => {
    const islands = scene.islands.filter((i: any) => born(i.story) <= at)
      .map((i: any) => ({ ...i, trees: i.trees.filter((t: any) => born(t.capability) <= at) }));
    const present = new Set(islands.flatMap((i: any) => i.trees.map((t: any) => t.capability)));
    return { islands, links: (scene.links ?? []).filter((l: any) => present.has(l.from) && present.has(l.to)) };
  };
  return [...[...minutes.values()].sort().map(at => ({ id: at, at, scene: state(at) })), { id: 'saved', at: capturedAt, scene }];
}

// storytree's knowledge core, from the library history the reading saved; each note shows from its recorded date.
const core = createKnowledgeCore(saved.project);
core.take((saved.changes ?? []) as any, []);
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
// ?baseline=1: the same globe with no growth, redrawn every frame, for the frame rate to be read against.
const baseline = query.get('baseline') === '1';
(globalThis as any).__storytreeCaptureGlobe = (get: () => any) => {
  const { gl } = get();
  if (baseline) { const redraw = () => { get().invalidate(); requestAnimationFrame(redraw); }; redraw(); }
  const render = gl.render.bind(gl);
  gl.render = (...args: any[]) => { draws++; const now = performance.now(); if (last) intervals.push(now - last); last = now; return render(...args); };
  (window as any).growthProof = {
    plan: { seconds: plan.seconds, stages: plan.stages, islands: plan.islands.size, roads: plan.roads.size, capabilities: plan.capabilities.size, files: plan.files.size },
    snapshot: () => {
      const { scene, clock } = get();
      const plates = scene.getObjectByName('globe').children.filter((c: any) => c.name.startsWith('planet:') && c.name !== 'planet:shell');
      const notes: any[] = [];
      scene.getObjectByName('knowledge-points')?.children.forEach((c: any) => { if (c.name.startsWith('knowledge-point:')) notes.push(c); });
      // Territories and file circles count once mounted on their island, and as filled in once they show (forest 3.30).
      const parts: any[] = [], files: any[] = [];
      scene.traverse((o: any) => { if (o.name.startsWith('territory:') && typeof o.userData.capability === 'string') parts.push(o); else if (o.name.startsWith('file:')) files.push(o); });
      return { draws, clock: clock.getElapsedTime(), visiblePlates: plates.filter((p: any) => p.visible).length, plates: plates.length,
        visibleNotes: notes.filter(n => n.visible).length, notes: notes.length,
        visibleTerritories: parts.filter(t => t.visible).length, territories: parts.length,
        visibleFiles: files.filter(f => f.visible && f.scale.x > 0.01).length, files: files.length };
    },
    frames: () => intervals.splice(0),
  };
};
const growth = baseline ? undefined : { plan, at: at === null ? undefined : Number(at) };
// storytree's saved reading has code states: it grows in The forest's own globe, its territories and file circles filling in
// behind each island and its core's notes appearing (forest 3.30). Conduit's has neither, and grows in the bare engine.
const places = new Map((saved.places ?? []).map(p => [p.id, p.place]));
const none = () => {};
createRoot(document.getElementById('globe')!).render(map === 'storytree'
  ? <PlanetView core={core} scene={saved.scene} places={places} wisps={[]} selected={undefined} onPick={none} onNote={none} onWispHover={none} growth={growth} />
  : <PlanetWorldCanvas scene={saved.scene} spots={spots} radius={saved.radius} rotation={rotation} growth={growth} />,
);
