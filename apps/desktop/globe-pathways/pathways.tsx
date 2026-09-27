// Temporary visual adapter: physical-width strips, with no supporting land or bridge.
import { useMemo, useEffect } from 'react';
import { BufferGeometry, Float32BufferAttribute, Vector3, DoubleSide } from 'three';
import data from './paths.json';
import { RIBBON_GROUND_SCALE } from '../../../packages/forest-world/src/trail-ribbon-width';
const variant = '__PATHWAY_VARIANT__';
export function pathWear(cells) {
  const ids = new Set(cells.map(c=>c.island));
  return new Map(Object.entries(variant==='within'?data.nativeWear:data.wear).filter(([id])=>ids.has(id)));
}
function geometry(route,halo=false) {
  const points=route.points.map(p=>new Vector3(...p.direction).multiplyScalar(data.radius+0.12+p.rise+(variant==='v2'?0.9*(1-p.shoreBlend):0)));
  const position=[],normal=[],index=[],half=route.width*RIBBON_GROUND_SCALE*(halo?2.4:1)/2;
  for(let i=0;i<points.length;i++) {
    const p=points[i],radial=p.clone().normalize(),tangent=points[Math.min(points.length-1,i+1)].clone().sub(points[Math.max(0,i-1)]),side=radial.clone().cross(tangent).normalize().multiplyScalar(half);
    for(const sign of [-1,1]){position.push(...p.clone().addScaledVector(side,sign).toArray());normal.push(...radial.toArray());}
    if(i)index.push(2*i-2,2*i-1,2*i,2*i-1,2*i+1,2*i);
  }
  const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(position,3));g.setAttribute('normal',new Float32BufferAttribute(normal,3));g.setIndex(index);return g;
}
export function CrossPaths() {
  const meshes=useMemo(()=>data.ribbons.map(route=>({route,geometry:geometry(route),halo:variant==='v2'?geometry(route,true):null})),[]);
  useEffect(()=>()=>meshes.forEach(m=>{m.geometry.dispose();m.halo?.dispose();}),[meshes]);
  return <group name="pathways:cross-island">{meshes.map(({route,geometry,halo})=><group key={route.id}>
    <mesh name={'pathway:'+route.id} geometry={geometry} userData={{links:route.links,widthGround:route.width*RIBBON_GROUND_SCALE}}>
      <meshBasicMaterial color={variant==='v2'?'#c7bba1':'#b0a48e'} side={DoubleSide}/>
    </mesh>
    {halo&&<mesh geometry={halo}><meshBasicMaterial color="#dacaaa" transparent opacity={0.10} depthWrite={false} side={DoubleSide}/></mesh>}
  </group>)}</group>;
}
