import {constants} from 'node:fs';
import {copyFile,mkdir,readFile,stat,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,expect} from '@playwright/test';
import {authenticateContext} from './test-auth.mjs';

// Run before any runtime replacement, then reuse the immutable camera lock:
//   node scripts/capture-cds-full.mjs --phase=before
//   node scripts/capture-cds-full.mjs --phase=after
//   node scripts/capture-cds-full.mjs --check-review
// A completed phase is never overwritten. Failed attempts stay in attempts/.
const directory='output/cds-full-20261019';
const phase=process.argv.find(value=>value.startsWith('--phase='))?.slice(8)??'before';
if(!['before','after'].includes(phase))throw Error('Use --phase=before or --phase=after.');
const base=process.env.WORLD_BASE_URL||'http://127.0.0.1:5186';
if(process.argv.includes('--check-review')){await checkReview();process.exit(0);}
const lockPath=`${directory}/camera-lock.json`;
const frames=[
  {id:'19-cds-west-entry',eye:[-920.426,1.75,1041.726],target:[-911.108,2.9,1022.895],fov:62,inspect:'West ground-floor glazing, existing entrance and paved approach.'},
  {id:'20-cds-podium-entry',eye:[-879.156,1.75,1049.773],target:[-878.688,2.9,1032.730],fov:65,inspect:'East podium door group, canopy columns and ground junction.'},
  {id:'21-cds-street-context',eye:[-865,33,1096],target:[-899,16,1020],fov:62,inspect:'Actual Commonwealth street, podium and campus context.'},
  {id:'22-cds-full-south',eye:[-900,115,1230],target:[-900,43,1009],fov:48,fullHeight:true,inspect:'Elevated south view: complete ground-to-roof tower and both side edges, with surrounding campus.'},
  {id:'23-cds-northeast',eye:[-776,70,879],target:[-901,38,1009],fov:58,fullHeight:true,inspect:'Northeast rear/side: setbacks, terraces and retained Bay State/river context.'},
];
const renderSettings={width:1600,height:1000,pixelRatio:1,antialias:true,near:.12,far:4200,toneMapping:'ACESFilmicToneMapping',exposure:1,background:'#c5d9d5',fog:[180,2600],shadowMapSize:4096,shadowCamera:{left:-95,right:95,top:95,bottom:-95,near:1,far:390},shadowBias:-.00008,shadowNormalBias:.035,shadowRadius:3,simulationDelta:0};
const sourcePaths=['src/features/world/scene-assets.ts','src/features/world/scene-assets-desktop.ts','src/features/world/boston-university.ts','src/features/world/bu-landmark-layout.ts','src/features/world/bu-cds-entry-layout.ts','src/features/world/campus-daylight.ts'];
if(phase==='after')sourcePaths.push('src/features/world/bu-cds-asset.ts');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function sourceHashes(){return Object.fromEntries(await Promise.all(sourcePaths.map(async path=>[path,hash(await readFile(path))])));}
async function exists(path){try{await stat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
if(await exists(`${directory}/${phase}/visual-report.json`))throw Error(`Refusing to overwrite completed ${phase} capture.`);
if(phase==='before'&&await exists(lockPath))throw Error('A before camera lock already exists; the baseline is immutable.');
const lock=phase==='after'?JSON.parse(await readFile(lockPath,'utf8')):null;
if(lock&&JSON.stringify(lock.requestedFrames)!==JSON.stringify(frames))throw Error('Camera definitions changed since the baseline. Restore them before capturing after.');
if(lock&&JSON.stringify(lock.renderSettings)!==JSON.stringify(renderSettings))throw Error('Render settings changed since the baseline.');
const sourceBefore=await sourceHashes();
const attempt=`${directory}/attempts/${phase}-${new Date().toISOString().replace(/[:.]/g,'-')}`;
await mkdir(attempt,{recursive:true});
const report={phase,base,capturedAt:new Date().toISOString(),renderSettings,sourceHashes:sourceBefore,errors:[],geometryIssues:[],views:[],checks:[],status:'running'};
let browser;
try{
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
  const context=await browser.newContext({viewport:{width:renderSettings.width,height:renderSettings.height},deviceScaleFactor:1});
  await authenticateContext(context,base);
  const page=await context.newPage();page.setDefaultTimeout(120000);
  page.on('pageerror',error=>report.errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
  await page.route('**/cds-full-capture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><title>CDS complete campus capture</title></head><body style="margin:0"></body></html>'}));
  await page.goto(`${base}/cds-full-capture`);
  const initialized=await page.evaluate(async({settings,lockedLight,phase})=>{
    const THREE=await import('/node_modules/three/build/three.module.js');
    const {loadWorldAssets}=await import('/src/features/world/scene-assets.ts');
    const {buElevation}=await import('/src/features/world/bu-terrain.ts');
    const {BU_FULL_BUILDINGS}=await import('/src/features/world/bu-full-layout.ts');
    const {BU_CDS_MAP_FEATURE,BU_CDS_HEIGHT,BU_CDS_PLATE,BU_CDS_MODULE,BU_CDS_YAW}=await import('/src/features/world/bu-landmark-layout.ts');
    const {BOSTON_DAYLIGHT}=await import('/src/features/world/campus-daylight.ts');
    if(lockedLight&&JSON.stringify(lockedLight)!==JSON.stringify(BOSTON_DAYLIGHT))throw Error('Boston daylight changed since the before capture.');
    const light=lockedLight??BOSTON_DAYLIGHT,assets=await loadWorldAssets(new AbortController().signal,'boston',false);
    assets.wind.value=0;assets.setQuality(false);
    const oldCDS=[],refinedCDS=[];
    assets.model.traverse(object=>{if(object.isGroup&&object.name==='BU CDS · replaceable visual')oldCDS.push(object);if(object.userData.cdsRefined===true)refinedCDS.push(object);});
    const visibleMeshes=o=>{let count=0;o.traverseVisible(child=>{if(child.isMesh)count++;});return count;};
    const replacement={...assets.model.userData.cdsReplacement,oldVisuals:oldCDS.map(o=>({name:o.name,visible:o.visible,visibleMeshes:visibleMeshes(o)})),refinedVisuals:refinedCDS.map(o=>({name:o.name,visible:o.visible,visibleMeshes:visibleMeshes(o)}))};
    if(phase==='after'&&(replacement.status!=='loaded'||oldCDS.length!==1||replacement.oldVisuals.some(o=>o.visible||o.visibleMeshes!==0)||refinedCDS.length!==1||!refinedCDS[0].visible||replacement.refinedVisuals[0].visibleMeshes===0))throw Error(`CDS replacement is not active: ${JSON.stringify(replacement)}`);
    const scene=new THREE.Scene();scene.background=new THREE.Color(settings.background);scene.fog=new THREE.Fog(settings.background,...settings.fog);
    scene.add(assets.model,new THREE.HemisphereLight(light.sky,light.ground,light.ambient));
    const sun=new THREE.DirectionalLight(light.sun,light.intensity);sun.castShadow=true;sun.shadow.mapSize.set(settings.shadowMapSize,settings.shadowMapSize);Object.assign(sun.shadow.camera,settings.shadowCamera);sun.shadow.bias=settings.shadowBias;sun.shadow.normalBias=settings.shadowNormalBias;sun.shadow.radius=settings.shadowRadius;scene.add(sun,sun.target);
    const renderer=new THREE.WebGLRenderer({antialias:settings.antialias,preserveDrawingBuffer:true});renderer.setPixelRatio(settings.pixelRatio);renderer.setSize(settings.width,settings.height);renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=settings.exposure;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;document.body.appendChild(renderer.domElement);
    const camera=new THREE.PerspectiveCamera(52,settings.width/settings.height,settings.near,settings.far);
    const invalidGeometry=[];assets.model.traverse(object=>{
      if(!object.isMesh)return;const position=object.geometry.getAttribute('position');
      if(!position)return;
      for(let i=0;i<position.count;i++)if(![position.getX(i),position.getY(i),position.getZ(i)].every(Number.isFinite)){invalidGeometry.push({mesh:object.name,vertex:i});break;}
    });
    const inside=([x,z],ring)=>{let value=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])value=!value;}return value;};
    const volumes=[...BU_FULL_BUILDINGS,{...BU_CDS_MAP_FEATURE,height:BU_CDS_HEIGHT}];
    const baseY=buElevation(BU_CDS_MAP_FEATURE.x,BU_CDS_MAP_FEATURE.z),extent=(BU_CDS_PLATE+BU_CDS_MODULE)/2;
    const towerPoints=[];for(const x of [-extent,extent])for(const z of [-extent,extent])for(const y of [baseY,baseY+BU_CDS_HEIGHT])towerPoints.push(new THREE.Vector3(BU_CDS_MAP_FEATURE.x+x*Math.cos(BU_CDS_YAW)+z*Math.sin(BU_CDS_YAW),y,BU_CDS_MAP_FEATURE.z-x*Math.sin(BU_CDS_YAW)+z*Math.cos(BU_CDS_YAW)));
    window.cdsCapture={THREE,assets,scene,renderer,camera,sun,buElevation,light,inside,volumes,towerPoints,refinedCDS,oldCDS};
    return{light,invalidGeometry,replacement};
  },{settings:renderSettings,lockedLight:lock?.light,phase});
  report.light=initialized.light;report.geometryIssues=initialized.invalidGeometry;report.cdsReplacement=initialized.replacement;
  await page.waitForFunction(()=>{let ready=true;window.cdsCapture.assets.model.traverse(o=>{const m=o.material;if(m?.uniforms?.uSkyReady&&m.uniforms.uSkyReady.value!==1)ready=false;});return ready;},{},{timeout:30000});
  if(report.geometryIssues.length)throw Error('Non-finite scene geometry; see attempt report.');
  for(const frame of frames){
    const locked=lock?.views.find(view=>view.id===frame.id);
    const result=await page.evaluate(async({frame,locked,phase,warmup})=>{
      const {THREE,assets,scene,renderer,camera,sun,buElevation,light,inside,volumes,towerPoints,refinedCDS,oldCDS}=window.cdsCapture;
      const [x,h,z]=frame.eye,[tx,th,tz]=frame.target;
      const ground=assets.collision.groundHeight(x,z),terrain=buElevation(x,z);
      const eye=locked?.camera??[x,(h<4?(ground??terrain):terrain)+h,z],target=locked?.target??[tx,buElevation(tx,tz)+th,tz];
      camera.fov=frame.fov;camera.updateProjectionMatrix();camera.position.fromArray(eye);camera.lookAt(...target);camera.updateMatrixWorld();
      const sunTarget=locked?.sunTarget??[tx,buElevation(tx,tz),tz];sun.target.position.fromArray(sunTarget);sun.position.copy(sun.target.position).add(new THREE.Vector3(...light.offset));sun.target.updateMatrixWorld();
      assets.update(camera.position,0);assets.model.updateMatrixWorld(true);
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      renderer.render(scene,camera);
      // The full-building reflection is generated by its first onBeforeRender.
      // Capture the next complete render, with no simulation advance or pose change.
      if(warmup){await new Promise(resolve=>requestAnimationFrame(resolve));renderer.render(scene,camera);}
      const cdsEnvironmentReady=refinedCDS[0]?.userData.cdsEnvironmentReady??false;
      if(phase==='after'&&(!cdsEnvironmentReady||oldCDS.some(o=>o.visible)||!refinedCDS[0]?.visible))throw Error('CDS replacement/reflection was not ready after rendering.');
      const forward=new THREE.Vector3();camera.getWorldDirection(forward);
      const collisionDirections=[forward,new THREE.Vector3(1,0,0),new THREE.Vector3(-1,0,0),new THREE.Vector3(0,0,1),new THREE.Vector3(0,0,-1),new THREE.Vector3(0,1,0),new THREE.Vector3(0,-1,0)];
      const nearby=collisionDirections.map(direction=>assets.collision.distance(camera.position,direction,1)??null);
      const cameraInside=volumes.filter(b=>b.footprint?.length&&b.height>0&&eye[1]>=buElevation(b.x,b.z)-.1&&eye[1]<buElevation(b.x,b.z)+b.height+.1&&inside([eye[0],eye[2]],b.footprint)&&!b.holes?.some(ring=>inside([eye[0],eye[2]],ring))).map(b=>b.id);
      const projection=towerPoints.map(point=>point.clone().project(camera).toArray());
      const fullTowerInFrame=projection.every(([px,py,pz])=>Math.abs(px)<.97&&Math.abs(py)<.97&&pz>-1&&pz<1);
      return{png:renderer.domElement.toDataURL('image/png'),camera:eye,target,sunTarget,terrain,groundHeight:ground??null,nearObstacleDistances:nearby,cameraInside,fullTowerInFrame,cdsEnvironmentReady,renderWarmupFrames:warmup?1:0,towerProjectionBounds:{min:[0,1,2].map(i=>Math.min(...projection.map(p=>p[i]))),max:[0,1,2].map(i=>Math.max(...projection.map(p=>p[i])))},render:{calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,programs:renderer.info.programs?.length??0},memory:performance.memory?{usedJSHeapBytes:performance.memory.usedJSHeapSize,totalJSHeapBytes:performance.memory.totalJSHeapSize}:null};
    },{frame,locked,phase,warmup:phase==='after'&&report.views.length===0});
    const png=Buffer.from(result.png.split(',')[1],'base64');await writeFile(`${attempt}/${frame.id}.png`,png,{flag:'wx'});
    const {png:ignored,...stats}=result;report.views.push({...frame,...stats,pngSHA256:hash(png)});
    console.log(JSON.stringify({phase,view:frame.id,render:stats.render,cameraInside:stats.cameraInside,fullTowerInFrame:stats.fullTowerInFrame}));
    if(stats.cameraInside.length||stats.nearObstacleDistances.some(value=>value!==null))throw Error(`Camera collision in ${frame.id}.`);
    if(frame.fullHeight&&!stats.fullTowerInFrame)throw Error(`The complete tower does not fit ${frame.id}; fix before locking the baseline.`);
  }
  if(report.errors.length)throw Error(report.errors.join('\n'));
  if(JSON.stringify(sourceBefore)!==JSON.stringify(await sourceHashes()))throw Error('Runtime source changed during capture; do not publish a mixed baseline.');
  report.checks=['Loaded the actual desktop Boston world through loadWorldAssets, including the surrounding campus.','Boston game daylight, fog, exposure and static simulation shared by every phase.','All cameras clear source building volumes and one-metre collision probes.','Both full-height cameras include the complete tower envelope.','Finite vertices and no browser console/page errors.'];
  if(lock)report.checks.push('World camera, target, sun target and rendering settings exactly reused from immutable before camera-lock.');
  if(phase==='after')report.checks.push('Complete CDS GLB loaded, the old CDS visual group hidden, one refined exterior visible, and neighborhood reflection ready in every captured view.');
  if(phase==='after'&&await exists(`${directory}/after-initial/visual-report.json`))report.revision='Neighborhood reflection range reduced to 260m. First complete replacement capture is preserved in after-initial; immutable before images and cameras are unchanged.';
  report.status='passed';
  await writeFile(`${attempt}/visual-report.json`,JSON.stringify(report,null,2),{flag:'wx'});
  await mkdir(`${directory}/${phase}`,{recursive:true});
  for(const frame of frames)await copyFile(`${attempt}/${frame.id}.png`,`${directory}/${phase}/${frame.id}.png`,constants.COPYFILE_EXCL);
  await copyFile(`${attempt}/visual-report.json`,`${directory}/${phase}/visual-report.json`,constants.COPYFILE_EXCL);
  if(phase==='before')await writeFile(lockPath,JSON.stringify({createdAt:report.capturedAt,requestedFrames:frames,renderSettings,light:report.light,views:report.views.map(({id,camera,target,sunTarget})=>({id,camera,target,sunTarget})),sourceHashes:sourceBefore},null,2),{flag:'wx'});
  console.log(`Saved immutable ${phase}: ${directory}/${phase}/visual-report.json`);
}catch(error){
  report.status='failed';report.error=String(error);await writeFile(`${attempt}/failure-report.json`,JSON.stringify(report,null,2));console.error(report.error);process.exitCode=1;
}finally{
  if(browser)await browser.close();
}

async function checkReview(){
  const result={status:'running',checkedAt:new Date().toISOString(),checks:[],errors:[],modes:[],screenshots:[]};
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const context=await browser.newContext({viewport:{width:1600,height:1200},deviceScaleFactor:1});
    await authenticateContext(context,base);
    const page=await context.newPage();
    page.on('pageerror',error=>result.errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')result.errors.push(`${message.text()} ${message.location().url}`);});
    await page.goto(`${base}/${directory}/review.html`,{waitUntil:'networkidle'});
    await page.waitForFunction(()=>window.cdsFullReview?.ready);
    expect(await page.evaluate(()=>({mode:window.cdsFullReview.mode,view:window.cdsFullReview.view}))).toEqual({mode:'after',view:'22-cds-full-south'});
    result.checks.push('Default shows only the updated complete south view, with matching after label.');
    const views=await page.evaluate(()=>window.cdsFullReview.views);
    for(const view of views)for(const mode of ['before','after','pair']){
      await page.locator(`[data-view="${view}"]`).click();
      await page.locator(`[data-mode="${mode}"]`).click();
      await page.waitForFunction(({view,mode})=>window.cdsFullReview?.ready&&window.cdsFullReview.view===view&&window.cdsFullReview.mode===mode,{view,mode});
      await expect(page.locator(`[data-view="${view}"]`)).toHaveAttribute('aria-pressed','true');
      await expect(page.locator(`[data-mode="${mode}"]`)).toHaveAttribute('aria-pressed','true');
      const figures=await page.locator('figure').evaluateAll(nodes=>nodes.map(node=>{const image=node.querySelector('img');return{side:node.dataset.side,visible:!node.hidden,label:node.querySelector('figcaption').textContent,width:image.naturalWidth,height:image.naturalHeight,complete:image.complete,src:image.getAttribute('src')};}));
      expect(figures.filter(f=>f.visible).map(f=>f.side)).toEqual(mode==='pair'?['before','after']:[mode]);
      for(const figure of figures){expect(figure.width).toBe(1600);expect(figure.height).toBe(1000);expect(figure.complete).toBe(true);expect(figure.src).toBe(`./${figure.side}/${view}.png`);expect(figure.label).toContain(figure.side==='before'?'替换前':'替换后');}
      result.modes.push({view,mode,figures});
    }
    result.checks.push('All five viewpoints × three modes show only correctly labeled complete images; both images are shown only in pair mode.');
    await page.locator('[data-view="22-cds-full-south"]').click();await page.locator('[data-mode="after"]').click();await page.waitForFunction(()=>window.cdsFullReview.ready);
    await page.screenshot({path:`${directory}/review-desktop.png`,fullPage:true});result.screenshots.push('review-desktop.png');
    await page.locator('[data-mode="pair"]').click();await page.waitForFunction(()=>window.cdsFullReview.ready);
    const desktopBoxes=await page.locator('figure').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};}));
    expect(desktopBoxes[0].x).toBeLessThan(desktopBoxes[1].x);expect(desktopBoxes[0].y).toBe(desktopBoxes[1].y);
    await page.screenshot({path:`${directory}/review-pair-desktop.png`,fullPage:true});result.screenshots.push('review-pair-desktop.png');
    await page.setViewportSize({width:390,height:844});
    const mobile=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,figures:[...document.querySelectorAll('figure')].map(node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};})}));
    expect(mobile.scrollWidth).toBeLessThanOrEqual(mobile.width);expect(mobile.figures[1].y).toBeGreaterThanOrEqual(mobile.figures[0].y+mobile.figures[0].height);expect(mobile.figures[0].x).toBe(mobile.figures[1].x);
    await page.screenshot({path:`${directory}/review-mobile.png`,fullPage:true});result.screenshots.push('review-mobile.png');
    result.checks.push('Desktop pair is left-before/right-after; phone pair stacks before above after without horizontal overflow.');
    await page.locator('#campus-link').click();await page.waitForURL(url=>url.pathname==='/');
    await page.goBack({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.cdsFullReview?.ready);
    await page.locator('[data-mode="before"]').click();await page.waitForFunction(()=>window.cdsFullReview?.ready&&window.cdsFullReview.mode==='before');
    await expect(page.locator('[data-side="before"]')).toBeVisible();await expect(page.locator('[data-side="after"]')).toBeHidden();
    result.checks.push('Campus link opens the local game root; browser Back returns to a working comparison page.');
    expect(result.errors).toEqual([]);result.checks.push('No browser console or page errors.');result.status='passed';
  }catch(error){result.status='failed';result.error=String(error);process.exitCode=1;throw error;}
  finally{await writeFile(`${directory}/review-check.json`,JSON.stringify(result,null,2));await browser.close();console.log(JSON.stringify({status:result.status,checks:result.checks.length,modeChecks:result.modes.length,errors:result.errors}));}
}
