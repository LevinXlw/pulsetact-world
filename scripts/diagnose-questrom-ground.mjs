import {constants} from 'node:fs';
import {copyFile,mkdir,readFile,stat,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,expect} from '@playwright/test';
import {authenticateContext} from './test-auth.mjs';

// Run before any runtime replacement, then reuse the immutable camera lock:
//   node scripts/capture-questrom-full.mjs --phase=before
//   node scripts/capture-questrom-full.mjs --phase=after
//   node scripts/capture-questrom-full.mjs --check-review
// A completed phase is never overwritten. Failed attempts stay in attempts/.
const directory='output/questrom-full-20261019/diagnostics/original-ground';
const phase='after';
if(!['before','after'].includes(phase))throw Error('Use --phase=before or --phase=after.');
const base=process.env.WORLD_BASE_URL||'http://127.0.0.1:5186';
if(process.argv.includes('--check-review')){await checkReview();process.exit(0);}
const lockPath='output/questrom-full-20261019/camera-lock.json';
const point=([x,h,z])=>[-627.4573827557324+x*Math.cos(-.145)+z*Math.sin(-.145),h,1062.433554652147-x*Math.sin(-.145)+z*Math.cos(-.145)];
const frames=[
 {id:'01-questrom-front',eye:point([12,70,125]),target:point([0,23,0]),fov:52,fullHeight:true,inspect:'Complete street facade, entrance, roof and both side edges.'},
 {id:'02-questrom-entry',eye:point([8,1.75,36]),target:point([7,3.5,20]),fov:64,inspect:'Entrance inscription, columns, doors and ground junction.'},
 {id:'03-questrom-recess',eye:point([43,18,31]),target:point([35,17,16]),fov:58,inspect:'East side recessed windows and stone reveals.'},
 {id:'04-questrom-street',eye:point([-80,25,90]),target:point([0,20,0]),fov:57,inspect:'Commonwealth Avenue, entrance and campus context.'},
 {id:'05-questrom-roof',eye:point([30,75,-118]),target:point([0,23,0]),fov:55,fullHeight:true,inspect:'Rear facade, terraces and complete roof envelope.'},
];
const renderSettings={width:1600,height:1000,pixelRatio:1,antialias:true,near:.12,far:4200,toneMapping:'ACESFilmicToneMapping',exposure:1,background:'#c5d9d5',fog:[180,2600],shadowMapSize:4096,shadowCamera:{left:-95,right:95,top:95,bottom:-95,near:1,far:390},shadowBias:-.00008,shadowNormalBias:.035,shadowRadius:3,simulationDelta:0};
const sourcePaths=['src/features/world/scene-assets.ts','src/features/world/scene-assets-desktop.ts','src/features/world/boston-university.ts','src/features/world/bu-landmark-layout.ts','src/features/world/campus-daylight.ts'];
if(phase==='after')sourcePaths.push('src/features/world/bu-questrom-asset.ts','src/features/world/bu-refined-building-asset.ts','public/assets/bu-questrom/questrom-full.glb','public/assets/bu-questrom/manifest.json');
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
  await page.route('**/questrom-full-capture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><title>Questrom complete campus capture</title></head><body style="margin:0"></body></html>'}));
  await page.goto(`${base}/questrom-full-capture`);
  const initialized=await page.evaluate(async({settings,lockedLight,phase})=>{
    const THREE=await import('/node_modules/three/build/three.module.js');
    const {loadWorldAssets}=await import('/src/features/world/scene-assets.ts');
    const {buElevation}=await import('/src/features/world/bu-terrain.ts');
    const {BU_FULL_BUILDINGS}=await import('/src/features/world/bu-full-layout.ts');
    const {BU_BUILDING_ANCHORS}=await import('/src/features/world/charles-geography.ts');
    const {BOSTON_DAYLIGHT}=await import('/src/features/world/campus-daylight.ts');
    if(lockedLight&&JSON.stringify(lockedLight)!==JSON.stringify(BOSTON_DAYLIGHT))throw Error('Boston daylight changed since the before capture.');
    const light=lockedLight??BOSTON_DAYLIGHT,assets=await loadWorldAssets(new AbortController().signal,'boston',false);
    assets.wind.value=0;assets.setQuality(false);
    const oldQuestrom=[],refinedQuestrom=[],inscriptions=[];
    assets.model.traverse(object=>{if(object.isGroup&&object.name==='BU Questrom · replaceable visual')oldQuestrom.push(object);if(object.userData.questromRefined===true)refinedQuestrom.push(object);});
    assets.model.traverseVisible(object=>{if(object.name==='Questrom entrance inscription')inscriptions.push(object);});
    assets.model.updateMatrixWorld(true);
    const retained=[];for(const mesh of [...oldQuestrom[0].children])if(mesh.isMesh&&mesh.name.startsWith('BU ground')){oldQuestrom[0].parent.attach(mesh);mesh.visible=true;retained.push(mesh.name);}
    const hidden=[];refinedQuestrom[0].traverse(mesh=>{if(mesh.isMesh&&(mesh.userData.ground||mesh.userData.buGround||mesh.name.startsWith('BU ground'))){mesh.visible=false;hidden.push(mesh.name);}});
    if(retained.length!==4||hidden.length!==4)throw Error('Expected exactly four old/new ground surfaces: '+JSON.stringify({retained,hidden}));
    const visibleMeshes=o=>{let count=0;o.traverseVisible(child=>{if(child.isMesh)count++;});return count;};
    const replacement={...assets.model.userData.questromReplacement,oldVisuals:oldQuestrom.map(o=>({name:o.name,visible:o.visible,visibleMeshes:visibleMeshes(o)})),refinedVisuals:refinedQuestrom.map(o=>({name:o.name,visible:o.visible,visibleMeshes:visibleMeshes(o)})),visibleInscriptions:inscriptions.length};
    if(inscriptions.length!==1)throw Error('The separate entrance inscription is missing or duplicated.');
    if(phase==='after'&&(replacement.status!=='loaded'||oldQuestrom.length!==1||replacement.oldVisuals.some(o=>o.visible||o.visibleMeshes!==0)||refinedQuestrom.length!==1||!refinedQuestrom[0].visible||replacement.refinedVisuals[0].visibleMeshes===0))throw Error(`Questrom replacement is not active: ${JSON.stringify(replacement)}`);
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
    const volumes=[...BU_FULL_BUILDINGS];
    const anchor=BU_BUILDING_ANCHORS.questrom,baseY=buElevation(...anchor),yaw=-.145;
    const towerPoints=[];for(const x of [-48,48])for(const z of [-20.32,24.6])for(const y of [baseY,baseY+50.51])towerPoints.push(new THREE.Vector3(anchor[0]+x*Math.cos(yaw)+z*Math.sin(yaw),y,anchor[1]-x*Math.sin(yaw)+z*Math.cos(yaw)));
    window.questromCapture={THREE,assets,scene,renderer,camera,sun,buElevation,light,inside,volumes,towerPoints,refinedQuestrom,oldQuestrom};
    return{light,invalidGeometry,replacement};
  },{settings:renderSettings,lockedLight:lock?.light,phase});
  report.light=initialized.light;report.geometryIssues=initialized.invalidGeometry;report.questromReplacement=initialized.replacement;
  await page.waitForFunction(()=>{let ready=true;window.questromCapture.assets.model.traverse(o=>{const m=o.material;if(m?.uniforms?.uSkyReady&&m.uniforms.uSkyReady.value!==1)ready=false;});return ready;},{},{timeout:30000});
  if(report.geometryIssues.length)throw Error('Non-finite scene geometry; see attempt report.');
  for(const frame of frames.filter(frame=>frame.id==='01-questrom-front')){
    const locked=lock?.views.find(view=>view.id===frame.id);
    const result=await page.evaluate(async({frame,locked,phase,warmup})=>{
      const {THREE,assets,scene,renderer,camera,sun,buElevation,light,inside,volumes,towerPoints,refinedQuestrom,oldQuestrom}=window.questromCapture;
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
      const questromEnvironmentReady=refinedQuestrom[0]?.userData.questromEnvironmentReady??false;
      if(phase==='after'&&(!questromEnvironmentReady||oldQuestrom.some(o=>o.visible)||!refinedQuestrom[0]?.visible))throw Error('Questrom replacement/reflection was not ready after rendering.');
      const forward=new THREE.Vector3();camera.getWorldDirection(forward);
      const collisionDirections=[forward,new THREE.Vector3(1,0,0),new THREE.Vector3(-1,0,0),new THREE.Vector3(0,0,1),new THREE.Vector3(0,0,-1),new THREE.Vector3(0,1,0),new THREE.Vector3(0,-1,0)];
      const nearby=collisionDirections.map(direction=>assets.collision.distance(camera.position,direction,1)??null);
      const cameraInside=volumes.filter(b=>b.footprint?.length&&b.height>0&&eye[1]>=buElevation(b.x,b.z)-.1&&eye[1]<buElevation(b.x,b.z)+b.height+.1&&inside([eye[0],eye[2]],b.footprint)&&!b.holes?.some(ring=>inside([eye[0],eye[2]],ring))).map(b=>b.id);
      const projection=towerPoints.map(point=>point.clone().project(camera).toArray());
      const fullTowerInFrame=projection.every(([px,py,pz])=>Math.abs(px)<.97&&Math.abs(py)<.97&&pz>-1&&pz<1);
      return{png:renderer.domElement.toDataURL('image/png'),camera:eye,target,sunTarget,terrain,groundHeight:ground??null,nearObstacleDistances:nearby,cameraInside,fullTowerInFrame,questromEnvironmentReady,renderWarmupFrames:warmup?1:0,towerProjectionBounds:{min:[0,1,2].map(i=>Math.min(...projection.map(p=>p[i]))),max:[0,1,2].map(i=>Math.max(...projection.map(p=>p[i])))},render:{calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,programs:renderer.info.programs?.length??0},memory:performance.memory?{usedJSHeapBytes:performance.memory.usedJSHeapSize,totalJSHeapBytes:performance.memory.totalJSHeapSize}:null};
    },{frame,locked,phase,warmup:phase==='after'&&report.views.length===0});
    const png=Buffer.from(result.png.split(',')[1],'base64');await writeFile(`${attempt}/${frame.id}.png`,png,{flag:'wx'});
    const {png:ignored,...stats}=result;report.views.push({...frame,...stats,pngSHA256:hash(png)});
    console.log(JSON.stringify({phase,view:frame.id,render:stats.render,cameraInside:stats.cameraInside,fullTowerInFrame:stats.fullTowerInFrame}));
    if(stats.cameraInside.length||stats.nearObstacleDistances.some(value=>value!==null))throw Error(`Camera collision in ${frame.id}.`);
    if(frame.fullHeight&&!stats.fullTowerInFrame)throw Error(`The complete building does not fit ${frame.id}; fix before locking the baseline.`);
  }
  if(report.errors.length)throw Error(report.errors.join('\n'));
  if(JSON.stringify(sourceBefore)!==JSON.stringify(await sourceHashes()))throw Error('Runtime source changed during capture; do not publish a mixed baseline.');
  report.checks=['Loaded the actual desktop Boston world through loadWorldAssets, including the surrounding campus.','Boston game daylight, fog, exposure and static simulation shared by every phase.','All cameras clear source building volumes and one-metre collision probes.','Both full-height cameras include the complete building envelope.','Finite vertices and no browser console/page errors.'];
  if(lock)report.checks.push('World camera, target, sun target and rendering settings exactly reused from immutable before camera-lock.');
  if(phase==='after')report.checks.push('Complete Questrom GLB loaded, the old Questrom visual group hidden, one refined exterior visible, and neighborhood reflection ready in every captured view.');
  
  report.status='passed';
  await writeFile(`${attempt}/visual-report.json`,JSON.stringify(report,null,2),{flag:'wx'});
  await mkdir(`${directory}/${phase}`,{recursive:true});
  for(const frame of frames.filter(frame=>frame.id==='01-questrom-front'))await copyFile(`${attempt}/${frame.id}.png`,`${directory}/${phase}/${frame.id}.png`,constants.COPYFILE_EXCL);
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
    await page.waitForFunction(()=>window.questromFullReview?.ready);
    expect(await page.evaluate(()=>({mode:window.questromFullReview.mode,view:window.questromFullReview.view}))).toEqual({mode:'after',view:'01-questrom-front'});
    result.checks.push('Default shows only the updated complete front view, with matching after label.');
    const views=await page.evaluate(()=>window.questromFullReview.views);
    for(const view of views)for(const mode of ['before','after','pair']){
      await page.locator(`[data-view="${view}"]`).click();
      await page.locator(`[data-mode="${mode}"]`).click();
      await page.waitForFunction(({view,mode})=>window.questromFullReview?.ready&&window.questromFullReview.view===view&&window.questromFullReview.mode===mode,{view,mode});
      await expect(page.locator(`[data-view="${view}"]`)).toHaveAttribute('aria-pressed','true');
      await expect(page.locator(`[data-mode="${mode}"]`)).toHaveAttribute('aria-pressed','true');
      const figures=await page.locator('figure').evaluateAll(nodes=>nodes.map(node=>{const image=node.querySelector('img');return{side:node.dataset.side,visible:!node.hidden,label:node.querySelector('figcaption').textContent,width:image.naturalWidth,height:image.naturalHeight,complete:image.complete,src:image.getAttribute('src')};}));
      expect(figures.filter(f=>f.visible).map(f=>f.side)).toEqual(mode==='pair'?['before','after']:[mode]);
      for(const figure of figures){expect(figure.width).toBe(1600);expect(figure.height).toBe(1000);expect(figure.complete).toBe(true);expect(figure.src).toBe(`./${figure.side}/${view}.png`);expect(figure.label).toContain(figure.side==='before'?'替换前':'替换后');}
      result.modes.push({view,mode,figures});
    }
    result.checks.push('All five viewpoints × three modes show only correctly labeled complete images; both images are shown only in pair mode.');
    await page.locator('[data-view="01-questrom-front"]').click();await page.locator('[data-mode="after"]').click();await page.waitForFunction(()=>window.questromFullReview.ready);
    await page.screenshot({path:`${directory}/review-desktop.png`,fullPage:true});result.screenshots.push('review-desktop.png');
    await page.locator('[data-mode="pair"]').click();await page.waitForFunction(()=>window.questromFullReview.ready);
    const desktopBoxes=await page.locator('figure').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};}));
    expect(desktopBoxes[0].x).toBeLessThan(desktopBoxes[1].x);expect(desktopBoxes[0].y).toBe(desktopBoxes[1].y);
    await page.screenshot({path:`${directory}/review-pair-desktop.png`,fullPage:true});result.screenshots.push('review-pair-desktop.png');
    await page.setViewportSize({width:390,height:844});
    const mobile=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,figures:[...document.querySelectorAll('figure')].map(node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};})}));
    expect(mobile.scrollWidth).toBeLessThanOrEqual(mobile.width);expect(mobile.figures[1].y).toBeGreaterThanOrEqual(mobile.figures[0].y+mobile.figures[0].height);expect(mobile.figures[0].x).toBe(mobile.figures[1].x);
    await page.screenshot({path:`${directory}/review-mobile.png`,fullPage:true});result.screenshots.push('review-mobile.png');
    result.checks.push('Desktop pair is left-before/right-after; phone pair stacks before above after without horizontal overflow.');
    await page.locator('#campus-link').click();await page.waitForURL(url=>url.pathname==='/');
    await page.goBack({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.questromFullReview?.ready);
    await page.locator('[data-mode="before"]').click();await page.waitForFunction(()=>window.questromFullReview?.ready&&window.questromFullReview.mode==='before');
    await expect(page.locator('[data-side="before"]')).toBeVisible();await expect(page.locator('[data-side="after"]')).toBeHidden();
    result.checks.push('Campus link opens the local game root; browser Back returns to a working comparison page.');
    expect(result.errors).toEqual([]);result.checks.push('No browser console or page errors.');result.status='passed';
  }catch(error){result.status='failed';result.error=String(error);process.exitCode=1;throw error;}
  finally{await writeFile(`${directory}/review-check.json`,JSON.stringify(result,null,2));await browser.close();console.log(JSON.stringify({status:result.status,checks:result.checks.length,modeChecks:result.modes.length,errors:result.errors}));}
}

