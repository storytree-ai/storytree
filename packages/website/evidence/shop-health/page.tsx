// The shop's saved growth coloured by its own CI (ADR-0902), drawn by the shipped globe.
// ?stage=<id> draws that saved stage within the full plan's frame; ?play=1 plays the whole growth (&seconds=<length>).
// ?before=1 draws from the growth as it was exported before CI health (the file the capture passes in as `before`).
import { createRoot } from 'react-dom/client';
import { growthPlan, crossingLength, type PlanetSpot } from '@storytree/forest-world/planet';
import { createKnowledgeCore } from '@storytree/knowledge-core/view';
import { PlanetView } from '@storytree/forest/view';
import { buildPlanetPathways } from '@storytree/forest-world/geometry';
import after from '../../src/shop-snapshot.json' with { type: 'json' };
import before from 'before-snapshot' with { type: 'json' };

type Snapshot = { radius: number; scene: any; spots: [string, PlanetSpot][]; project: string; places: { id: string; place: number }[];
  stages: { id: string; at: string; scene: any; wisps?: any[] }[]; changes?: any[] };
const query = new URLSearchParams(location.search);
const saved = (query.get('before') === '1' ? before : after) as unknown as Snapshot;
const spots = new Map(saved.spots);
const pathways = buildPlanetPathways(saved.scene, spots, saved.radius);
const core = createKnowledgeCore(saved.project);
core.take((saved.changes ?? []) as any, []);
const places = new Map((saved.places ?? []).map(p => [p.id, p.place]));
const stage = saved.stages.find(s => s.id === query.get('stage'));
const play = query.get('play') === '1';
const plan = growthPlan(saved.stages.map(({ id, at, scene }) => ({ id, at, scene })), { fromPoint: true, seconds: Number(query.get('seconds') ?? 15),
  roadLength: link => crossingLength(pathways, link), until: saved.stages.at(-1)!.at });
let draws = 0;
(globalThis as any).__storytreeCaptureGlobe = (get: () => any) => {
  const { gl } = get();
  const render = gl.render.bind(gl);
  gl.render = (...args: any[]) => { draws++; return render(...args); };
  (window as any).shopProof = { draws: () => draws };
};
const none = () => {};
createRoot(document.getElementById('globe')!).render(
  <PlanetView core={core} scene={stage?.scene ?? saved.scene} places={places} frame={saved.scene} wisps={[]} selected={undefined}
    onPick={none} onNote={none} onWispHover={none} growth={play ? { plan } : undefined} />,
);
