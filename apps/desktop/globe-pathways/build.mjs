// Borrowed from spike/globe-land. Every substitution is below; nothing is written to src/.
import { mkdirSync,readFileSync,writeFileSync,copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../../..');
const data=JSON.parse(readFileSync(path.join(here,'paths.json'),'utf8'));
const canvasPath=path.join(root,'packages/forest-world/src/planet/PlanetWorldCanvas.tsx');
const module=JSON.stringify(path.join(here,'pathways.tsx'));
function replace(source,needle,value){if(!source.includes(needle))throw Error('Capture hook moved: '+needle);return source.replace(needle,value);}
for(const variant of ['baseline','within','v1','v2']) {
  const experimental=variant!=='baseline',cross=variant==='v1'||variant==='v2';
  const folder=path.join(here,'dist',variant);mkdirSync(folder,{recursive:true});
  let canvas=replace(readFileSync(canvasPath,'utf8'),'<Lights />','<Lights /><CaptureProbe />');
  canvas+='\nfunction CaptureProbe() { const state=useThree(); globalThis.__globe=state; return null; }\n';
  if(cross)canvas=`import { CrossPaths } from ${module};\n`+replace(canvas,'{inside}','<CrossPaths />{inside}');
  await build({absWorkingDir:path.join(root,'apps/desktop'),entryPoints:[path.join(root,'apps/desktop/src/renderer/renderer.ts')],outfile:path.join(folder,'renderer.js'),bundle:true,logLevel:'warning',sourcemap:true,platform:'browser',format:'iife',target:'es2023',loader:{'.glb':'binary'},plugins:[{name:'globe-pathways-look',setup(build){
    build.onLoad({filter:/planet-places\.ts$/},args=>({contents:experimental?replace(readFileSync(args.path,'utf8'),'PLANET_RADIUS = 160','PLANET_RADIUS = '+data.radius):readFileSync(args.path,'utf8'),loader:'ts',resolveDir:path.dirname(args.path)}));
    build.onLoad({filter:/PlanetWorldCanvas\.tsx$/},()=>({contents:canvas,loader:'tsx',resolveDir:path.dirname(canvasPath)}));
    build.onLoad({filter:/planet-view\.tsx$/},args=>({contents:replace(readFileSync(args.path,'utf8'),'const { camera, gl, scene, size } = useThree();','const { camera, gl, scene, size } = useThree(); globalThis.__nav = { rotation, onRotate };'),loader:'tsx',resolveDir:path.dirname(args.path)}));
    if(experimental) {
      build.onLoad({filter:/ForestWorldCanvas\.tsx$/},args=>({contents:`import { pathWear } from ${module};\n`+replace(readFileSync(args.path,'utf8'),'buildAtlasWear(islandPaths(clipped, strips), field)','buildAtlasWear(pathWear(clipped), field)'),loader:'tsx',resolveDir:path.dirname(args.path)}));
      build.onLoad({filter:/pathways\.tsx$/},args=>({contents:readFileSync(args.path,'utf8').replace('__PATHWAY_VARIANT__',variant),loader:'tsx',resolveDir:here}));
    }
  }}]});
  for(const file of ['index.html','styles.css'])copyFileSync(path.join(root,'apps/desktop/src/renderer',file),path.join(folder,file));
  writeFileSync(path.join(folder,'substituted-canvas.txt'),canvas);
}
console.log('Built unchanged baseline and explicit look-only pathway variants.');
