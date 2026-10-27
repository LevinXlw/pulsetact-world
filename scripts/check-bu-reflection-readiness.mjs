import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,expect} from '@playwright/test';
import {authenticateContext} from './test-auth.mjs';

// Isolated actual WebGL integration, not a full-campus walking or visual acceptance.
// Runtime complete-building loaders and sky are unchanged; timing/instrumentation are test-only.
const base=process.env.WORLD_BASE_URL||'http://127.0.0.1:5186';
const directory=process.env.BU_REFLECTION_REVIEW_DIR||'output/bu-reality-20261026/reflections';
const report={status:'running',startedAt:new Date().toISOString(),base,kind:'Actual WebGL integration with runtime CDS/Questrom GLBs; isolated scene, not full-campus realism acceptance',sources:{},profiles:[],errors:[]};
await mkdir(directory,{recursive:true});
for(const path of ['src/features/world/bu-refined-building-asset.ts','src/features/world/painterly-sky.ts','public/assets/bu-cds/cds-full.glb','public/assets/bu-questrom/questrom-full.glb'])report.sources[path]=createHash('sha256').update(await readFile(path)).digest('hex');
let browser,page;
try{
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 for(const mode of ['delayed-ready','failed-fallback']){
  const entry={mode,status:'running',checks:[],errors:[],expectedNetworkErrors:[],views:[]};report.profiles.push(entry);
  const context=await browser.newContext({viewport:{width:960,height:640},deviceScaleFactor:1});await authenticateContext(context,base);
  let releaseSky;const gate=new Promise(resolve=>{releaseSky=resolve;});let requested=false;
  await context.route('**/assets/environment/mit-painted-sky-v1.png',async route=>{requested=true;await gate;if(mode==='failed-fallback')await route.abort('failed');else await route.continue();});
  page=await context.newPage();page.setDefaultTimeout(180000);
  page.on('pageerror',error=>entry.errors.push(error.message));
  page.on('console',message=>{if(message.type()!=='error')return;if(mode==='failed-fallback'&&message.text().includes('net::ERR_FAILED'))entry.expectedNetworkErrors.push(message.text());else entry.errors.push(message.text());});
  await page.route('**/__bu-reflection-readiness',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>BU reflection integration check</title><link rel="icon" href="data:,"><body style="margin:0;background:#17212a">'}));
  await page.goto(base+'/__bu-reflection-readiness',{waitUntil:'domcontentloaded'});
  entry.setup=await page.evaluate(async()=>{
   const source=await fetch('/src/features/world/bu-refined-building-asset.ts').then(r=>r.text());
   const dependency=source.match(/from ["']([^"']+three[^"']*)["']/)?.[1];if(!dependency)throw Error('Runtime Three.js dependency unavailable');
   const T=await import(dependency);
   const {createPainterlySky}=await import('/src/features/world/painterly-sky.ts');
   const {loadCDSBuilding}=await import('/src/features/world/bu-cds-asset.ts');
   const {loadQuestromBuilding}=await import('/src/features/world/bu-questrom-asset.ts');
   const {BOSTON_DAYLIGHT:light}=await import('/src/features/world/campus-daylight.ts');
   const scene=new T.Scene(),sky=createPainterlySky({value:0});scene.add(sky,new T.HemisphereLight(light.sky,light.ground,light.ambient));
   const sun=new T.DirectionalLight(light.sun,light.intensity);sun.position.set(...light.offset);scene.add(sun);
   const renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setPixelRatio(1);renderer.setSize(960,640);renderer.toneMapping=T.ACESFilmicToneMapping;document.body.appendChild(renderer.domElement);
   const shaderErrors=[];renderer.debug.onShaderError=(gl,program,vertex,fragment)=>shaderErrors.push(gl.getProgramInfoLog(program),gl.getShaderInfoLog(vertex),gl.getShaderInfoLog(fragment));
   const buildings={cds:await loadCDSBuilding(new AbortController().signal),questrom:await loadQuestromBuilding(new AbortController().signal)};
   Object.values(buildings).forEach(b=>scene.add(b.group));scene.updateMatrixWorld(true);
   const camera=new T.PerspectiveCamera(52,1.5,.12,4200),captures=[],filteredTargets=[];let activeBuilding=null,frame=0;
   const originalUpdate=T.CubeCamera.prototype.update,originalFilter=T.PMREMGenerator.prototype.fromCubemap;
   T.CubeCamera.prototype.update=function(...args){const capture={building:activeBuilding,frame,skyStatus:sky.userData.painterlySkyLoadState.status,skyReady:sky.material.uniforms.uSkyReady.value,resolution:this.renderTarget.width,far:this.children[0].far,position:this.position.toArray(),completed:false};captures.push(capture);const result=originalUpdate.apply(this,args);capture.completed=true;return result;};
   T.PMREMGenerator.prototype.fromCubemap=function(...args){const target=originalFilter.apply(this,args),record={width:target.width,height:target.height,disposed:0};target.addEventListener('dispose',()=>record.disposed++);filteredTargets.push(record);return target;};
   const materials=id=>{const found=new Set();buildings[id].group.traverse(o=>{if(o.isMesh)for(const m of Array.isArray(o.material)?o.material:[o.material])if(m.isMeshStandardMaterial)found.add(m);});return [...found];};
   const positionCamera=id=>{const bounds=new T.Box3().setFromObject(buildings[id].group),center=bounds.getCenter(new T.Vector3()),size=bounds.getSize(new T.Vector3());camera.position.copy(center).add(new T.Vector3(size.x*.45,Math.max(5,size.y*.1),Math.max(size.x,size.z)*1.25));camera.lookAt(center);camera.updateMatrixWorld(true);return {position:camera.position.toArray(),target:center.toArray(),bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()}};};
   const draw=id=>{activeBuilding=id;positionCamera(id);frame++;renderer.render(scene,camera);};
   const state=()=>({frame,skyStatus:sky.userData.painterlySkyLoadState.status,skyReady:sky.material.uniforms.uSkyReady.value,captures:[...captures],filteredTargets:[...filteredTargets],shaderErrors:[...shaderErrors],memory:{...renderer.info.memory},buildings:Object.fromEntries(Object.keys(buildings).map(id=>[id,{ready:buildings[id].group.userData[id+'EnvironmentReady']===true,materials:materials(id).length,environmentMaterials:materials(id).filter(m=>m.envMap).length,glassMaterials:materials(id).filter(m=>/glass/i.test(m.name)).map(m=>({name:m.name,environment:!!m.envMap}))}]))});
   window.reflectionCheck={T,scene,sky,renderer,buildings,camera,captures,filteredTargets,shaderErrors,materials,positionCamera,draw,state,restore:()=>{T.CubeCamera.prototype.update=originalUpdate;T.PMREMGenerator.prototype.fromCubemap=originalFilter;}};
   const gl=renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info');
   return {threeRevision:T.REVISION,gpu:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),assetBytes:Object.fromEntries(Object.entries(buildings).map(([id,b])=>[id,b.bytes])),light};
  });
  await expect.poll(()=>requested).toBe(true);
  entry.pending=await page.evaluate(()=>{const t=window.reflectionCheck;for(let i=0;i<6;i++)for(const id of ['cds','questrom'])t.draw(id);return t.state();});
  expect(entry.pending.skyStatus).toBe('loading');expect(entry.pending.skyReady).toBe(0);expect(entry.pending.captures).toHaveLength(0);expect(entry.pending.filteredTargets).toHaveLength(0);
  for(const value of Object.values(entry.pending.buildings)){expect(value.ready).toBe(false);expect(value.environmentMaterials).toBe(0);}
  entry.checks.push('Twelve real render frames during held image request produce zero cube or PMREM captures.');
  await page.screenshot({path:directory+'/'+mode+'-pending.png'});releaseSky();
  await page.waitForFunction(expected=>window.reflectionCheck.sky.userData.painterlySkyLoadState.status===expected,mode==='delayed-ready'?'ready':'fallback',{timeout:60000});
  for(const id of ['cds','questrom']){
   const view=await page.evaluate(id=>{
    const t=window.reflectionCheck,{T,renderer,scene,camera}=t;t.draw(id);t.draw(id);
    const view=t.positionCamera(id),target=new T.WebGLRenderTarget(960,640),withEnvironment=new Uint8Array(960*640*4),withoutEnvironment=new Uint8Array(960*640*4);
    renderer.setRenderTarget(target);renderer.render(scene,camera);renderer.readRenderTargetPixels(target,0,0,960,640,withEnvironment);
    const old=t.materials(id).map(material=>({material,map:material.envMap}));
    try{old.forEach(({material})=>{material.envMap=null;material.needsUpdate=true;});renderer.render(scene,camera);renderer.readRenderTargetPixels(target,0,0,960,640,withoutEnvironment);}
    finally{old.forEach(({material,map})=>{material.envMap=map;material.needsUpdate=true;});renderer.setRenderTarget(null);target.dispose();}
    let delta=0,changedPixels=0,nonBlackPixels=0,maxDelta=0;for(let i=0;i<withEnvironment.length;i+=4){let changed=0;for(let c=0;c<3;c++){const d=Math.abs(withEnvironment[i+c]-withoutEnvironment[i+c]);delta+=d;changed=Math.max(changed,d);maxDelta=Math.max(maxDelta,d);}if(changed>2)changedPixels++;if(withEnvironment[i]+withEnvironment[i+1]+withEnvironment[i+2]>0)nonBlackPixels++;}
    renderer.render(scene,camera);return {id,...view,pixelEvidence:{width:960,height:640,meanRGBDifference:delta/(960*640*3),changedPixels,nonBlackPixels,maxDelta},png:renderer.domElement.toDataURL('image/png'),glError:renderer.getContext().getError(),state:t.state()};
   },id);
   await writeFile(directory+'/'+mode+'-'+id+'.png',Buffer.from(view.png.split(',')[1],'base64'));delete view.png;entry.views.push(view);
   expect(view.glError).toBe(0);expect(view.pixelEvidence.nonBlackPixels).toBeGreaterThan(960*640*.9);expect(view.pixelEvidence.changedPixels).toBeGreaterThan(100);expect(view.pixelEvidence.meanRGBDifference).toBeGreaterThan(.01);
   expect(view.state.buildings[id].ready).toBe(true);expect(view.state.buildings[id].environmentMaterials).toBe(view.state.buildings[id].materials);
  }
  entry.checks.push('Both actual GLBs receive filtered reflections; same-view envMap on/off pixel comparison proves visible contribution.');
  entry.settled=await page.evaluate(()=>{const t=window.reflectionCheck;for(let i=0;i<6;i++)for(const id of ['cds','questrom'])t.draw(id);return t.state();});
  expect(entry.settled.captures).toHaveLength(2);expect(entry.settled.filteredTargets).toHaveLength(2);expect(entry.settled.skyReady).toBe(mode==='delayed-ready'?1:0);expect(entry.settled.shaderErrors).toEqual([]);
  for(const capture of entry.settled.captures){expect(capture.completed).toBe(true);expect(capture.skyStatus).toBe(mode==='delayed-ready'?'ready':'fallback');expect(capture.resolution).toBe(128);expect(capture.far).toBe(260);}
  entry.checks.push('Exactly two real 128px/260m captures after settlement, with no repeated captures across twelve more frames; fallback keeps uSkyReady=0.');
  entry.disposed=await page.evaluate(()=>{const t=window.reflectionCheck;for(const b of Object.values(t.buildings)){b.disposeEnvironment();b.disposeEnvironment();}const state=t.state();t.restore();for(const b of Object.values(t.buildings))b.dispose();t.sky.geometry.dispose();t.sky.material.uniforms.uSkyMap.value.dispose();t.sky.material.dispose();t.renderer.dispose();t.renderer.forceContextLoss();return state;});
  entry.disposed.filteredTargets.forEach(target=>expect(target.disposed).toBe(1));for(const value of Object.values(entry.disposed.buildings)){expect(value.ready).toBe(false);expect(value.environmentMaterials).toBe(0);}
  entry.checks.push('Both PMREM targets disposed exactly once; all building envMap bindings cleared.');
  expect(entry.errors).toEqual([]);entry.status='passed';await context.close();page=null;console.log('PASS '+mode);
 }
 report.status='passed';
}catch(error){report.status='failed';report.errors.push(error.stack??String(error));process.exitCode=1;await page?.screenshot({path:directory+'/failure.png'}).catch(()=>{});}
finally{report.finishedAt=new Date().toISOString();await writeFile(directory+'/report.json',JSON.stringify(report,null,2));await browser?.close();console.log(JSON.stringify({status:report.status,profiles:report.profiles.map(({mode,status})=>({mode,status})),errors:report.errors}));}
