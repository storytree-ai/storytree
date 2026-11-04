/** Rollout 1's layout tool: round 13's (p-polish-3/tools/layout.ts) for any story's island, not only The library's. What it
 * no longer assumes:
 * - ONE MOUTH AND ONE WAY OUT, read by hand. Every dock the map lands this island's lanes at (docks.json, read off the page
 *   by docks.mjs) is a mouth: open land round it, its reach by the lanes it carries (MOUTH for 64 or more, KEYS_OPEN for
 *   one, between by the lanes' logarithm), and each interface's arrivals and ways out come and go by the dock the map gives
 *   their lanes.
 * - A RING OF INTERFACES ROUND THE WHOLE COAST. Each territory grows from a seed cell the search moves; an interface's seed
 *   starts on the coast nearest its dock, an internal's inland, and the search keeps an interface beside the open land or
 *   the coast (as round 9's guard did).
 * - EVERY CAPABILITY HOLDS CODE. A territory is code (the map's rule), so a capability with none has no land and its links
 *   have no settlement to reach; they are listed (`unplaced`), not routed. The island's unclaimed code is a territory with
 *   no capability (layout-core.ts's UNCLAIMED) and no links.
 * - THE MINIMUM AS A CELL COUNT. The map cuts every island into about CUT cells whatever its size, so round 13's 5 cells is
 *   less ground on a smaller island. MIN_SHARE gives every territory at least that share of the territories' land (5 of
 *   The library's 246 owned cells), and where the island cannot give every territory that much (more territories than
 *   1 / MIN_SHARE), each gets an equal share of what there is.
 * The search is round 13's (SEARCH=net): simulated annealing, seeded so it repeats, each change scored on the shared road
 * network routed over it (crossings, inside links over a third territory and the borders they cross, the road drawn, less a
 * reward for links between neighbours). It writes layouts/<story>.json and layouts/<story>.measures.json (BEFORE=1 below:
 * <story>.before.json).
 * Run from the checkout root (STORY a story id; The library by default):
 *   STORY=story_609c3b171b3f ITER=300 SEED=43 node --import tsx docs/design/capability-tree-3d/q-all-islands/tools/layout.ts
 * START=<layout.json> starts the search from an arrangement round 13's tool wrote (its ring order, turn and inland seeds,
 * grown again on this land), as The library's starts from round 3's (layouts/round3.json). */
import { readFileSync, writeFileSync } from "node:fs";
import { forestScene } from "../../../../../packages/forest/src/index.ts";
import { workStates } from "../../../../../packages/arc-surface/src/index.ts";
import { islandCoast } from "../../../../../packages/forest-world/src/geometry.ts";
import { onLand, territories, territoryAt, type TerritoryMap } from "../../../../../packages/forest/src/territories/territories.ts";
import { capabilityPlates } from "../../../../../packages/forest/src/view/nameplates.ts";
import { relayout, cellEdges, islandScale, scaleCoast, scaleMap, withCodeless, CUT, OPEN, UNCLAIMED, type P } from "./layout-core.ts";
import { network, type BorderSeg, type NetLink } from "./network.ts";
import { LIBRARY } from "./story.ts";

const HERE = "docs/design/capability-tree-3d/q-all-islands";
const data = JSON.parse(readFileSync(`${HERE}/data.json`, "utf8"));
const STORY = process.env.STORY ?? LIBRARY;
/** BEFORE=1: round 3's rules as they stood, for the check's before: no island scale, no land for a capability with no code,
 * the search routed with round 13's prices alone; written as layouts/<story>.before.json (`?layout=<story>.before`). */
const BEFORE = process.env.BEFORE === "1";
const NAME = `${STORY}${BEFORE ? ".before" : ""}`;
const story = data.stories[STORY];
if (!story) throw new Error(`no story ${STORY} in the snapshot`);
type Lane = { key: string; dir: "up" | "down" };
const readReal: { at: P; sea: P; lanes: Lane[] }[] = JSON.parse(readFileSync(`${HERE}/docks.json`, "utf8"))[STORY] ?? [];

const scene = forestScene(data.map.tree, data.map.changes, workStates([]), data.map.survey);
const island = scene.islands.find((one: { story: string }) => one.story === STORY)!;
// The island, scaled to The library's size (layout-core.ts's islandScale): everything below is in The library's units.
const realCoast = islandCoast(island), SCALE = BEFORE ? 1 : islandScale(realCoast), coast = scaleCoast(realCoast, 1 / SCALE);
const read = readReal.map(d => ({ ...d, at: { x: d.at.x / SCALE, z: d.at.z / SCALE }, sea: { x: d.sea.x / SCALE, z: d.sea.z / SCALE } }));
const caps: { id: string; title: string; dependsOn: { id: string }[] }[] = story.capabilities;
const titleOf = new Map(caps.map(c => [c.id, c.title]));
const short = (id: string) => (titleOf.get(id) ?? id).replace(/^\d+ · /, "");

const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.z - b.z);
const toSegD = (p: P, a: P, b: P) => { const dx = b.x - a.x, dz = b.z - a.z, l = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l)); return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz); };
const toCoast = (p: P) => Math.min(...coast.flatMap(l => l.map((a, i) => toSegD(p, a, l[(i + 1) % l.length]!))));
const polygonArea = (r: readonly P[]) => Math.abs(r.reduce((s, a, i) => { const b = r[(i + 1) % r.length]!; return s + a.x * b.z - b.x * a.z; }, 0) / 2);
const lengthOf = (line: P[]) => line.reduce((s, q, i) => i ? s + dist(line[i - 1]!, q) : 0, 0);

// The cut: the map's own cutter, finer, and each territory's id (a capability, or UNCLAIMED).
/** Rollout 1: every capability holds land (layout-core.ts's withCodeless); CODELESS=0 cuts the map's shares alone. */
const CODELESS_LAND = !BEFORE && process.env.CODELESS !== "0";
const fine: TerritoryMap = scaleMap(territories(CODELESS_LAND ? withCodeless(island.land!.territories, story.capabilities) : island.land!.territories, realCoast, CUT), 1 / SCALE);
const cells = fine.cells;
const N = cells.length;
const shares = fine.territories.map(t => ({ id: t.capability ?? UNCLAIMED, lines: t.lines }));
const held = new Set(shares.map(s => s.id));

// The links: inside the story (both ends here and on the land), and the lanes by the dock each comes ashore at.
type Link = { from: string; to: string };
const own = new Set(caps.map(c => c.id));
const insideAll: Link[] = caps.flatMap(c => c.dependsOn.filter(d => own.has(d.id)).map(d => ({ from: c.id, to: d.id })));
const inside = insideAll.filter(l => held.has(l.from) && held.has(l.to));
const unplaced: string[] = insideAll.filter(l => !inside.includes(l)).map(l => `${short(l.from)} → ${short(l.to)}`);
/** Arrivals and ways out, each by the dock its lanes use and the capability here they reach: `${dock}|${capability}`. */
const arriving = new Map<string, number>(), leaving = new Map<string, number>();
read.forEach((d, k) => {
  for (const lane of d.lanes) {
    const [from, to] = lane.key.split("->") as [string, string], mine = lane.dir === "down" ? to : from;
    if (!held.has(mine)) { unplaced.push(`${lane.dir === "down" ? "into" : "out of"} ${short(mine)}`); continue; }
    const m = lane.dir === "down" ? arriving : leaving, key = `${k}|${mine}`;
    m.set(key, (m.get(key) ?? 0) + 1);
  }
});
/** Each dock's own load: the lanes it carries that reach land here. */
const load = read.map((_, k) => [...arriving, ...leaving].filter(([key]) => key.startsWith(`${k}|`)).reduce((s, [, n]) => s + n, 0));
const coastal = [...new Set([...arriving.keys(), ...leaving.keys()].map(k => k.split("|")[1]!))];
const inland = shares.map(s => s.id).filter(id => !coastal.includes(id));

/** The open land's reach round a dock carrying `n` lanes, in ground units: KEYS_OPEN for one (round 11's Keys landfall),
 * MOUTH for 64 or more (round 11's mouth carried 188), between by the logarithm. BAND, open land all round the coast, is
 * round 10's (0 since round 11). */
const BAND = Number(process.env.BAND ?? 0), MOUTH = Number(process.env.MOUTH ?? 25), KEYS_OPEN = Number(process.env.KEYS_OPEN ?? 11);
const reachOf = (n: number) => n <= 0 ? 0 : KEYS_OPEN + (MOUTH - KEYS_OPEN) * Math.min(1, Math.log(n) / Math.log(64));
const docks = read.map((d, k) => ({ at: d.at, sea: d.sea, reach: +reachOf(load[k]!).toFixed(1), lanes: d.lanes.map(l => l.key), load: load[k]! }));
/** How deep inside the coast an interface's seed may lie (round 10's band). */
const FRONT = Number(process.env.FRONT ?? 9);
const isOpen = cells.map(c => toCoast(c.site) < BAND || docks.some(d => d.load > 0 && dist(c.site, d.at) < d.reach));
// Land a mouth's open land cuts off from the rest (a headland between two mouths) is open land too: the territories share
// one piece of land, so each can grow to its size.
{
  const piece = new Array<number>(N).fill(-1), sizes: number[] = [];
  for (let c = 0; c < N; c++) if (!isOpen[c] && piece[c] < 0) {
    const id = sizes.length, queue = [c]; piece[c] = id; let n = 0;
    while (queue.length) { const x = queue.pop()!; n++; for (const y of cells[x]!.neighbours) if (!isOpen[y] && piece[y] < 0) { piece[y] = id; queue.push(y); } }
    sizes.push(n);
  }
  const main = sizes.indexOf(Math.max(...sizes));
  for (let c = 0; c < N; c++) if (!isOpen[c] && piece[c] !== main) isOpen[c] = true;
}
const owned = isOpen.filter(o => !o).length;

/** Round 13's minimum, as a share of the territories' land: 5 of The library's 246 owned cells. */
const MIN_SHARE = Number(process.env.MIN_SHARE ?? 5 / 246);
const counts = new Map<string, number>();
const MIN = Math.max(1, Math.min(Math.floor(owned / shares.length), Math.round(MIN_SHARE * owned)));
{ // Largest remainder, at least one cell each, as the map apportions its own cut; then no territory under MIN.
  const total = shares.reduce((s, t) => s + t.lines, 0), spare = owned - shares.length;
  const raw = shares.map(t => ({ id: t.id, want: t.lines / total * spare }));
  raw.forEach(r => counts.set(r.id, 1 + Math.floor(r.want)));
  let left = owned - [...counts.values()].reduce((s, n) => s + n, 0);
  for (const r of [...raw].sort((a, b) => (b.want % 1) - (a.want % 1))) { if (left-- <= 0) break; counts.set(r.id, counts.get(r.id)! + 1); }
  for (const [id] of counts) while (counts.get(id)! < MIN) {
    const largest = [...counts].reduce((a, b) => b[1] > a[1] ? b : a)[0];
    counts.set(largest, counts.get(largest)! - 1); counts.set(id, counts.get(id)! + 1);
  }
}
/** A cell of the territories' land beside the open land or near the coast: where an interface's gate can open to the sea. */
const isFrontier = cells.map((c, i) => !isOpen[i] && (c.neighbours.some(n => isOpen[n]) || toCoast(c.site) < FRONT));

// ── Growing an arrangement from seeds (round 9's) ─────────────────────────────────────────────────────────────────────
function grow(seeds: Map<string, number>): string[] | undefined {
  const owner = new Array<string | undefined>(N).fill(undefined).map((_, c) => isOpen[c] ? OPEN : undefined);
  const have = new Map<string, number>();
  for (const [id, cell] of seeds) { if (owner[cell] !== undefined) return undefined; owner[cell] = id; have.set(id, 1); }
  const ids = [...seeds.keys()];
  let left = owned - ids.length;
  while (left > 0) {
    let best: string | undefined, most = -Infinity, take = -1;
    for (const id of ids) {
      const want = counts.get(id)!, got = have.get(id)!, need = (want - got) / want;
      if (need <= most) continue;
      let cell = -1, d = Infinity;
      const seed = cells[seeds.get(id)!]!.site;
      for (let c = 0; c < N; c++) if (owner[c] === id) for (const n of cells[c]!.neighbours) if (owner[n] === undefined) { const dd = dist(cells[n]!.site, seed); if (dd < d) { d = dd; cell = n; } }
      if (cell < 0) continue;
      best = id; most = need; take = cell;
    }
    if (best === undefined) break;
    owner[take] = best; have.set(best, have.get(best)! + 1); left--;
  }
  // A territory walled in short of its size leaves cells no one grew into: each goes to a territory beside it, and the
  // balance below hands cells along until every size is right again.
  for (let pass = 0; left > 0 && pass < N; pass++) for (let c = 0; c < N; c++) if (owner[c] === undefined) {
    const by = cells[c]!.neighbours.map(n => owner[n]).find((o): o is string => o !== undefined && o !== OPEN);
    if (by) { owner[c] = by; left--; }
  }
  if (left > 0) return undefined;
  balance(owner as string[], seeds);
  return owner as string[];
}
function staysWhole(owner: readonly string[], id: string, cell: number): boolean {
  const mine = owner.map((o, c) => o === id && c !== cell ? c : -1).filter(c => c >= 0);
  if (mine.length === 0) return false;
  const seen = new Set([mine[0]!]), queue = [mine[0]!];
  while (queue.length) { const c = queue.pop()!; for (const n of cells[c]!.neighbours) if (n !== cell && owner[n] === id && !seen.has(n)) { seen.add(n); queue.push(n); } }
  return seen.size === mine.length;
}
function balance(owner: string[], seeds: Map<string, number>): void {
  for (let round = 0; round < 200; round++) {
    const have = new Map<string, number>();
    for (const o of owner) if (o !== OPEN) have.set(o, (have.get(o) ?? 0) + 1);
    const under = [...counts].find(([id, n]) => (have.get(id) ?? 0) < n)?.[0];
    if (under === undefined) return;
    const next = new Map<string, Set<string>>();
    for (const [key] of cellEdges(cells)) { const [a, b] = key.split(":").map(Number) as [number, number]; if (owner[a] !== owner[b] && owner[a] !== OPEN && owner[b] !== OPEN) { (next.get(owner[a]!) ?? next.set(owner[a]!, new Set()).get(owner[a]!)!).add(owner[b]!); (next.get(owner[b]!) ?? next.set(owner[b]!, new Set()).get(owner[b]!)!).add(owner[a]!); } }
    const back = new Map<string, string>([[under, ""]]), queue = [under];
    let spare: string | undefined;
    while (queue.length && !spare) { const t = queue.shift()!; for (const n of next.get(t) ?? []) if (!back.has(n)) { back.set(n, t); if ((have.get(n) ?? 0) > counts.get(n)!) { spare = n; break; } queue.push(n); } }
    if (!spare) return;
    const chain: string[] = [];
    for (let t: string = spare; t !== ""; t = back.get(t)!) chain.push(t);
    for (let i = 0; i + 1 < chain.length; i++) {
      const giver = chain[i]!, taker = chain[i + 1]!, seed = cells[seeds.get(taker)!]!.site;
      const options = owner.map((o, c) => o === giver && c !== seeds.get(giver) && cells[c]!.neighbours.some(n => owner[n] === taker) ? c : -1).filter(c => c >= 0 && staysWhole(owner, giver, c));
      if (!options.length) return;
      const c = options.reduce((a, b) => dist(cells[a]!.site, seed) < dist(cells[b]!.site, seed) ? a : b);
      owner[c] = taker;
    }
  }
}

// ── The shared road network on an arrangement (round 10's), every dock a mouth ───────────────────────────────────────
/** The arrangement's own prices (round 13's, written into it for the page), and what the search routes with: those and the
 * page's own from polish rounds 2 and 3 (overlay.ts's ROUND2_NET and ROUND3_NET), so it scores the network the page draws.
 * Rollout 1: round 13's tool routed without the polish rounds' prices, so an arrangement could route here and not there. */
const NET = JSON.parse(process.env.NET_COST ?? '{"shareEntrance":1,"edge":0.8}');
const ROUTE = BEFORE ? NET : { ...NET, entranceApart: 6, openGate: 30, thirdArrival: 0.5, pairShare: 1 };
export function measureNet(map: TerritoryMap) {
  const plates = capabilityPlates(map), plate = new Map(plates.map(p => [p.capability, { x: p.x, z: p.z } as P]));
  // The unclaimed code has no name, so no plate; its middle cell stands in (it has no links, so nothing routes to it).
  const tAt = (p: P) => !onLand(p, coast) ? undefined : (() => { const t = territoryAt(map, p.x, p.z); return t === undefined ? "open" : t.capability ?? UNCLAIMED; })();
  const borders: BorderSeg[] = [];
  const ownerOf = (c: number) => { const t = map.territories[map.cells[c]!.territory]; return t === undefined ? "open" : t.capability ?? UNCLAIMED; };
  for (const b of map.borders) if (onLand(b.from, coast) && onLand(b.to, coast)) borders.push({ a: b.from, b: b.to, pair: [ownerOf(b.between[0]), ownerOf(b.between[1])] });
  const pairs = new Set(borders.map(b => [...b.pair].sort().join("|")));
  const links: NetLink[] = [
    ...[...arriving].map(([key, n]): NetLink => { const [k, id] = key.split("|") as [string, string]; return { key: `arrive:${k}->${id}`, kind: "arrival", from: docks[+k]!.at, to: plate.get(id)!, fromT: "sea", toT: id, links: n }; }),
    ...[...leaving].map(([key, n]): NetLink => { const [k, id] = key.split("|") as [string, string]; return { key: `${id}->leave:${k}`, kind: "out", from: plate.get(id)!, to: docks[+k]!.at, fromT: id, toT: "sea", links: n }; }),
    ...inside.map((l): NetLink => ({ key: `${l.from}->${l.to}`, kind: "inside", from: plate.get(l.from)!, to: plate.get(l.to)!, fromT: l.from, toT: l.to, links: 1 })),
  ];
  const served = new Set(links.flatMap(l => [l.fromT, l.toT]));
  const net = network({ tAt, toCoast, borders, links, mouths: docks.filter(d => d.load > 0).map(d => ({ at: d.at, reach: d.reach })), band: BAND,
    towns: [...plate].filter(([id]) => served.has(id)).map(([territory, at]) => ({ territory, at })), cost: ROUTE });
  const per = links.map(l => {
    const way = net.ways.get(l.key)!, seq: string[] = [];
    for (let i = 0; i + 1 < way.length; i++) { const t = tAt(way[i]!); if (t !== undefined && seq.at(-1) !== t) seq.push(t); }
    const third = [...new Set(seq.filter(t => t !== l.fromT && t !== l.toT && t !== "open"))];
    let entrance = way[0]!;
    if (l.kind === "arrival") { for (let i = 1; i < way.length; i++) if (tAt(way[i]!) === l.toT && tAt(way[i - 1]!) !== l.toT) entrance = way[i]!; }
    else if (l.kind === "out") entrance = way.find(p => tAt(p) !== l.fromT) ?? way.at(-1)!;
    return { key: l.key, kind: l.kind, from: l.fromT, to: l.toT, links: l.links, borders: seq.length - 1, third, neighbours: pairs.has([l.fromT, l.toT].sort().join("|")), length: lengthOf(way), points: way, entrance };
  });
  const ins = per.filter(p => p.kind === "inside");
  const segs = net.segments;
  return {
    net, per,
    row: {
      roadDrawn: Math.round(segs.reduce((s, x) => s + lengthOf(x.pts), 0)),
      overThird: ins.filter(p => p.third.length).length, overThirdBorders: ins.filter(p => p.third.length).reduce((s, p) => s + p.borders, 0),
      neighbours: ins.filter(p => p.neighbours).length, insideLinks: ins.length, segments: segs.length, junctions: net.junctions.length,
    },
  };
}
type NetRow = ReturnType<typeof measureNet>["row"];

// ── The search ───────────────────────────────────────────────────────────────────────────────────────────────────────
let seed = Number(process.env.SEED ?? 43);
const random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const frontierCells = cells.filter((_, c) => isFrontier[c]).map(c => c.index);
const inlandCells = cells.filter((_, c) => !isFrontier[c] && !isOpen[c]).map(c => c.index);
/** Every territory's seed cell. */
type Gene = Map<string, number>;
function score(r: NetRow, owners: readonly string[]): number {
  const offCoast = coastal.filter(id => !owners.some((o, c) => o === id && isFrontier[c])).length;
  return 10 * r.overThird + 3 * r.overThirdBorders + 0.05 * r.roadDrawn - 4 * r.neighbours + 500 * offCoast;
}
/** Why arrangements were turned down, for the error when none grows. */
const refused: Record<string, number> = {};
const no = (why: string) => { refused[why] = (refused[why] ?? 0) + 1; return undefined; };
function evaluate(g: Gene): { owners: string[]; s: number; net: NetRow } | undefined {
  if (new Set(g.values()).size !== g.size) return no("two seeds on one cell");
  const owners = grow(g);
  if (!owners) return no("does not grow");
  const have = new Map<string, number>(); for (const o of owners) have.set(o, (have.get(o) ?? 0) + 1);
  if ([...counts].some(([id, n]) => have.get(id) !== n)) return no("sizes off");
  if ([...counts.keys()].some(id => !staysWhole(owners, id, -1))) return no("a territory in pieces");
  // An arrangement the network cannot route every link over (a settlement walled in by borders too short for a gate) is
  // no arrangement.
  let r: NetRow;
  try { r = measureNet(relayout(fine, owners)).row; } catch (error) { if (String(error).includes("no road")) return no("no road"); throw error; }
  return { owners, s: score(r, owners), net: r };
}
function mutate(g: Gene): Gene {
  const out = new Map(g), ids = [...g.keys()], r = random();
  if (r < 0.3 && ids.length > 1) {
    // Swap two territories' seeds of a kind (two interfaces, or two internals).
    const a = ids[Math.floor(random() * ids.length)]!, pool = ids.filter(id => id !== a && coastal.includes(id) === coastal.includes(a));
    if (pool.length) { const b = pool[Math.floor(random() * pool.length)]!; out.set(a, g.get(b)!); out.set(b, g.get(a)!); }
  } else {
    // Move one seed: to a neighbouring cell of its kind mostly, sometimes anywhere of its kind.
    const id = ids[Math.floor(random() * ids.length)]!, kind = coastal.includes(id) ? isFrontier : cells.map((_, c) => !isOpen[c]);
    const taken = new Set(g.values());
    const near = (random() < 0.75 ? cells[g.get(id)!]!.neighbours.filter(n => kind[n]) : (coastal.includes(id) ? frontierCells : [...inlandCells, ...frontierCells])).filter(c => !taken.has(c));
    if (near.length) out.set(id, near[Math.floor(random() * near.length)]!);
  }
  return out;
}
/** The start: each interface on the coast nearest the dock that carries most of its lanes, each internal inland, nearest
 * the middle of the interfaces it links to (or the island's middle), every seed on its own cell. */
function start(): Gene {
  const g: Gene = new Map(), used = new Set<number>();
  // Seeds keep apart where they can (half the side of a territory's even share), so neighbours all have room to grow.
  const apart = 0.5 * Math.sqrt(owned / shares.length) * Math.sqrt(cells.reduce((s, c) => s + polygonArea(c.polygon), 0) / N);
  const take = (pool: number[], toward: P) => { const free = pool.filter(c => !used.has(c)), spaced = free.filter(c => [...used].every(u => dist(cells[u]!.site, cells[c]!.site) >= apart)); const c = (spaced.length ? spaced : free).reduce((b, c) => dist(cells[c]!.site, toward) < dist(cells[b]!.site, toward) ? c : b); used.add(c); return c; };
  for (const id of coastal) {
    const mine = [...arriving, ...leaving].filter(([key]) => key.endsWith(`|${id}`)).sort((a, b) => b[1] - a[1])[0]![0];
    g.set(id, take(frontierCells, docks[+mine.split("|")[0]!]!.at));
  }
  for (const id of inland) {
    const partners = inside.flatMap(l => l.from === id ? [l.to] : l.to === id ? [l.from] : []).filter(p => g.has(p)).map(p => cells[g.get(p)!]!.site);
    const toward = partners.length ? { x: partners.reduce((s, p) => s + p.x, 0) / partners.length * 0.6, z: partners.reduce((s, p) => s + p.z, 0) / partners.length * 0.6 } : { x: 0, z: 0 };
    g.set(id, take(inlandCells.length ? inlandCells : frontierCells, toward));
  }
  return g;
}
/** Round 13's arrangement (START), its ring order and turn turned into seed cells on this land as its tool placed them. */
function fromRound13(file: string): Gene {
  const prev = JSON.parse(readFileSync(file, "utf8")) as { ring: string[]; turn: number; inland: Record<string, number> };
  const g: Gene = new Map(), weight = (id: string) => Math.pow(counts.get(id) ?? 1, 0.6);
  const ring = prev.ring.filter(id => held.has(id)), total = ring.reduce((s, id) => s + weight(id), 0);
  let at = 0;
  for (const id of ring) {
    const a = prev.turn + (at + weight(id) / 2) / total * 2 * Math.PI; at += weight(id);
    const want = { x: Math.cos(a), z: Math.sin(a) };
    const cell = frontierCells.filter(c => ![...g.values()].includes(c)).reduce((b, c) => { const p = cells[c]!.site, q = cells[b]!.site, da = Math.abs(Math.atan2(p.x * want.z - p.z * want.x, p.x * want.x + p.z * want.z)), db = Math.abs(Math.atan2(q.x * want.z - q.z * want.x, q.x * want.x + q.z * want.z)); return da < db ? c : b; });
    g.set(id, cell);
  }
  for (const [id, cell] of Object.entries(prev.inland)) if (held.has(id) && cell < N && !isOpen[cell] && ![...g.values()].includes(cell)) g.set(id, cell);
  const fill = start();
  for (const [id, cell] of fill) if (!g.has(id)) g.set(id, [...g.values()].includes(cell) ? inlandCells.find(c => ![...g.values()].includes(c))! : cell);
  return g;
}

const ITER = Number(process.env.ITER ?? 300);
let g = process.env.START ? fromRound13(process.env.START) : start();
let e = evaluate(g);
for (let tries = 0; !e && tries < Number(process.env.TRIES ?? 2000); tries++) { const ng = mutate(g); const f = evaluate(ng); if (f) { g = ng; e = f; } else if (random() < 0.3) g = ng; }
if (!e) throw new Error(`no arrangement grows on ${story.story.title}'s land: ${JSON.stringify(refused)}`);
let here = { g, ...e }, best = { ...here };
const t0 = Date.now();
for (let i = 0; i < ITER; i++) {
  const temp = 20 * Math.pow(0.03, i / ITER), ng = mutate(here.g), f = evaluate(ng);
  if (!f) continue;
  if (f.s < here.s || random() < Math.exp((here.s - f.s) / temp)) here = { g: ng, ...f };
  if (here.s < best.s) { best = { ...here }; if (process.env.VERBOSE) console.error(`  ${i}: ${best.s.toFixed(1)} ${JSON.stringify(best.net)} ${((Date.now() - t0) / 1000).toFixed(0)}s`); }
}

const chosen = relayout(fine, best.owners);
const routed = measureNet(chosen);
/** Round 13's room: for each territory, the radius of the largest disc it holds (sampled on a half-unit grid). */
const nearestCell = (p: P) => cells.reduce((b, c) => dist(c.site, p) < dist(b.site, p) ? c : b);
const room = (() => {
  const mine = new Map<string, [P, P][]>();
  for (const b of chosen.borders) for (const c of b.between) { const id = best.owners[c]!; if (id !== OPEN) (mine.get(id) ?? mine.set(id, []).get(id)!).push([b.from, b.to]); }
  const out = new Map<string, number>(), step = Math.max(0.5, Math.sqrt(owned) / 60);
  for (let x = -130; x <= 130; x += step) for (let z = -130; z <= 130; z += step) {
    const p = { x, z }; if (!onLand(p, coast)) continue;
    const id = best.owners[nearestCell(p).index]!; if (id === OPEN) continue;
    const d = Math.min(toCoast(p), ...(mine.get(id) ?? []).map(([a, b]) => toSegD(p, a, b)));
    if (d > (out.get(id) ?? 0)) out.set(id, d);
  }
  return Object.fromEntries([...out].map(([id, r]) => [titleOf.get(id) ?? id, +r.toFixed(1)]).sort((a, b) => (a[1] as number) - (b[1] as number)));
})();
const fix = (line: P[]) => line.map(p => ({ x: +p.x.toFixed(2), z: +p.z.toFixed(2) }));
writeFileSync(`${HERE}/layouts/${NAME}.json`, JSON.stringify({
  story: STORY, scale: +SCALE.toFixed(4), codeless: CODELESS_LAND, cells: N, owners: best.owners, seeds: Object.fromEntries(best.g), min: MIN,
  docks: docks.map(({ at, sea, reach, lanes, load }) => ({ at, sea, reach, lanes, load })),
  open: { band: BAND, mouth: MOUTH, keys: KEYS_OPEN }, net: NET,
  landings: routed.per.filter(p => p.kind !== "inside").map(p => ({ capability: p.kind === "out" ? p.from : p.to, dock: Number(p.key.match(/(?:arrive:|leave:)(\d+)/)![1]), dir: p.kind === "out" ? "up" : "down", at: { x: +p.entrance.x.toFixed(2), z: +p.entrance.z.toFixed(2) }, links: p.links })),
  unplaced,
}) + "\n");
writeFileSync(`${HERE}/layouts/${NAME}.measures.json`, JSON.stringify({
  story: story.story.title, score: +best.s.toFixed(1), network: routed.row, min: MIN, owned, open: N - owned, room,
  ways: routed.per.map(({ points, entrance, ...p }) => ({ ...p, points: fix(points) })),
}) + "\n");
console.log(JSON.stringify({ story: story.story.title, score: +best.s.toFixed(1), ...routed.row, min: MIN, owned, smallestRoom: Object.entries(room)[0], unplaced: unplaced.length, seconds: Math.round((Date.now() - t0) / 1000) }));
