// A plain opaque skin beneath the convex envelope of the actual coasts. Spike only.
import { useEffect, useMemo } from 'react';
import { BufferGeometry, Float32BufferAttribute, DoubleSide, CanvasTexture, Vector3 } from 'three';
import type { ForestScene } from '@storytree/forest';
import { forestDescriptors } from '../../../packages/forest-world/src/forest-ground/forest-ground';
import { clipToCoast, rimLoops, SHIPPED_COAST } from '../../../packages/forest-world/src/coast-clip';
import { plateTransform, type PlanetSpot } from '../../../packages/forest-world/src/planet/planet';
import { landHeightRange } from '../../../packages/forest-world/src/land-relief';

type P = { x: number; y: number; radial: number };
const cross = (a: P,b: P,c: P) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
function convexHull(points: P[]): P[] {
  const ps=[...points].sort((a,b)=>a.x-b.x||a.y-b.y), low:P[]=[], high:P[]=[];
  for(const p of ps){while(low.length>1 && cross(low.at(-2)!,low.at(-1)!,p)<=0)low.pop();low.push(p);}
  for(const p of [...ps].reverse()){while(high.length>1 && cross(high.at(-2)!,high.at(-1)!,p)<=0)high.pop();high.push(p);}
  return [...low.slice(0,-1),...high.slice(0,-1)];
}
const inside = (x:number,y:number,hull:P[]) => hull.every((p,i)=>cross(p,hull[(i+1)%hull.length]!,{x,y,radial:0})>=-0.0001);
const direction = (x:number,y:number,radius:number) => {
  const r=Math.hypot(x,y), a=r/radius;
  return new Vector3(r ? Math.sin(a)*x/r : 0,r ? Math.sin(a)*y/r : 0,Math.cos(a));
};
function buildSkin(scene:ForestScene,spots:ReadonlyMap<string,PlanetSpot>,radius:number) {
  const shores:P[]=[], plates:{normal:Vector3; distance:number; rings:P[][]}[]=[];
  for(const island of scene.islands) {
    const desc=forestDescriptors({islands:[{...island,x:0,z:0,trees:island.trees.map(t=>({...t,x:t.x-island.x,z:t.z-island.z}))}]});
    const cells=clipToCoast(desc.filter(d=>d.kind==='cell-ground'),SHIPPED_COAST);
    const transform=plateTransform(spots.get(island.story)!,radius);
    const position=new Vector3(...transform.position);
    const rings=rimLoops(cells.map(c=>c.points!)).map(ring=>ring.map(p=>{
      const world=new Vector3(p.x,0,p.z).applyQuaternion(transform.quaternion).add(position);
      const a=Math.acos(world.z/world.length()), xy=Math.hypot(world.x,world.y);
      return {x:xy?radius*a*world.x/xy:0,y:xy?radius*a*world.y/xy:0,radial:world.length()-0.45};
    }));
    shores.push(...rings.flat());
    plates.push({normal:position.clone().normalize(),distance:position.length(),rings});
  }
  const hull=convexHull(shores);
  const minX=Math.min(...hull.map(p=>p.x)),maxX=Math.max(...hull.map(p=>p.x));
  const minY=Math.min(...hull.map(p=>p.y)),maxY=Math.max(...hull.map(p=>p.y));
  // 2-unit lattice clipped to the coast envelope. Boundary points are projected onto the hull.
  const step=2, nx=Math.ceil((maxX-minX)/step), ny=Math.ceil((maxY-minY)/step);
  const vertices:number[]=[], indices:number[]=[], ids=new Map<string,number>();
  function vertex(x:number,y:number) {
    if(!inside(x,y,hull)) {
      let best=Infinity,px=x,py=y;
      hull.forEach((p,i)=>{const q=hull[(i+1)%hull.length]!,dx=q.x-p.x,dy=q.y-p.y;
        const t=Math.max(0,Math.min(1,((x-p.x)*dx+(y-p.y)*dy)/(dx*dx+dy*dy)));
        const xx=p.x+t*dx,yy=p.y+t*dy,d=(xx-x)**2+(yy-y)**2;
        if(d<best){best=d;px=xx;py=yy;}});x=px;y=py;
    }
    const key=`${x.toFixed(5)},${y.toFixed(5)}`;
    if(ids.has(key))return ids.get(key)!;
    const n=direction(x,y,radius);
    // Interpolate the nearest coast heights through the gaps; keep the skin beneath relief inland.
    let d1=Infinity,d2=Infinity,r1=radius,r2=radius;
    for(const p of shores){const d=(p.x-x)**2+(p.y-y)**2;
      if(d<d1){d2=d1;r2=r1;d1=d;r1=p.radial;}else if(d<d2){d2=d;r2=p.radial;}}
    let r=(r1/(1+d1)+r2/(1+d2))/(1/(1+d1)+1/(1+d2));
    for(const plate of plates) {
      const ring=plate.rings[0]!;let within=false;
      for(let i=0,j=ring.length-1;i<ring.length;j=i++)if((ring[i]!.y>y)!==(ring[j]!.y>y)&&x<(ring[j]!.x-ring[i]!.x)*(y-ring[i]!.y)/(ring[j]!.y-ring[i]!.y)+ring[i]!.x)within=!within;
      if(within)r=Math.min(r,(plate.distance-landHeightRange()-0.12)/n.dot(plate.normal));
    }
    const p=n.multiplyScalar(r),id=vertices.length/3;vertices.push(p.x,p.y,p.z);ids.set(key,id);return id;
  }
  for(let ix=0;ix<nx;ix++)for(let iy=0;iy<ny;iy++){
    const x=minX+ix*step,y=minY+iy*step;
    if(!inside(x+step/2,y+step/2,hull))continue;
    const a=vertex(x,y),b=vertex(x+step,y),c=vertex(x+step,y+step),d=vertex(x,y+step);
    indices.push(a,b,c,a,c,d);
  }
  const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(vertices,3));geometry.setIndex(indices);geometry.computeVertexNormals();
  geometry.userData={method:'Convex envelope of actual coast polygons in azimuthal coordinates, 2-unit lattice, interpolated coast height; opaque double-sided skin under untouched islands',coastVertices:shores.length,triangles:indices.length/3};
  return geometry;
}
export function LandSkin({scene,spots,radius}:{scene:ForestScene;spots:ReadonlyMap<string,PlanetSpot>;radius:number}) {
  const geometry=useMemo(()=>buildSkin(scene,spots,radius),[scene,spots,radius]);
  useEffect(()=>()=>geometry.dispose(),[geometry]);
  return <mesh name="land-skin" geometry={geometry}><meshStandardMaterial color="#6f7352" roughness={1} side={DoubleSide}/></mesh>;
}
export function CoreGlow() {
  const texture=useMemo(()=>{
    const c=document.createElement('canvas');c.width=c.height=128;const context=c.getContext('2d')!;
    const g=context.createRadialGradient(64,64,0,64,64,64);g.addColorStop(0,'rgba(159,194,185,0.5)');g.addColorStop(0.3,'rgba(119,167,159,0.22)');g.addColorStop(1,'rgba(80,132,132,0)');
    context.fillStyle=g;context.fillRect(0,0,128,128);return new CanvasTexture(c);
  },[]);
  useEffect(()=>()=>texture.dispose(),[texture]);
  return <sprite name="placeholder-core" scale={[70,70,1]}><spriteMaterial map={texture} transparent depthWrite={false} toneMapped={false}/></sprite>;
}
