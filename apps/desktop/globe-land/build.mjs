// Actual desktop renderer; only the explicitly described spike substitutions are injected.
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../../..');
const slots=JSON.parse(readFileSync(path.join(here,'slots.json'),'utf8'));
const canvasPath=path.join(root,'packages/forest-world/src/planet/PlanetWorldCanvas.tsx');
const source=readFileSync(canvasPath,'utf8');
for(const variant of ['a','b']) {
  const folder=path.join(here,'dist',variant);mkdirSync(folder,{recursive:true});
  let canvas=source.replace('<Lights />','<Lights />\n    <CaptureProbe />')
    .replace(/      <mesh name="planet:sea">[\s\S]*?      <\/mesh>/,`      <CoreGlow />${variant==='b'?'\n      <LandSkin scene={scene} spots={spots} radius={radius} />':''}`);
  canvas=`import { LandSkin, CoreGlow } from ${JSON.stringify(path.join(here,'land-skin.tsx'))};\n`+canvas;
  canvas+='\nfunction CaptureProbe() { const state = useThree(); globalThis.__globe = state; return null; }\n';
  const placement=`// Frozen once for the two look inputs; never fitted to a live project.\nexport const PLANET_RADIUS=${slots.radius};\nexport const PLANET_CAPACITY=${slots.slots.length};\nconst slots=${JSON.stringify(slots.slots.map(s=>s.spot))};\nexport function placeOnGlobe(place){ const p=slots[place-1]; if(!p)throw new RangeError('Look has 36 frozen slots'); return {x:p[0]*PLANET_RADIUS,y:p[1]*PLANET_RADIUS,z:p[2]*PLANET_RADIUS}; }\n`;
  await build({absWorkingDir:path.join(root,'apps/desktop'),entryPoints:[path.join(root,'apps/desktop/src/renderer/renderer.ts')],outfile:path.join(folder,'renderer.js'),bundle:true,logLevel:'warning',sourcemap:true,platform:'browser',format:'iife',target:'es2023',loader:{'.glb':'binary'},plugins:[{name:'globe-land-spike',setup(build){
    build.onLoad({filter:/planet-places\.ts$/},()=>({contents:placement,loader:'ts'}));
    build.onLoad({filter:/PlanetWorldCanvas\.tsx$/},()=>({contents:canvas,loader:'tsx',resolveDir:path.dirname(canvasPath)}));
    build.onLoad({filter:/planet-view\.tsx$/},args=>({contents:readFileSync(args.path,'utf8').replace('const { camera, gl, scene, size } = useThree();','const { camera, gl, scene, size } = useThree(); globalThis.__nav = { rotation, onRotate };'),loader:'tsx',resolveDir:path.dirname(args.path)}));
  }}]});
  for(const file of ['index.html','styles.css'])copyFileSync(path.join(root,'apps/desktop/src/renderer',file),path.join(folder,file));
  writeFileSync(path.join(folder,'substituted-canvas.txt'),canvas);
}
console.log('Built A and B from the actual desktop page.');
