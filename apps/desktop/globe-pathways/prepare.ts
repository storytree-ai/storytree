// Throwaway geometry adapter. Product routing and ground remain imported from main.
import { readFileSync, writeFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { forestScene, storyNodes, placeOnGlobe } from '@storytree/forest';
import { workStates } from '@storytree/arc-surface';
import { forestDescriptors, parcelSpots } from '../../../packages/forest-world/src/forest-ground/forest-ground.ts';
import { clipToCoast, SHIPPED_COAST, rimLoops } from '../../../packages/forest-world/src/coast-clip.ts';
import { plateTransform, PLATE_CLEARANCE } from '../../../packages/forest-world/src/planet/planet.ts';
import { routeTrails, trailFillWidth } from '../../../packages/forest-world/src/core/routing.ts';
import { SHORE_DIP } from '../../../packages/forest-world/src/shore-fall.ts';
import { RIBBON_GROUND_SCALE } from '../../../packages/forest-world/src/trail-ribbon-width.ts';
const here = new URL('./', import.meta.url), out = new URL('../../../docs/research/globe-pathways/', here);
const seed = JSON.parse(readFileSync(new URL('dist/seed.json', here), 'utf8'));
const scene = forestScene(seed.tree, seed.changes.changes, workStates(seed.lines.lines));
const places = new Map(storyNodes(seed.tree, seed.changes.changes).map(s => [s.id, s.place]));
const caps = new Map(seed.tree.stories.flatMap(s => s.capabilities.map(c => [c.id, { ...c, story:s.id }])));
const declared = JSON.parse(readFileSync(new URL('declared-links.json',here),'utf8'));
const resolve = ([story,number]) => seed.tree.stories.find(s=>s.title===story).capabilities.find(c=>c.title.startsWith(number+' ·')).id;
const originalCross = [...caps.values()].flatMap(c=>c.dependsOn.filter(to=>caps.get(to)?.story!==c.story));
for(const row of declared)for(const target of row.to){const from=resolve(row.from),to=resolve(target);if(!caps.get(from).dependsOn.includes(to))caps.get(from).dependsOn.push(to);}
const links = [...caps.values()].flatMap(c => c.dependsOn.map(to => ({ from:c.id, to, source:c.story, target:caps.get(to)?.story })));
if (links.some(l => !l.target)) throw Error('Unknown capability endpoint');
const cross = links.filter(l => l.source !== l.target), within = links.filter(l => l.source === l.target);
const pairs = [...new Map(cross.map(l => [l.source+'->'+l.target, {from:l.source,to:l.target}])).values()];
// Four times the widest POSSIBLE shared trunk for this real link set: ribbon plus
// 1.5 ribbon widths clear on each side. A single-edge spur is 1.5 ground units.
const maxWidth = trailFillWidth(cross.length) * RIBBON_GROUND_SCALE;
const targetGap = 4 * maxWidth;
function ground(island) {
  const local = {...island,x:0,z:0,trees:island.trees.map(t=>({...t,x:t.x-island.x,z:t.z-island.z}))};
  const descriptors = forestDescriptors({islands:[local]});
  const cells = clipToCoast(descriptors.filter(d=>d.kind==='cell-ground' && d.points),SHIPPED_COAST);
  return {id:island.story,title:island.title,place:places.get(island.story),island:local,cells,rims:rimLoops(cells.map(c=>c.points)),parcels:parcelSpots(descriptors)};
}
const grounds = scene.islands.map(ground);
function norm(place) {const p=placeOnGlobe(place);return new Vector3(p.x,p.y,p.z).normalize();}
function projected(g,r) {const t=plateTransform(norm(g.place),r),v=new Vector3(...t.position);return g.rims.flat().map(p=>new Vector3(p.x,0,p.z).applyQuaternion(t.quaternion).add(v).normalize());}
// Exact point-to-minor-great-circle-arc distance, also testing the opposite foot.
function arcDistance(p,a,b) {
  const n=a.clone().cross(b).normalize(), foot=p.clone().addScaledVector(n,-p.dot(n)).normalize();
  const ab=a.angleTo(b);let d=Math.min(p.angleTo(a),p.angleTo(b));
  for(const q of [foot,foot.clone().negate()]) if(a.angleTo(q)+q.angleTo(b)<=ab+1e-9)d=Math.min(d,p.angleTo(q));
  return d;
}
function overlap(a,b,na,nb) {
  if(na.angleTo(nb)>Math.max(...a.map(p=>p.angleTo(na)))+Math.max(...b.map(p=>p.angleTo(nb))))return false;
  const front=na.clone().add(nb).normalize(),x=nb.clone().sub(na).normalize(),y=front.clone().cross(x);
  const project=p=>({x:p.dot(x)/p.dot(front),y:p.dot(y)/p.dot(front)}),pa=a.map(project),pb=b.map(project);
  if(inside(pa[0],[pb])||inside(pb[0],[pa]))return true;
  const cross=(p,q,r)=>(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);
  for(let i=0;i<pa.length;i++)for(let j=0;j<pb.length;j++){const p=pa[i],q=pa[(i+1)%pa.length],u=pb[j],v=pb[(j+1)%pb.length];if(cross(p,q,u)*cross(p,q,v)<0&&cross(u,v,p)*cross(u,v,q)<0)return true;}return false;
}
function gapBetween(a,b,r) {
  let min=Infinity;
  for(let i=0;i<a.length;i++)for(let j=0;j<b.length;j++)min=Math.min(min,arcDistance(a[i],b[j],b[(j+1)%b.length]),arcDistance(b[j],a[i],a[(i+1)%a.length]));
  return min*r;
}
// Choose radius with conservative enclosing shore caps; then measure actual full edges.
// This changes no direction or permanent slot. Physical spiral pitch scales with R.
function capGap(gs,r) {
  const reaches=gs.map(g=>Math.atan(Math.max(...g.rims.flat().map(p=>Math.hypot(p.x,p.z)))/(r+PLATE_CLEARANCE)));
  let min=Infinity;
  for(let i=0;i<gs.length;i++)for(let j=0;j<i;j++)min=Math.min(min,r*(norm(gs[i].place).angleTo(norm(gs[j].place))-reaches[i]-reaches[j]));
  return min;
}
// Reuse #90's explicitly fictional 36-story capacity input as a measurement only.
const counts=[8,4,5,10,7,6,13],health={reported:{state:'not-checked'},verified:{state:'not-checked'}};
const sample=Array.from({length:36},(_,i)=>({id:`synthetic-story-${i+1}`,title:`Sample ${i+1}`,health,capabilities:Array.from({length:counts[i%counts.length]},(_,j)=>({id:`sample-${i}-${j}`,title:'Sample',dependsOn:[],contracts:[],health}))}));
const sampleScene=forestScene({stories:sample,arcs:[]},[],workStates([]));
const sampleGrounds=sampleScene.islands.map((s,i)=>({...ground(s),place:i+1}));
let radius=160;while(Math.min(capGap(grounds,radius),capGap(sampleGrounds,radius))<targetGap)radius++;
// Conservative radius first; refine against every real coast edge of nearby pairs.
function clears(gs,r){const coast=gs.map(g=>projected(g,r));for(let i=0;i<gs.length;i++)for(let j=0;j<i;j++){const a=coast[i],b=coast[j],na=norm(gs[i].place),nb=norm(gs[j].place);const bound=r*(na.angleTo(nb)-Math.max(...a.map(p=>p.angleTo(na)))-Math.max(...b.map(p=>p.angleTo(nb))));if(bound>=targetGap)continue;if(overlap(a,b,na,nb)||gapBetween(a,b,r)<targetGap)return false;}return true;}
let low=160,high=radius;while(low<high){const mid=Math.floor((low+high)/2);if(clears(grounds,mid)&&clears(sampleGrounds,mid))high=mid;else low=mid+1;}radius=low;
function measure(gs,r) {
  const projectedCoasts=gs.map(g=>projected(g,r));
  const nearest=gs.map(()=>Infinity),all=[];
  for(let i=0;i<gs.length;i++)for(let j=0;j<i;j++) {
    // Only nearby cap pairs need the expensive exact edge measurement.
    const a=projectedCoasts[i],b=projectedCoasts[j];
    if(overlap(a,b,norm(gs[i].place),norm(gs[j].place)))throw Error('Coasts overlap: '+gs[i].id+' / '+gs[j].id);
    const gi=gapBetween(a,b,r);nearest[i]=Math.min(nearest[i],gi);nearest[j]=Math.min(nearest[j],gi);
    all.push({from:gs[j].id,to:gs[i].id,gap:gi});
  }
  const sorted=[...nearest].sort((a,b)=>a-b);
  return {minimum:sorted[0],median:(sorted[(sorted.length-1)>>1]+sorted[sorted.length>>1])/2,maximum:sorted.at(-1),nearest:gs.map((g,i)=>({story:g.title,place:g.place,gap:nearest[i]})),pairs:all};
}
console.log(JSON.stringify({stories:grounds.length,links:links.length,within:within.length,cross:cross.length,pairs:pairs.length,targetGap,radius,capGap:capGap(grounds,radius)}));
// Azimuthal equidistant chart centred on the existing front pole, only for this seed's patch.
function chart(v) {const n=v.clone().normalize(),t=Math.acos(Math.max(-1,Math.min(1,n.z))),s=Math.hypot(n.x,n.y);return s<1e-10?{x:0,y:0}:{x:radius*t*n.x/s,y:radius*t*n.y/s};}
function sphere(p) {const d=Math.hypot(p.x,p.y),t=d/radius;return d<1e-10?new Vector3(0,0,1):new Vector3(Math.sin(t)*p.x/d,Math.sin(t)*p.y/d,Math.cos(t));}
const charts=grounds.map(g=>{const t=plateTransform(norm(g.place),radius),at=new Vector3(...t.position),centre=chart(norm(g.place));const rings=g.rims.map(loop=>loop.map(p=>({...chart(new Vector3(p.x,0,p.z).applyQuaternion(t.quaternion).add(at)),local:{x:p.x,z:p.z}})));return {...g,...centre,t,at,rings,r:Math.max(...rings.flat().map(p=>Math.hypot(p.x-centre.x,p.y-centre.y)))};});
const network=routeTrails(charts.map(g=>({id:g.id,x:g.x,y:g.y,r:g.r})),pairs,'globe-pathways-real-seed',{cellSize:2,clearance:maxWidth/2+1,falloff:maxWidth,meanderAmp:0.4});
if(network.dropped.length||network.caves.length||network.segments.some(s=>s.hidden))throw Error('Cannot draw all cross links honestly: '+JSON.stringify({dropped:network.dropped,caves:network.caves}));
function nearestOnRings(p,rings) {
  let best;
  for(const ring of rings)for(let i=0;i<ring.length;i++) {const a=ring[i],b=ring[(i+1)%ring.length],dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy))),q={x:a.x+t*dx,y:a.y+t*dy},d=Math.hypot(p.x-q.x,p.y-q.y);if(!best||d<best.d)best={...q,d,local:a.local&&{x:a.local.x+t*(b.local.x-a.local.x),z:a.local.z+t*(b.local.z-a.local.z)}};}
  return best;
}
const segmentLinks=new Map(network.segments.map(s=>[s.id,[]]));
for(const edge of network.edges)for(const ref of edge.segments)segmentLinks.get(ref.id).push(...cross.filter(l=>l.source===edge.from&&l.target===edge.to));
const docks=new Map(), dockEnds=new Map();
for(const edge of network.edges) {
  for(const [id,ref,first] of [[edge.from,edge.segments[0],true],[edge.to,edge.segments.at(-1),false]]) {
    const s=network.segments.find(s=>s.id===ref.id),index=(first!==ref.reversed)?0:s.points.length-1,key=s.id+':'+index;
    const g=charts.find(g=>g.id===id),snap=nearestOnRings(s.points[index],g.rings);
    docks.set(edge.from+'->'+edge.to+':'+id,{key,local:snap.local});
    dockEnds.set(key,{story:id,...snap});
  }
}
function dense(points,step=1) {const result=[];for(let i=0;i<points.length-1;i++){const a=points[i],b=points[i+1],n=Math.max(1,Math.ceil(Math.hypot(a.x-b.x,a.y-b.y)/step));for(let j=0;j<n;j++)result.push({x:a.x+(b.x-a.x)*j/n,y:a.y+(b.y-a.y)*j/n});}return [...result,points.at(-1)];}
// Evaluate the router's own M/C spline, rather than drawing its control polygon.
function spline(segment) {
  const values=segment.d.match(/-?\d+(?:\.\d+)?/g).map(Number),out=[{x:values[0],y:values[1]}];
  let a=out[0];for(let i=2;i<values.length;i+=6){const b={x:values[i],y:values[i+1]},c={x:values[i+2],y:values[i+3]},d={x:values[i+4],y:values[i+5]};const steps=Math.max(8,Math.ceil((Math.hypot(b.x-a.x,b.y-a.y)+Math.hypot(c.x-b.x,c.y-b.y)+Math.hypot(d.x-c.x,d.y-c.y))/0.8));for(let j=1;j<=steps;j++){const t=j/steps,u=1-t;out.push({x:u*u*u*a.x+3*u*u*t*b.x+3*u*t*t*c.x+t*t*t*d.x,y:u*u*u*a.y+3*u*u*t*b.y+3*u*t*t*c.y+t*t*t*d.y});}a=d;}return out;
}
const ribbons=network.segments.map(s=>{
  const points=spline(s),ends=[dockEnds.get(s.id+':0'),dockEnds.get(s.id+':'+(s.points.length-1))];
  if(ends[0])points[0]={x:ends[0].x,y:ends[0].y};if(ends[1])points[points.length-1]={x:ends[1].x,y:ends[1].y};
  const ps=dense(points),walk=[0];for(let i=1;i<ps.length;i++)walk.push(walk[i-1]+Math.hypot(ps[i].x-ps[i-1].x,ps[i].y-ps[i-1].y));
  // Unchanged tangent plates sit above the shell. A narrow ribbon eases up to each
  // real shore over eight units; there is no land/support mesh underneath it.
  const endpointRise=ends.map(e=>e?new Vector3(e.local.x,-SHORE_DIP,e.local.z).applyQuaternion(charts.find(g=>g.id===e.story).t.quaternion).add(charts.find(g=>g.id===e.story).at).length()-radius:0);
  return {id:s.id,width:trailFillWidth(new Set(segmentLinks.get(s.id).map(l=>l.from+'->'+l.to)).size),links:segmentLinks.get(s.id),points:ps.map((p,i)=>{const from=Math.max(0,1-walk[i]/8),to=Math.max(0,1-(walk.at(-1)-walk[i])/8),rise=Math.max(endpointRise[0]*from,endpointRise[1]*to);return {direction:sphere(p).toArray(),rise,shoreBlend:Math.max(ends[0]?from:0,ends[1]?to:0)};})};
});
const wear={},nativeWear={},localRouting=[];
function inside(p,rings) {let yes=false;for(const ring of rings)for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)yes=!yes;}return yes;}
for(const g of charts) {
  const endpoints=[...g.parcels].map(([id,p])=>({id,x:p.x,y:p.z,r:0.2}));
  const localEdges=within.filter(l=>l.source===g.id).map(l=>({from:l.from,to:l.to}));
  const native=routeTrails(endpoints,localEdges,'island:'+g.id,{cellSize:1,clearance:0.3,falloff:1,falloffCost:2,meanderAmp:0.1,meanderWavelength:5,reclusterOnApproach:false,dockMergeGap:0,dockMergeSpan:0,junctionWeld:0});
  const rings=g.rims.map(loop=>loop.map(p=>({x:p.x,y:p.z})));
  nativeWear[g.id]=native.segments.map(s=>spline(s).map(p=>{if(!inside(p,rings))p=nearestOnRings(p,rings);return {x:p.x,z:p.y};}));
  for(const link of cross.filter(l=>l.source===g.id||l.target===g.id)) {
    const dock=docks.get(link.source+'->'+link.target+':'+g.id),id='dock:'+dock.key;
    if(!endpoints.some(p=>p.id===id))endpoints.push({id,x:dock.local.x,y:dock.local.z,r:0});
    localEdges.push({from:link.source===g.id?link.from:link.to,to:id});
  }
  const n=routeTrails(endpoints,localEdges,'island:'+g.id,{cellSize:1,clearance:0.3,falloff:1,falloffCost:2,meanderAmp:0.1,meanderWavelength:5,reclusterOnApproach:false,dockMergeGap:0,dockMergeSpan:0,junctionWeld:0});
  if(n.dropped.length)throw Error('Dropped local dependency');
  const localRings=g.rims.map(loop=>loop.map(p=>({x:p.x,y:p.z})));let clamped=0;
  wear[g.id]=n.segments.map(s=>spline(s).map(p=>{if(!inside(p,localRings)){p=nearestOnRings(p,localRings);clamped++;}return {x:p.x,z:p.y};}));
  localRouting.push({story:g.title,edges:n.edges.length,segments:n.segments.length,dropped:n.dropped,clampedSamples:clamped});
}
let crossCoastIntrusions=0;
for(const route of ribbons)for(const p of route.points){const point=chart(new Vector3(...p.direction));for(const g of charts)if(inside(point,g.rings)&&p.shoreBlend<0.01)crossCoastIntrusions++;}
if(crossCoastIntrusions)throw Error('Cross trail cuts an island: '+crossCoastIntrusions);
const stats={crossCoastIntrusions,nativeSeedCrossLinks:originalCross.length,declaredBrowserLinks:cross.length,baseCommit:'0a34053',stories:grounds.length,capabilities:caps.size,links:links.length,withinIsland:within.length,crossIsland:cross.length,storyPairs:pairs.length,routedSegments:ribbons.length,dropped:network.dropped,caves:network.caves,radius,oldRadius:160,capacity:36,pitch:72*radius/160,spurWidth:trailFillWidth(1)*RIBBON_GROUND_SCALE,maxPossibleTrunkWidth:maxWidth,maxActualTrunkWidth:Math.max(...ribbons.map(s=>s.width*RIBBON_GROUND_SCALE)),targetGap,conservativeCapGap:{seed:capGap(grounds,radius),sample36:capGap(sampleGrounds,radius)},seedGaps:measure(grounds,radius),baselineGaps:measure(grounds,160),sample36Gaps:measure(sampleGrounds,radius),localRouting};
const data={radius,capacity:36,ribbons,wear,nativeWear,stats,links};
writeFileSync(new URL('paths.json',here),JSON.stringify(data));
writeFileSync(new URL('measurements.json',out),JSON.stringify(stats,null,2)+'\n');
// Reproducible capture input, with only the historical creation records needed by placement.
// Restore untouched snapshot: the declared links above were experiment-only.
const untouched=JSON.parse(readFileSync(new URL('dist/seed.json',here),'utf8'));
writeFileSync(new URL('seed.json',here),JSON.stringify({...untouched,covers:{},changes:{...seed.changes,changes:seed.changes.changes.filter(c=>c.type==='story'&&c.action==='created')}}));
console.log(JSON.stringify(stats,null,2));
