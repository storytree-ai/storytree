// Borrowed globe-look-2 capture path: actual desktop HTML, CSS, renderer and Electron read API.
// Run in the foreground under flock /tmp/storytree-heavy.lock.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const {chromium}=await import(process.env.PLANET_PLAYWRIGHT??'/home/mickh/code/Storytree/node_modules/.pnpm/playwright-core@1.60.0/node_modules/playwright-core/index.mjs');
const here=path.dirname(fileURLToPath(import.meta.url)),out=path.resolve(here,'../../../docs/research/globe-pathways');
const seed=JSON.parse(readFileSync(path.join(here,'seed.json'),'utf8'));
const slots=JSON.parse(readFileSync(path.join(here,'paths.json'),'utf8'));
const server=createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  const match=/^\/(baseline|within|v1|v2)\/(index.html|renderer.js|renderer.js.map|styles.css)$/.exec(pathname);
  if(!match){res.writeHead(404).end();return;}
  res.setHeader('Content-Type',pathname.endsWith('.js')?'text/javascript':pathname.endsWith('.css')?'text/css':pathname.endsWith('.map')?'application/json':'text/html');
  res.end(readFileSync(path.join(here,'dist',match[1],match[2])));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:process.env.PLANET_CHROMIUM??'/home/mickh/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell',headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
async function settle(page) {
  await page.evaluate(async()=>{for(let i=0;i<12;i++){window.__globe.invalidate();await new Promise(requestAnimationFrame);}});
}
async function measure(page,radius) {
  return page.evaluate(radius=>{
    const {scene,camera,gl,size}=window.__globe;
    scene.updateMatrixWorld(true);camera.updateMatrixWorld(true);
    const V=camera.position.constructor,Q=camera.quaternion.constructor;
    const eye=new V(0,0,1).applyQuaternion(camera.quaternion),plates=[];
    scene.traverse(object=>{
      if(!object.name.startsWith('planet:story_'))return;
      const normal=new V(0,1,0).applyQuaternion(object.getWorldQuaternion(new Q()));
      let meshes=0,vertices=0,triangles=0;const materials=[];
      object.traverse(mesh=>{if(mesh.isMesh&&mesh.geometry?.attributes.position){meshes++;vertices+=mesh.geometry.attributes.position.count;triangles+=(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3;
        materials.push(...(Array.isArray(mesh.material)?mesh.material:[mesh.material]).map(m=>({type:m.type,side:m.side,transparent:m.transparent})));}});
      plates.push({story:object.name.slice(7),facing:normal.dot(eye),at:object.getWorldPosition(new V()).project(camera).toArray(),position:object.position.toArray(),meshes,vertices,triangles,materials});
    });
    // Explicitly measure one settled main-scene frame, excluding the one-time light calibration.
    gl.info.reset();gl.render(scene,camera);
    const render={...gl.info.render},memory={...gl.info.memory};
    const ctx=gl.getContext(),debug=ctx.getExtension('WEBGL_debug_renderer_info');
    const skin=scene.getObjectByName('land-skin');
    return {renderer:debug&&ctx.getParameter(debug.UNMASKED_RENDERER_WEBGL),radius,zoom:camera.zoom,camera:camera.position.toArray(),rotation:window.__nav.rotation.toArray(),canvas:size,plates,render,memory,
      skin:skin?.geometry.userData??null,seaPresent:!!scene.getObjectByName('planet:sea'),corePresent:!!scene.getObjectByName('placeholder-core'),shellPresent:!!scene.getObjectByName('planet:shell'),pathwaySegments:scene.getObjectByName('pathways:cross-island')?.children.length??0,
      labels:[...document.querySelectorAll('.forest-label')].map(el=>({text:el.textContent,visible:el.checkVisibility(),opacity:getComputedStyle(el).opacity,bounds:el.getBoundingClientRect().toJSON()})),
      drew:JSON.parse(document.body.dataset.drew),view:document.querySelector('.forest').dataset.view};
  },radius);
}
const cases=['baseline','within','v1','v2'].flatMap(v=>[[v+'-front',v,seed,false],[v+'-quarter-turn',v,seed,true]]);
const requested=process.argv.slice(2);
try {
  for(const [name,variant,input,quarter] of cases.filter(([name])=>!requested.length||requested.includes(name))) {
    console.log(`Rendering ${name}`);
    const page=await browser.newPage({viewport:{width:1440,height:960},deviceScaleFactor:1,colorScheme:'dark'});
    const errors=[],warnings=[];
    page.on('pageerror',error=>errors.push(String(error)));
    page.on('console',message=>{
      if(!['error','warning'].includes(message.type()))return;const t=message.text();
      if(t.includes('Attempted to synchronously unmount a root')||message.type()==='warning')warnings.push(t);else errors.push(t);
    });
    await page.addInitScript(data=>{
      const copy=value=>structuredClone(value);
      window.storytree={listProjects:async()=>copy(data.projects),projectTree:async()=>copy(data.tree),changesSince:async(_,cursor)=>cursor===0?copy(data.changes):{changes:[],cursor:data.changes.cursor},linesSince:async(_,cursor)=>cursor===0?copy(data.lines):{lines:[],cursor:data.lines.cursor},frontCovers:async(_,id)=>copy(data.covers[id]??[]),relatedNotes:async()=>[]};
    },input);
    await page.goto(`http://127.0.0.1:${server.address().port}/${variant}/index.html`,{timeout:180000,waitUntil:'domcontentloaded'});
    await page.waitForFunction(count=>{
      const state=window.__globe;if(document.body.dataset.state!=='ready'||!state||!window.__nav)return false;
      let plates=0,ready=0;state.scene.traverse(object=>{if(!object.name.startsWith('planet:story_'))return;plates++;let meshes=0;object.traverse(mesh=>{if(mesh.isMesh&&mesh.geometry?.attributes.position?.count>0)meshes++;});if(meshes>=2)ready++;});
      return plates===count&&ready===count;
    },input.tree.stories.length,{timeout:180000});
    await settle(page);
    if(quarter){
      await page.evaluate(()=>{const {camera}=window.__globe,{rotation,onRotate}=window.__nav;const Q=camera.quaternion.constructor,V=camera.position.constructor;const turn=new Q().setFromAxisAngle(new V(0,1,0),Math.PI/2);onRotate(camera.quaternion.clone().multiply(turn).multiply(camera.quaternion.clone().invert()).multiply(rotation));});
      await settle(page);
    }
    const result=await measure(page,variant==='baseline'?160:slots.radius);result.browser=await browser.version();result.errors=errors;result.variant=variant;result.nativeCrossLinks=0;result.browserDeclaredCrossLinks=['baseline','within'].includes(variant)?0:slots.stats.declaredBrowserLinks;result.warnings=[...new Set(warnings)];
    if(errors.length||result.seaPresent||result.corePresent||result.plates.length!==input.tree.stories.length||result.drew.stories.length!==input.tree.stories.length)throw new Error(`${name}: incomplete capture ${JSON.stringify(errors)}`);
    const expectedTrees=input.tree.stories.reduce((n,s)=>n+s.capabilities.length,0);
    if(result.drew.trees.length!==expectedTrees)throw new Error('Missing capability trees');
    if(variant==='v1'||variant==='v2')await page.evaluate(label=>{
      const note=document.createElement('div');note.textContent=label;
      note.style.cssText='position:fixed;bottom:14px;right:14px;z-index:1000;background:#20262bee;color:#e5dbc4;border:1px solid #5d605e;border-radius:6px;padding:10px 14px;font:12px system-ui;pointer-events:none';
      document.body.append(note);
    },variant.toUpperCase()+' LOOK TEST · 22 story-file links added for this picture · seed has 0');
    await page.screenshot({path:path.join(out,`${name}.png`),timeout:180000});
    writeFileSync(path.join(out,`${name}.json`),JSON.stringify(result,null,2)+'\n');
    console.log(JSON.stringify({name,stories:result.plates.length,trees:result.drew.trees.length,front:result.plates.filter(p=>p.facing>0).length,drawCalls:result.render.calls,triangles:result.render.triangles,errors,warnings:result.warnings}));
    await page.close();
  }
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
