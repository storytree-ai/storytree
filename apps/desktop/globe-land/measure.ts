// One-off calibration, not a runtime layout: commits a frozen table of 36 places.
import { readFileSync, writeFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { forestScene } from '@storytree/forest';
import { workStates } from '@storytree/arc-surface';
import { forestDescriptors } from '../../../packages/forest-world/src/forest-ground/forest-ground.ts';
import { clipToCoast, rimLoops, SHIPPED_COAST } from '../../../packages/forest-world/src/coast-clip.ts';
import { plateTransform } from '../../../packages/forest-world/src/planet/planet.ts';
import { synthetic } from './input.mjs';

const R = 160, PITCH = 72, GAP = 4;
const seed = JSON.parse(readFileSync(new URL('./dist/seed.json', import.meta.url), 'utf8'));
const datasets = [seed, synthetic(seed)].map(data => forestScene(data.tree, data.changes.changes, workStates(data.lines.lines)).islands.map(i => {
  const descriptors = forestDescriptors({ islands: [{ ...i, x: 0, z: 0, trees: i.trees.map(t => ({ ...t, x: t.x - i.x, z: t.z - i.z })) }] });
  const cells = clipToCoast(descriptors.filter(d => d.kind === 'cell-ground'), SHIPPED_COAST);
  const rings = rimLoops(cells.map(c => c.points!));
  return { title: i.title, story: i.story, capabilities: i.trees.length, rings };
}));
const spot = (t: number) => {
  const a = PITCH * t / (2 * Math.PI * R);
  return new Vector3(Math.sin(a)*Math.cos(t), Math.sin(a)*Math.sin(t), Math.cos(a));
};
const unroll = (p: Vector3) => {
  const a = Math.acos(Math.max(-1, Math.min(1, p.z / p.length())));
  const r = Math.hypot(p.x, p.y);
  return { x: r ? R*a*p.x/r : 0, y: r ? R*a*p.y/r : 0 };
};
function footprint(item: any, t: number) {
  const s = spot(t), transform = plateTransform(s, R);
  const world = item.rings[0].map((p: any) => new Vector3(p.x, 0, p.z).applyQuaternion(transform.quaternion).add(new Vector3(...transform.position)));
  const points = world.map(unroll);
  const centre = unroll(s);
  const reach = Math.max(...points.map((p: any) => Math.hypot(p.x-centre.x, p.y-centre.y)));
  return { points, world, centre, reach };
}
function segDist(p: any, a: any, b: any) {
  const dx=b.x-a.x, dy=b.y-a.y, n=dx*dx+dy*dy;
  const t=n ? Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/n)) : 0;
  return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
}
function inside(p: any, ps: any[]) {
  let b=false;
  for(let i=0,j=ps.length-1;i<ps.length;j=i++) if ((ps[i].y>p.y)!==(ps[j].y>p.y) && p.x<(ps[j].x-ps[i].x)*(p.y-ps[i].y)/(ps[j].y-ps[i].y)+ps[i].x) b=!b;
  return b;
}
function separation(a: any,b: any, early=0) {
  const bound=Math.hypot(a.centre.x-b.centre.x,a.centre.y-b.centre.y)-a.reach-b.reach;
  if(early && bound>early) return bound;
  if(inside(a.points[0],b.points)||inside(b.points[0],a.points)) return 0;
  let gap=Infinity;
  for(let i=0;i<a.points.length;i++) for(let j=0;j<b.points.length;j++) {
    const p=a.points[i], q=a.points[(i+1)%a.points.length], u=b.points[j],v=b.points[(j+1)%b.points.length];
    const cross=(a: any,b: any,c: any)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
    if(cross(p,q,u)*cross(p,q,v)<0 && cross(u,v,p)*cross(u,v,q)<0) return 0;
    gap=Math.min(gap,segDist(p,u,v),segDist(q,u,v),segDist(u,p,q),segDist(v,p,q));
    if(early && gap<early) return gap;
  }
  return gap;
}
const mounted: any[][] = [[],[]], slots: any[]=[];
let t=0;
for(let i=0;i<36;i++) {
  if(i) t+=0.05;
  let attempts=0;
  while(true) {
    const candidates=datasets.map(data=>data[i] ? footprint(data[i],t) : null);
    // The unrolled map stretches east-west farther from the pole; guard the spherical gap too.
    const clearance=GAP / Math.max(0.2,Math.sin(PITCH*t/(2*Math.PI*R))/(PITCH*t/(2*Math.PI*R))||1);
    const fits=candidates.every((f,k)=>!f || mounted[k].every(old=>separation(f,old,clearance)>=clearance));
    if(fits) {
      candidates.forEach((f,k)=>{ if(f) mounted[k].push(f); });
      slots.push({ place:i+1, theta:t, spot:spot(t).toArray() }); break;
    }
    t+=0.006;
    if(++attempts>20000) throw new Error('Spiral packing exhausted');
  }
  console.log(JSON.stringify({place:i+1,angle:PITCH*t/(2*Math.PI*R)*180/Math.PI}));
}
const measurements=mounted.map((fs,k)=>({ stories:fs.length, islands:fs.map((f,i)=>{
  let nearest=Infinity, neighbour=-1, actual=Infinity;
  fs.forEach((other,j)=>{if(i!==j){const gap=separation(f,other);if(gap<nearest){nearest=gap;neighbour=j+1;} for(const p of f.world)for(const q of other.world)actual=Math.min(actual,R*p.clone().normalize().angleTo(q.clone().normalize()));}});
  return {...datasets[k][i],rings:undefined,place:i+1,nearestUnrolledGap:nearest,nearestCoastVertexArc:actual,neighbour};
}) }));
writeFileSync(new URL('./slots.json',import.meta.url),JSON.stringify({radius:R,pitch:PITCH,targetGap:GAP,slots},null,2)+'\n');
writeFileSync(new URL('../../../docs/research/globe-land/spacing.json',import.meta.url),JSON.stringify({radius:R,pitch:PITCH,targetGap:GAP,measurements},null,2)+'\n');
