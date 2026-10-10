// Storytree's own globe as the desktop lays it out, measured on screen at the view the app opens on:
// for every dependency, is the dependent's island north of the island it depends on, where the eye sees them?
// Reads the live library (read only, as ../rows/seed.mts does) and this checkout's code survey; writes
// measurements.json, seed.json.gz and survey.json (for capture.mjs) and one schematic per view beside this file.
// Run: node --import tsx measure.mts
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openNamedProject, requireApproval, route } from '@storytree/agent-link';
import { workStates } from '@storytree/arc-surface';
import { islandCoastReach } from '@storytree/forest-world/geometry';
import { connect } from '@storytree/library';
import { readCodeSurvey } from '../../../code-survey/read-survey.js';
import { forestScene, openingTurn, storyNodes } from '../../../index.js';
import { MAX_NUDGE, SEA_GAP } from '../../../planet-places/island-growth.js';
import { ROW_LATITUDE, rowLatitude, rowOf } from '../../../planet-places/planet-places.js';
import { planetLayout, TILT_LIMIT } from '../../planet-navigation.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../../../..');

const where = route(here);
if (where.status !== 'routed') throw new Error(where.message);
const storytree = await connect(where.library);
let tree: any, all: any;
try {
  await requireApproval(storytree, 'storytree', where.folder);
  const library = await openNamedProject(storytree, 'storytree');
  tree = await library.projectTree();
  all = await library.changesSince(0);
} finally {
  await (storytree as { close?: () => Promise<void> }).close?.();
}
// Folded as ../rows/seed.mts folds it: each record's created change and its last later one (creation order is kept).
const kept = new Map<string, any>();
for (const change of all.changes) kept.set(`${change.recordId}:${change.action === 'created' ? 'c' : 'u'}`, change);
const changes = [...kept.values()].sort((a, b) => a.seq - b.seq);
const survey: any = await readCodeSurvey(root, tree);
const taken = new Date().toISOString();
writeFileSync(path.join(here, 'seed.json.gz'), gzipSync(JSON.stringify({ projects: ['storytree'], tree, changes: { ...all, changes }, lines: { lines: [], cursor: 0 }, covers: {}, stats: { stories: tree.stories.length, taken } }) + '\n', { level: 9 }));
writeFileSync(path.join(here, 'survey.json'), JSON.stringify(survey) + '\n');

const scene = forestScene(tree, changes, workStates([]), survey);
const nodes = storyNodes(tree, changes, survey);
const layout = planetLayout(scene, new Map(nodes.map(node => [node.id, node.place])));
const turn = openingTurn(layout.islands);
const R = layout.radius;

const deg = (r: number) => +(r * 180 / Math.PI).toFixed(1);
const title = new Map<string, string>(tree.stories.map((s: any) => [s.id, s.title]));
const owner = new Map<string, string>(tree.stories.flatMap((s: any) => s.capabilities.map((c: any) => [c.id, s.id])));
const node = new Map(nodes.map(n => [n.id, n]));
const reach = new Map(scene.islands.map(i => [i.story, islandCoastReach(i)]));
const rows = Math.max(...nodes.map(n => rowOf(n.place).row)) + 1;

// The dependencies the rows are made from (story-nodes.ts): the code's package edges where the survey names them, else the plan's.
const known = new Set(tree.stories.map((s: any) => s.id));
const planEdges = (s: any): string[] => [...new Set<string>(s.capabilities.flatMap((c: any) => c.dependsOn.flatMap((d: string) => { const o = owner.get(d); return o === undefined || o === s.id ? [] : [o]; })))];
const rowEdges: { from: string; on: string }[] = tree.stories.flatMap((s: any) => (survey[s.id]?.dependsOn?.filter((o: string) => known.has(o) && o !== s.id) ?? planEdges(s)).map((on: string) => ({ from: s.id, on })));
// The pathways drawn (forest-scene.ts links): the plan's capability dependencies, between two different stories.
const drawn = [...new Map((scene.links ?? []).flatMap(l => { const from = owner.get(l.from), on = owner.get(l.to); return from && on && from !== on ? [[`${from}>${on}`, { from, on }] as const] : []; })).values()];

// Each island's anchor (island-growth.ts rowAnchors): its row's latitude, packed in slot order, the row centred on the front.
const anchors = new Map<string, { x: number; y: number; z: number }>();
for (let row = 0; row < rows; row++) {
  const members = nodes.filter(n => rowOf(n.place).row === row).sort((a, b) => rowOf(a.place).slot - rowOf(b.place).slot);
  const latitude = rowLatitude(row, rows);
  const apart = (a: string, b: string) => Math.acos(Math.min(1, Math.max(-1, (Math.cos((reach.get(a)! + reach.get(b)! + SEA_GAP) / R) - Math.sin(latitude) ** 2) / Math.cos(latitude) ** 2)));
  const steps = members.slice(1).map((member, k) => apart(members[k]!.id, member.id));
  let longitude = -steps.reduce((sum, step) => sum + step, 0) / 2;
  members.forEach((member, k) => {
    if (k > 0) longitude += steps[k - 1]!;
    anchors.set(member.id, { x: Math.cos(latitude) * Math.sin(longitude), y: Math.sin(latitude), z: Math.cos(latitude) * Math.cos(longitude) });
  });
}
const arc = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z)));

/** A spot on screen under a turn: Three's XYZ Euler [pitch, yaw, 0], the eye on +z, x right, y up (planet-navigation focusRotation). */
function project(spot: { x: number; y: number; z: number }, t: { yaw: number; pitch: number }) {
  const cy = Math.cos(t.yaw), sy = Math.sin(t.yaw), cp = Math.cos(t.pitch), sp = Math.sin(t.pitch);
  const x = spot.x * cy + spot.z * sy, z1 = -spot.x * sy + spot.z * cy;
  return { x, y: spot.y * cp - z1 * sp, depth: spot.y * sp + z1 * cp };
}

/** Facing the eye at 0.5 or more (within 60 degrees of the middle of the disc) is drawn at half its width or more: readable. */
const READABLE = 0.5;

function measure(label: string, t: { yaw: number; pitch: number }) {
  const at = new Map(layout.islands.map(i => [i.story, project(i.spot, t)]));
  const judge = (edges: { from: string; on: string }[]) => {
    const list = edges.map(e => {
      const a = at.get(e.from)!, b = at.get(e.on)!;
      const dy = (a.y - b.y) * R, dx = (a.x - b.x) * R;
      // North on screen: the dependent's middle is above its dependency's by more than a tenth of the smaller island's reach.
      const clear = Math.min(reach.get(e.from)!, reach.get(e.on)!) * 0.1;
      const verdict = a.depth <= 0 || b.depth <= 0 ? 'behind' : dy > clear ? 'north' : dy < -clear ? 'south' : 'level';
      return { from: title.get(e.from)!, on: title.get(e.on)!, verdict, bothReadable: a.depth >= READABLE && b.depth >= READABLE, dy: +dy.toFixed(1), dx: +dx.toFixed(1), fromRow: rowOf(node.get(e.from)!.place).row, onRow: rowOf(node.get(e.on)!.place).row };
    });
    const count = (v: string) => list.filter(r => r.verdict === v).length;
    return { total: list.length, north: count('north'), level: count('level'), south: count('south'), anEndBehindTheGlobe: count('behind'),
      northWithBothEndsReadable: list.filter(r => r.verdict === 'north' && r.bothReadable).length, list };
  };
  const islands = layout.islands.map(i => {
    const p = at.get(i.story)!, place = node.get(i.story)!.place;
    return { title: title.get(i.story)!, ...rowOf(place), latitude: deg(Math.asin(i.spot.y)), longitude: deg(Math.atan2(i.spot.x, i.spot.z)), reach: +reach.get(i.story)!.toFixed(1),
      nudgedFromAnchor: deg(arc(i.spot, anchors.get(i.story)!)), screenX: +(p.x * R).toFixed(1), screenY: +(p.y * R).toFixed(1), facing: +p.depth.toFixed(2) };
  }).sort((a, b) => a.row - b.row || a.slot - b.slot);
  const byRow = [...new Set(islands.map(i => i.row))].map(row => {
    const members = islands.filter(i => i.row === row), shown = members.filter(i => i.facing > 0);
    return { row, islands: members.length, facingTheEye: shown.length, longitudeSpan: +(Math.max(...members.map(m => m.longitude)) - Math.min(...members.map(m => m.longitude))).toFixed(1),
      screenY: shown.length ? [Math.min(...shown.map(m => m.screenY)), Math.max(...shown.map(m => m.screenY))] : [] };
  });
  // Rows read as rows when their bands of island middles do not overlap on screen: the neighbouring rows that do.
  const rowBandsOverlapping = byRow.slice(1).filter((r, k) => r.screenY.length && byRow[k]!.screenY.length && r.screenY[0]! <= byRow[k]!.screenY[1]!).map(r => `${r.row - 1}/${r.row}`);
  return { label, turn: { spin: deg(t.yaw), tilt: deg(t.pitch) }, islands: islands.length, facingTheEye: islands.filter(i => i.facing > 0).length, readable: islands.filter(i => i.facing >= READABLE).length,
    atTheRim: islands.filter(i => i.facing > 0 && i.facing < READABLE).map(i => `${i.title} (${i.facing})`), behindTheGlobe: islands.filter(i => i.facing <= 0).map(i => i.title),
    rowBandsOverlapping, dependenciesTheRowsAreBuiltFrom: judge(rowEdges), pathwaysDrawn: judge(drawn), byRow, islandList: islands };
}

const spacing = 2 * ROW_LATITUDE / (rows - 1) * R;
const reaches = [...reach.values()].sort((a, b) => a - b);
const front = { yaw: 0, pitch: 0 };
// The fewest islands any turn the controls allow leaves facing the eye, sampled every 5 degrees of spin and tilt.
let fewest = { facing: Infinity, readable: Infinity, spin: 0, tilt: 0 };
for (let yaw = -180; yaw < 180; yaw += 5) for (let pitch = -85; pitch <= 85; pitch += 5) {
  const t = { yaw: yaw * Math.PI / 180, pitch: pitch * Math.PI / 180 };
  const depths = layout.islands.map(i => project(i.spot, t).depth);
  const facing = depths.filter(d => d > 0).length, readable = depths.filter(d => d >= READABLE).length;
  if (readable < fewest.readable || (readable === fewest.readable && facing < fewest.facing)) fewest = { facing, readable, spin: yaw, tilt: pitch };
}
const result = {
  taken, stories: tree.stories.length, rows, radius: +R.toFixed(1),
  failing: layout.islands.filter(i => i.trees.some(tr => tr.status === 'unhealthy')).map(i => title.get(i.story)),
  storiesPlacedByCodeEdges: tree.stories.filter((s: any) => survey[s.id]?.dependsOn !== undefined).length,
  rowHeight: { groundUnits: +spacing.toFixed(1), degrees: deg(2 * ROW_LATITUDE / (rows - 1)) },
  islandWidth: { smallest: +(2 * reaches[0]!).toFixed(1), median: +(2 * reaches[Math.floor(reaches.length / 2)]!).toFixed(1), largest: +(2 * reaches.at(-1)!).toFixed(1),
    widerThanARowIsTall: reaches.filter(r => 2 * r > spacing).length },
  nudge: { limitDegrees: deg(MAX_NUDGE), movedMoreThan20Degrees: layout.islands.filter(i => arc(i.spot, anchors.get(i.story)!) > 20 * Math.PI / 180).map(i => `${title.get(i.story)} (${deg(arc(i.spot, anchors.get(i.story)!))})`) },
  turning: { tiltLimitDegrees: deg(TILT_LIMIT), spin: 'unlimited', fewestIslandsAnyTurnLeaves: fewest },
  pathwaysDrawnButNotARowDependency: drawn.filter(d => !rowEdges.some(r => r.from === d.from && r.on === d.on)).map(d => `${title.get(d.from)} -> ${title.get(d.on)}`),
  rowDependenciesNotDrawn: rowEdges.filter(r => !drawn.some(d => r.from === d.from && r.on === d.on)).length,
  views: [measure('opening', turn), measure('opening spin, no tilt', { yaw: turn.yaw, pitch: 0 }), measure('unturned front', front)],
};
writeFileSync(path.join(here, 'measurements.json'), JSON.stringify(result, null, 1) + '\n');

/** A schematic of one view: islands as discs of their reach, squeezed as the globe turns them from the eye; dependencies green where the dependent is north on screen. */
function svg(view: ReturnType<typeof measure>, edges: 'dependenciesTheRowsAreBuiltFrom' | 'pathwaysDrawn', caption: string) {
  const size = 2 * R + 80, c = size / 2;
  const pos = new Map(view.islandList.map(i => [i.title, i]));
  const colour = { north: '#3aa76d', level: '#d9a441', south: '#e0524a', behind: '#8a8f98' } as const;
  const lines = view[edges].list.map(e => { const a = pos.get(e.from)!, b = pos.get(e.on)!;
    return `<line x1="${c + a.screenX}" y1="${c - a.screenY}" x2="${c + b.screenX}" y2="${c - b.screenY}" stroke="${colour[e.verdict as keyof typeof colour]}" stroke-width="${e.verdict === 'north' ? 1.2 : 2.4}" ${e.verdict === 'behind' ? 'stroke-dasharray="4 4"' : ''} opacity="${e.verdict === 'north' ? 0.5 : 0.95}"/>`; }).join('');
  const tint = ['#5b8def', '#49b6a6', '#b08be8', '#e39a5a', '#d86fa0', '#8fbf4d', '#e0c341', '#6fc3e8', '#f08a7a'];
  const discs = view.islandList.map(i => { const hidden = i.facing <= 0, radial = Math.hypot(i.screenX, i.screenY) || 1;
    // Squeezed along the line from the globe's middle, as a disc on a sphere is.
    const angle = Math.atan2(-i.screenY, i.screenX) * 180 / Math.PI;
    return `<g opacity="${hidden ? 0.4 : 1}"><ellipse cx="${c + i.screenX}" cy="${c - i.screenY}" rx="${(i.reach * Math.max(0.12, Math.abs(i.facing))).toFixed(1)}" ry="${i.reach}" transform="rotate(${angle.toFixed(1)} ${c + i.screenX} ${c - i.screenY})" fill="${hidden ? 'none' : tint[i.row % tint.length]}" fill-opacity="0.3" stroke="${tint[i.row % tint.length]}" stroke-width="1.5" ${hidden ? 'stroke-dasharray="3 3"' : ''}/>` +
      `<text x="${c + i.screenX}" y="${c - i.screenY + 4}" text-anchor="middle" font-size="11" fill="#e8eaed" stroke="#101418" stroke-width="2.5" paint-order="stroke">${i.title} · row ${i.row}</text></g>`; }).join('');
  const j = view[edges];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size + 60}" width="${size}" height="${size + 60}" font-family="Segoe UI, sans-serif"><rect width="100%" height="100%" fill="#101418"/>` +
    `<circle cx="${c}" cy="${c}" r="${R}" fill="#161c22" stroke="#3a424c"/>${lines}${discs}` +
    `<text x="16" y="${size + 16}" font-size="13" fill="#e8eaed">${caption}: spin ${view.turn.spin}°, tilt ${view.turn.tilt}°. ${view.readable} of ${view.islands} islands readable, ${view.atTheRim.length} squeezed at the rim, ${view.behindTheGlobe.length} behind the globe (dashed).</text>` +
    `<text x="16" y="${size + 38}" font-size="13" fill="#e8eaed">Dependent north of what it depends on, on screen: <tspan fill="#3aa76d">${j.north} north</tspan>, <tspan fill="#d9a441">${j.level} level</tspan>, <tspan fill="#e0524a">${j.south} south</tspan>, <tspan fill="#8a8f98">${j.anEndBehindTheGlobe} with an end behind the globe</tspan>, of ${j.total}.</text></svg>`;
}
writeFileSync(path.join(here, 'opening-dependencies.svg'), svg(result.views[0]!, 'dependenciesTheRowsAreBuiltFrom', 'The view the app opens on · the dependencies the rows are built from'));
writeFileSync(path.join(here, 'opening-pathways.svg'), svg(result.views[0]!, 'pathwaysDrawn', 'The view the app opens on · the pathways drawn'));
writeFileSync(path.join(here, 'front-dependencies.svg'), svg(result.views[2]!, 'dependenciesTheRowsAreBuiltFrom', 'Unturned, no tilt · the dependencies the rows are built from'));

const short = (v: ReturnType<typeof measure>) => { const { islandList, byRow, dependenciesTheRowsAreBuiltFrom: d, pathwaysDrawn: p, ...rest } = v; return { ...rest, dependencies: { ...d, list: undefined }, pathways: { ...p, list: undefined } }; };
console.log(JSON.stringify({ ...result, views: result.views.map(short) }, null, 1));
console.log('ROWS', JSON.stringify(result.views[0]!.byRow));
console.log(result.views[0]!.islandList.map(i => `${i.title} r${i.row}s${i.slot} lat ${i.latitude} lon ${i.longitude} reach ${i.reach} nudged ${i.nudgedFromAnchor} screen (${i.screenX}, ${i.screenY}) facing ${i.facing}`).join('\n'));
