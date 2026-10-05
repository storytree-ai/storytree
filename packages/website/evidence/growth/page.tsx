// The globe's growth (world 7), replayed in the shipped engine from the website's own recordings:
// the shop's saved growth stage by stage, or storytree's saved reading grown from one point by its own dated history,
// each with its knowledge core growing with it.
// ?map=shop|storytree  &seconds=<length>  &at=<seconds> fixes a moment; absent, it plays on the canvas's clock.
import { createRoot } from 'react-dom/client';
import { growthPlan, crossingLength, type PlanetSpot } from '@storytree/forest-world/planet';
import { createKnowledgeCore } from '@storytree/knowledge-core/view';
import { PlanetView } from '@storytree/forest/view';
import { buildPlanetPathways } from '@storytree/forest-world/geometry';
import shop from '../../src/shop-snapshot.json' with { type: 'json' };
import storytree from '../../src/forest-snapshot.json' with { type: 'json' };

type Change = { recordId: string; action: string; record: { createdAt: string } };
type Snapshot = { radius: number; scene: any; spots: [string, PlanetSpot][]; capturedAt: string; project: string; places: { id: string; place: number }[];
  stages?: { id: string; at: string; scene: any; wisps?: any[] }[]; changes?: Change[] };
const query = new URLSearchParams(location.search);
const map = query.get('map') === 'storytree' ? 'storytree' : 'shop';
const saved = (map === 'shop' ? shop : storytree) as unknown as Snapshot;
const spots = new Map(saved.spots);
const pathways = buildPlanetPathways(saved.scene, spots, saved.radius);
// The shop's recorded stages; storytree's saved reading, staged by when its library recorded each story and capability.
// A shop stage whose recorded sessions changed holds a beat, so each claim and landing is seen (world 7.6).
const sessionsOf = (i: number) => JSON.stringify(saved.stages?.[i]?.wisps?.map(w => [w.session, w.story]) ?? []);
const stages = saved.stages?.map(({ id, at, scene }, i) => ({ id, at, scene, ...(sessionsOf(i) !== sessionsOf(i - 1) ? { hold: 1 } : {}) })) ?? datedStages(saved);
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

// The knowledge core, from the library history the reading saved; each note shows from its recorded date.
const core = createKnowledgeCore(saved.project);
core.take((saved.changes ?? []) as any, []);
const at = query.get('at');

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
        visibleFiles: files.filter(f => f.visible && f.scale.x > 0.01).length, files: files.length,
        // A session's claim: the outline on the territory it held, on a plate that shows (forest 5.7, ADR-0923 D3).
        sessions: claims(scene) };
    },
    frames: () => intervals.splice(0),
  };
};
/** Each claimed territory's outline drawn on a showing plate, as `capability@story`. */
function claims(scene: any): string[] {
  const shown: string[] = [];
  scene.traverse((o: any) => {
    if (!o.name.startsWith('territory-claim:')) return;
    let plate = o, visible = true;
    for (; plate && !plate.name?.startsWith('planet:'); plate = plate.parent) visible &&= plate.visible;
    if (visible && plate?.visible) shown.push(`${o.name.slice('territory-claim:'.length)}@${plate.name.slice('planet:'.length)}`);
  });
  return shown.sort();
}
const growth = baseline ? undefined : { plan, at: at === null ? undefined : Number(at) };
// Both grow in The forest's own globe, their territories and file circles filling in behind each island and their cores'
// notes appearing (forest 3.30, knowledge core 1.9); the shop's recording with the sessions it recorded outlining the
// territories they held (forest 5.7), within its full plan as the tour draws it.
const places = new Map((saved.places ?? []).map(p => [p.id, p.place]));
const sessions = saved.stages?.map(({ at, wisps }) => ({ at, wisps: wisps ?? [] }));
const none = () => {};
createRoot(document.getElementById('globe')!).render(
  <PlanetView core={core} scene={saved.scene} places={places} frame={map === 'shop' ? saved.scene : undefined} wisps={[]} selected={undefined}
    onPick={none} onNote={none} growth={growth} recordedSessions={growth && sessions} />,
);
