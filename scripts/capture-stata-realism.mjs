import {constants} from 'node:fs';
import {copyFile,mkdir,readFile,stat,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,expect} from '@playwright/test';
import {authenticateContext} from './test-auth.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

// The before phase is immutable. Use --probe to assess cameras without locking.
// Pass-2 baseline is initialized by output/stata-realism-20261022/preserve-baseline.mjs.
// node scripts/capture-stata-realism.mjs --phase=after
// node scripts/capture-stata-realism.mjs --phase=before --reference-view --probe
// node scripts/capture-stata-realism.mjs --phase=before --reference-view
// node scripts/capture-stata-realism.mjs --phase=after --reference-view
// node scripts/capture-stata-realism.mjs --check-review
const directory=process.argv.find(value=>value.startsWith('--output='))?.slice(9)??'output/stata-realism-20261022';
const phase=process.argv.find(value=>value.startsWith('--phase='))?.slice(8)??'before';
const referenceView=process.argv.includes('--reference-view');
const diagnoseShadows=process.argv.includes('--diagnose-shadows');
const detailsOnly=process.argv.includes('--details'),explicitProbe=process.argv.includes('--probe');
const probe=explicitProbe||diagnoseShadows||detailsOnly||referenceView;
const draft=process.argv.includes('--draft'),replaceAfter=process.argv.includes('--replace-after');
const base=process.env.WORLD_BASE_URL||'http://127.0.0.1:5186';
if(process.argv.includes('--check-review')){await checkReview();process.exit(0);}
if(!['before','after'].includes(phase))throw Error('Use --phase=before or --phase=after.');
if(detailsOnly&&phase!=='after')throw Error('Detail views are after-only and require --phase=after.');
const lockPath=referenceView?`${directory}/reference-view/camera-lock.json`:`${directory}/camera-lock.json`;
const frames=[
  {id:'01-vassar-northeast',title:'Vassar · 东北方向',eye:[160,32,-355],target:[110,18,-275],fov:78,inspect:'Vassar frontage from the northeast, including tilted volumes and the Gates end.'},
  {id:'02-vassar-northwest',title:'Vassar · 西北方向',eye:[15,32,-310],target:[105,18,-275],fov:76,inspect:'Vassar frontage from the northwest, including the Dreyfoos end and street-level base.'},
  {id:'03-whole-building',title:'整楼 · 斜俯视',eye:[195,118,-420],target:[114.246,17,-275.197],fov:56,fullHeight:true,inspect:'Complete roof-to-ground building envelope and its surrounding campus.'},
  {id:'04-rear-courtyard',title:'后侧 · 庭院',eye:[110,35,-165],target:[114.246,18,-275.197],fov:68,inspect:'Rear courtyard, low connecting wings and the back of the tower group.'},
];
const detailFrames=[
  {id:'05-entrance-detail',title:'替换后独立近景 · 西侧门区',eye:[50,1.75,-310],target:[59,5.5,-293],fov:64,inspect:'After-only street-level look at the authored entrance region, folded canopy and ground junction; no same-camera baseline.'},
  {id:'06-window-detail',title:'替换后独立近景 · 斜向窗框',eye:[145,9,-340],target:[129,13,-324],fov:54,inspect:'After-only oblique look at façade depth, recessed glazing and projecting frames; no same-camera baseline.'},
];
const referenceFrames=[{id:'07-official-photo-angle',title:'官方照片方向 · 1.7 米视高',eye:[166,1.7,-361],target:[125,20,-309],fov:72,eyeHeightFromGround:true,inspect:'Street-height composition toward the MIT List official photograph facade. Game before/after share exact camera values; photographic viewpoint and lens are not measured and are not claimed to be pixel-aligned.'}];
const captureFrames=referenceView?referenceFrames:detailsOnly?detailFrames:frames;
const renderSettings={width:1600,height:1000,pixelRatio:1,antialias:true,near:.12,far:4200,toneMapping:'ACESFilmicToneMapping',exposure:1,background:'#c5d9d5',fog:[180,2600],shadowMapSize:4096,shadowCamera:{left:-110,right:110,top:110,bottom:-110,near:1,far:390},shadowBias:-.00008,shadowNormalBias:.035,shadowRadius:3,simulationDelta:0};
const sourcePaths=['src/features/world/scene-assets.ts','src/features/world/scene-assets-desktop.ts','src/features/world/painterly-surfaces.ts','src/features/world/campus-daylight.ts','public/data/campuses/mit/campus.glb'];
sourcePaths.push('src/features/world/mit-stata-asset.ts','src/features/world/bu-refined-building-asset.ts','public/assets/mit-stata/campus-without-stata.glb','public/assets/mit-stata/boston-without-stata.glb','public/assets/mit-stata/stata-full.glb','public/assets/mit-stata/stata-mobile.glb','public/assets/mit-stata/manifest.json');
async function exists(path){try{await stat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
const baselineReport=JSON.parse(await readFile(`${directory}/baseline/provenance/prior-after-visual-report.json`,'utf8'));
async function sourceHashes(){return Object.fromEntries(await Promise.all(sourcePaths.map(async path=>{
  const isArchivedAsset=phase==='before'&&path.startsWith('public/assets/mit-stata/');
  const actual=hash(await readFile(isArchivedAsset?`${directory}/baseline/files/${path}`:path));
  if(phase==='before'&&actual!==baselineReport.sourceHashes[path])throw Error(`Baseline source differs: ${path}. Old-asset capture must not use modified runtime source.`);
  return[path,actual];
})));}
if(replaceAfter&&phase!=='after')throw Error('--replace-after only permits replacing the after phase.');
if(!probe&&await exists(`${directory}/${phase}/visual-report.json`)&&!replaceAfter)throw Error(`Refusing to overwrite completed ${phase} capture; use --replace-after for a new after revision.`);
if(!probe&&phase==='before'&&await exists(lockPath))throw Error('A before camera lock already exists; the baseline is immutable.');
if(referenceView&&phase==='before'&&!explicitProbe&&await exists(lockPath))throw Error('The reference-view before camera is already immutable.');
const lock=phase==='after'?JSON.parse(await readFile(lockPath,'utf8')):null;
if(lock&&JSON.stringify(lock.requestedFrames)!==JSON.stringify(referenceView?referenceFrames:frames))throw Error('Camera definitions changed since the baseline.');
if(lock&&JSON.stringify(lock.renderSettings)!==JSON.stringify(renderSettings))throw Error('Render settings changed since the baseline.');
const sourceBefore=await sourceHashes();
const attempt=`${directory}/attempts/${probe?'probe':phase}-${new Date().toISOString().replace(/[:.]/g,'-')}`;
await mkdir(attempt,{recursive:true});
const report={phase,probe,draft,detailsOnly,referenceView,comparisonPass:2,comparisonRole:referenceView?'Independent 1.7 m reference-photo composition, with identical game before/after camera. The source photograph is not pixel-registered.':detailsOnly?'After-only detail photographs; these cameras have no before baseline.':'Four immutable pass-2 comparison cameras.',base,capturedAt:new Date().toISOString(),renderSettings,sourceHashes:sourceBefore,errors:[],warnings:[],geometryIssues:[],views:[],checks:[],status:'running'};
let browser;
try{
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
  const context=await browser.newContext({viewport:{width:renderSettings.width,height:renderSettings.height},deviceScaleFactor:1});
  await authenticateContext(context,base);
  if(phase==='before')await context.route('**/assets/mit-stata/**',async route=>{
    const pathname=new URL(route.request().url()).pathname;
    if(!pathname.endsWith('.glb'))return route.continue();
    const snapshot=`${directory}/baseline/files/public${pathname}`;
    if(!await exists(snapshot))throw Error(`Missing immutable baseline asset: ${pathname}`);
    await route.fulfill({path:snapshot,contentType:'model/gltf-binary'});
  });
  const page=await context.newPage();page.setDefaultTimeout(120000);
  page.on('pageerror',error=>report.errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());if(message.type()==='warning')report.warnings.push(message.text());});
  await page.route('**/stata-realism-capture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><title>Stata exterior refinement capture</title><link rel="icon" href="data:,"></head><body style="margin:0"></body></html>'}));
  await page.goto(`${base}/stata-realism-capture`);
  const initialized=await page.evaluate(async({settings,lockedLight,phase})=>{
    const THREE=await import('/node_modules/three/build/three.module.js');
    const {loadWorldAssets}=await import('/src/features/world/scene-assets.ts');
    const {BOSTON_DAYLIGHT}=await import('/src/features/world/campus-daylight.ts');
    if(lockedLight&&JSON.stringify(lockedLight)!==JSON.stringify(BOSTON_DAYLIGHT))throw Error('Boston daylight changed since the before capture.');
    const light=lockedLight??BOSTON_DAYLIGHT,start=performance.now();
    const assets=await loadWorldAssets(new AbortController().signal,'boston',false);
    const loadMilliseconds=performance.now()-start;
    assets.wind.value=0;assets.setQuality(false);
    const refined=[];assets.model.traverse(o=>{if(o.userData.stataRefined===true)refined.push(o);});
    const replacement={...assets.model.userData.stataReplacement,refinedGroups:refined.map(o=>{let meshCount=0,triangleCount=0,visibleMeshCount=0,visibleTriangleCount=0;const count=child=>(child.geometry.index?.count??child.geometry.getAttribute('position').count)/3;o.traverse(child=>{if(child.isMesh){meshCount++;triangleCount+=count(child);}});o.traverseVisible(child=>{if(child.isMesh){visibleMeshCount++;visibleTriangleCount+=count(child);}});return{name:o.name,visible:o.visible,meshCount,triangleCount,visibleMeshCount,visibleTriangleCount};})};
    if(replacement.status!=='loaded'||refined.length!==1||!refined[0].visible)throw Error(`Stata replacement not active: ${JSON.stringify(replacement)}`);
    const scene=new THREE.Scene();scene.background=new THREE.Color(settings.background);scene.fog=new THREE.Fog(settings.background,...settings.fog);
    scene.add(assets.model,new THREE.HemisphereLight(light.sky,light.ground,light.ambient));
    const sun=new THREE.DirectionalLight(light.sun,light.intensity);sun.castShadow=true;sun.shadow.mapSize.set(settings.shadowMapSize,settings.shadowMapSize);Object.assign(sun.shadow.camera,settings.shadowCamera);sun.shadow.bias=settings.shadowBias;sun.shadow.normalBias=settings.shadowNormalBias;sun.shadow.radius=settings.shadowRadius;scene.add(sun,sun.target);
    const renderer=new THREE.WebGLRenderer({antialias:settings.antialias,preserveDrawingBuffer:true});renderer.setPixelRatio(settings.pixelRatio);renderer.setSize(settings.width,settings.height);renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=settings.exposure;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;document.body.appendChild(renderer.domElement);
    const camera=new THREE.PerspectiveCamera(52,settings.width/settings.height,settings.near,settings.far),invalidGeometry=[];
    assets.model.traverse(object=>{if(!object.isMesh)return;const position=object.geometry.getAttribute('position');if(!position)return;for(let i=0;i<position.count;i++)if(![position.getX(i),position.getY(i),position.getZ(i)].every(Number.isFinite)){invalidGeometry.push({mesh:object.name,vertex:i});break;}});
    const groundSamples=[[114.246,-275.197],[100,-345],[190,-300],[40,-300],[110,-200]].map(([x,z])=>({x,z,height:assets.collision.groundHeight(x,z)??null}));
    const groundBase=groundSamples.filter(s=>s.height!==null).sort((a,b)=>a.height-b.height)[0]?.height??5.2;
    const envelope=[];for(const x of [48,180])for(const z of [-330,-220])for(const y of [groundBase,43])envelope.push(new THREE.Vector3(x,y,z));
    window.stataCapture={THREE,assets,scene,renderer,camera,sun,light,envelope,groundBase,refined};
    return{light,invalidGeometry,replacement,groundSamples,groundBase,loadMilliseconds};
  },{settings:renderSettings,lockedLight:lock?.light,phase});
  Object.assign(report,{light:initialized.light,geometryIssues:initialized.invalidGeometry,stataReplacement:initialized.replacement,groundSamples:initialized.groundSamples,groundBase:initialized.groundBase,loadMilliseconds:initialized.loadMilliseconds});
  await page.waitForFunction(()=>{let ready=true;window.stataCapture.assets.model.traverse(o=>{const m=o.material;if(m?.uniforms?.uSkyReady&&m.uniforms.uSkyReady.value!==1)ready=false;});return ready;},{},{timeout:30000});
  if(report.geometryIssues.length)throw Error('Non-finite scene geometry.');
  for(const frame of captureFrames){
    const locked=lock?.views.find(view=>view.id===frame.id);
    const result=await page.evaluate(async({frame,locked,phase,diagnoseShadows})=>{
      const {THREE,assets,scene,renderer,camera,sun,light,envelope,groundBase,refined}=window.stataCapture;
      const [x,h,z]=frame.eye,[tx,th,tz]=frame.target,ground=assets.collision.groundHeight(x,z);
      const eye=locked?.camera??[x,(frame.eyeHeightFromGround?(ground??groundBase):groundBase)+h,z],target=locked?.target??[tx,groundBase+th,tz];
      camera.fov=frame.fov;camera.updateProjectionMatrix();camera.position.fromArray(eye);camera.lookAt(...target);camera.updateMatrixWorld();
      const sunTarget=locked?.sunTarget??[114.246,groundBase,-275.197];sun.target.position.fromArray(sunTarget);sun.position.copy(sun.target.position).add(new THREE.Vector3(...light.offset));sun.target.updateMatrixWorld();
      assets.update(camera.position,0);assets.model.updateMatrixWorld(true);
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      renderer.render(scene,camera);await new Promise(resolve=>requestAnimationFrame(resolve));renderer.render(scene,camera);
      const timings=[];for(let i=0;i<5;i++){const t=performance.now();renderer.render(scene,camera);renderer.getContext().finish();timings.push(performance.now()-t);}
      const forward=new THREE.Vector3();camera.getWorldDirection(forward);
      const directions=[forward,new THREE.Vector3(1,0,0),new THREE.Vector3(-1,0,0),new THREE.Vector3(0,0,1),new THREE.Vector3(0,0,-1),new THREE.Vector3(0,1,0),new THREE.Vector3(0,-1,0)];
      const nearby=directions.map(direction=>assets.collision.distance(camera.position,direction,1)??null);
      const projection=envelope.map(point=>point.clone().project(camera).toArray()),fullBuildingInFrame=projection.every(([px,py,pz])=>Math.abs(px)<.98&&Math.abs(py)<.98&&pz>-1&&pz<1);
      const stataEnvironmentReady=refined[0]?.userData.stataEnvironmentReady??false,glassMaterials=new Map();refined[0]?.traverseVisible(object=>{if(!object.isMesh)return;for(const material of Array.isArray(object.material)?object.material:[object.material])if(/glass/i.test(material.name))glassMaterials.set(material.uuid,{name:material.name,environmentReady:!!material.envMap,environmentName:material.envMap?.name??null,environmentIntensity:material.envMapIntensity,roughness:material.roughness,metalness:material.metalness});});
      if(!stataEnvironmentReady||glassMaterials.size===0||[...glassMaterials.values()].some(m=>!m.environmentReady))throw Error('Stata glass neighborhood reflection is not ready.');
      const collisionOnly=[];refined[0]?.traverse(object=>{if(object.isMesh&&object.userData.stataCollisionOnly)collisionOnly.push({name:object.name,visible:object.visible,castShadow:object.castShadow,receiveShadow:object.receiveShadow,triangles:(object.geometry.index?.count??object.geometry.getAttribute('position').count)/3});});
      const png=renderer.domElement.toDataURL('image/png'),render={calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,programs:renderer.info.programs?.length??0,frameMilliseconds:timings,medianFrameMilliseconds:[...timings].sort((a,b)=>a-b)[2]};
      let shadowDiagnostics=null;
      if(diagnoseShadows&&frame.id==='03-whole-building'){
        const roofs=[];refined[0].traverseVisible(object=>{if(object.isMesh&&(/roof/i.test(object.name)||(Array.isArray(object.material)?object.material:[object.material]).some(m=>/roof/i.test(m.name))))roofs.push(object);});
        const roofStats=roofs.map(object=>{const normals=object.geometry.getAttribute('normal'),normalMatrix=new THREE.Matrix3().getNormalMatrix(object.matrixWorld),v=new THREE.Vector3();let minimumY=Infinity,maximumY=-Infinity,sumY=0,up=0,down=0;for(let i=0;i<normals.count;i++){v.fromBufferAttribute(normals,i).applyNormalMatrix(normalMatrix);minimumY=Math.min(minimumY,v.y);maximumY=Math.max(maximumY,v.y);sumY+=v.y;if(v.y>.99)up++;if(v.y<-.99)down++;}return{name:object.name,visible:object.visible,castShadow:object.castShadow,receiveShadow:object.receiveShadow,normalCount:normals.count,minimumY,maximumY,meanY:sumY/normals.count,upYAbovePoint99:up,downYBelowMinusPoint99:down,materials:(Array.isArray(object.material)?object.material:[object.material]).map(m=>({name:m.name,normalMap:!!m.normalMap,normalScale:m.normalScale?.toArray(),side:m.side}))};});
        const originalEnabled=renderer.shadowMap.enabled,originalSunCast=sun.castShadow;renderer.shadowMap.enabled=false;sun.castShadow=false;scene.traverse(object=>{if(object.isMesh)for(const material of Array.isArray(object.material)?object.material:[object.material])material.needsUpdate=true;});renderer.render(scene,camera);const noShadowsPNG=renderer.domElement.toDataURL('image/png');renderer.shadowMap.enabled=originalEnabled;sun.castShadow=originalSunCast;scene.traverse(object=>{if(object.isMesh)for(const material of Array.isArray(object.material)?object.material:[object.material])material.needsUpdate=true;});
        const oldReceive=roofs.map(object=>object.receiveShadow);roofs.forEach(object=>object.receiveShadow=false);renderer.render(scene,camera);const roofNoReceivePNG=renderer.domElement.toDataURL('image/png');roofs.forEach((object,index)=>object.receiveShadow=oldReceive[index]);renderer.render(scene,camera);
        const maps=[];refined[0].traverseVisible(object=>{if(object.isMesh)for(const m of Array.isArray(object.material)?object.material:[object.material])if(/^(silver|mirror|frame|zinc|gold|roof)/i.test(m.name)&&!maps.some(entry=>entry.m===m)){maps.push({m,normalMap:m.normalMap,roughnessMap:m.roughnessMap,map:m.map});m.normalMap=null;m.roughnessMap=null;if(/roof/i.test(m.name))m.map=null;m.needsUpdate=true;}});renderer.render(scene,camera);const noDetailMapsPNG=renderer.domElement.toDataURL('image/png');for(const {m,...values} of maps){Object.assign(m,values);m.needsUpdate=true;}renderer.render(scene,camera);
        shadowDiagnostics={roofStats,collisionOnly,noShadowsPNG,roofNoReceivePNG,noDetailMapsPNG};
      }
      return{png,camera:eye,target,sunTarget,groundHeight:ground??null,nearObstacleDistances:nearby,fullBuildingInFrame,stataEnvironmentReady,glassMaterials:[...glassMaterials.values()],collisionOnly,shadowDiagnostics,projectionBounds:{min:[0,1,2].map(i=>Math.min(...projection.map(p=>p[i]))),max:[0,1,2].map(i=>Math.max(...projection.map(p=>p[i])))},render,memory:performance.memory?{usedJSHeapBytes:performance.memory.usedJSHeapSize,totalJSHeapBytes:performance.memory.totalJSHeapSize}:null,refinedVisible:refined.map(o=>o.visible)};
    },{frame,locked,phase,diagnoseShadows});
    const png=Buffer.from(result.png.split(',')[1],'base64');await writeFile(`${attempt}/${frame.id}.png`,png,{flag:'wx'});
    if(result.shadowDiagnostics){for(const [key,suffix] of [['noShadowsPNG','no-shadows'],['roofNoReceivePNG','roof-no-receive'],['noDetailMapsPNG','no-detail-maps']]){const bytes=Buffer.from(result.shadowDiagnostics[key].split(',')[1],'base64');await writeFile(`${attempt}/${frame.id}-${suffix}.png`,bytes,{flag:'wx'});result.shadowDiagnostics[key]={path:`${frame.id}-${suffix}.png`,sha256:hash(bytes)};}}
    const {png:ignored,...stats}=result;report.views.push({...frame,...stats,pngSHA256:hash(png)});
    console.log(JSON.stringify({phase,view:frame.id,render:stats.render,nearObstacleDistances:stats.nearObstacleDistances,fullBuildingInFrame:stats.fullBuildingInFrame}));
    if((!probe||((detailsOnly||referenceView)&&!explicitProbe))&&stats.nearObstacleDistances.some(value=>value!==null))throw Error(`Camera collision in ${frame.id}.`);
    if(!probe&&frame.fullHeight&&!stats.fullBuildingInFrame)throw Error(`Complete building does not fit ${frame.id}.`);
  }
  if(report.errors.length)throw Error(report.errors.join('\n'));
  if(JSON.stringify(sourceBefore)!==JSON.stringify(await sourceHashes()))throw Error('Runtime source changed during capture; mixed baseline refused.');
  report.checks=['Actual desktop Boston world loaded with loadWorldAssets, including the surrounding MIT campus.','Identical static simulation, Boston daylight, fog, exposure and rendering settings.','Finite mesh positions and no browser console/page errors.',`All ${captureFrames.length} camera positions tested with seven one-metre collision probes.`,'GPU-completed frame timing sampled five times per view; load time and rendering counters recorded.'];
  if(!detailsOnly&&!referenceView)report.checks.push('Elevated view includes the entire surveyed building bounding envelope.');
  if(lock&&!detailsOnly)report.checks.push('Exact world camera, target and sun target reused from immutable baseline.');
  if(detailsOnly)report.checks.push('Independent after-only detail cameras; not presented as before/after comparisons.');
  if(referenceView)report.checks.push('Reference camera eye is 1.7 m above sampled ground. Photo lens/pose are unknown; only the two game views claim identical projection.');
  if(phase==='before')report.checks.push('The archived delivered GLBs were served in place of current asset URLs; their hashes and all live runtime source hashes match the immutable baseline.');
  if(phase==='after')report.checks.push('Stata replacement status is loaded and exactly one refined Stata group is visible.','Stata neighborhood reflection is ready and every glass material has an environment map in every captured view.');
  report.status='passed';await writeFile(`${attempt}/visual-report.json`,JSON.stringify(report,null,2),{flag:'wx'});
  if(referenceView&&!explicitProbe){
    const destination=`${directory}/reference-view/${phase}`;await mkdir(destination,{recursive:true});for(const frame of referenceFrames)await copyFile(`${attempt}/${frame.id}.png`,`${destination}/${frame.id}.png`,phase==='before'?constants.COPYFILE_EXCL:0);await copyFile(`${attempt}/visual-report.json`,`${destination}/visual-report.json`,phase==='before'?constants.COPYFILE_EXCL:0);
    if(phase==='before')await writeFile(lockPath,JSON.stringify({createdAt:report.capturedAt,requestedFrames:referenceFrames,renderSettings,light:report.light,views:report.views.map(({id,camera,target,sunTarget})=>({id,camera,target,sunTarget})),sourceHashes:sourceBefore},null,2),{flag:'wx'});
  }
  if(detailsOnly&&!explicitProbe){await mkdir(`${directory}/details`,{recursive:true});for(const frame of detailFrames)await copyFile(`${attempt}/${frame.id}.png`,`${directory}/details/${frame.id}.png`);await copyFile(`${attempt}/visual-report.json`,`${directory}/details/visual-report.json`);}
  if(!probe){
    if(replaceAfter&&await exists(`${directory}/after/visual-report.json`)){
      const previous=JSON.parse(await readFile(`${directory}/after/visual-report.json`,'utf8')),archive=`${directory}/revisions/after-${previous.capturedAt.replace(/[:.]/g,'-')}`;await mkdir(archive,{recursive:true});
      for(const frame of frames)await copyFile(`${directory}/after/${frame.id}.png`,`${archive}/${frame.id}.png`,constants.COPYFILE_EXCL);await copyFile(`${directory}/after/visual-report.json`,`${archive}/visual-report.json`,constants.COPYFILE_EXCL);
    }
    await mkdir(`${directory}/${phase}`,{recursive:true});
    for(const frame of frames)await copyFile(`${attempt}/${frame.id}.png`,`${directory}/${phase}/${frame.id}.png`,replaceAfter?0:constants.COPYFILE_EXCL);
    await copyFile(`${attempt}/visual-report.json`,`${directory}/${phase}/visual-report.json`,replaceAfter?0:constants.COPYFILE_EXCL);
    if(phase==='before')await writeFile(lockPath,JSON.stringify({createdAt:report.capturedAt,requestedFrames:frames,renderSettings,light:report.light,views:report.views.map(({id,camera,target,sunTarget})=>({id,camera,target,sunTarget})),sourceHashes:sourceBefore},null,2),{flag:'wx'});
  }
  console.log(`Saved ${probe?'probe':phase==='before'?'immutable before':`${draft?'draft ':''}after`}: ${attempt}`);
}catch(error){report.status='failed';report.error=String(error);await writeFile(`${attempt}/failure-report.json`,JSON.stringify(report,null,2));console.error(report.error);process.exitCode=1;}
finally{if(browser)await browser.close();}

async function checkReview(){
  const result={status:'running',checkedAt:new Date().toISOString(),checks:[],errors:[],modes:[]};
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const context=await browser.newContext({viewport:{width:1600,height:1200},deviceScaleFactor:1});await authenticateContext(context,base);const page=await context.newPage();
    page.on('pageerror',error=>result.errors.push(error.message));page.on('console',message=>{if(message.type()==='error')result.errors.push(message.text());});
    await page.goto(`${base}/${directory}/review.html`,{waitUntil:'networkidle'});await page.waitForFunction(()=>window.stataFullReview?.ready);
    await page.waitForFunction(()=>window.stataFullReview?.referenceReady);
    const referenceImages=await page.locator('.reference-grid img').evaluateAll(images=>images.map(image=>({complete:image.complete,width:image.naturalWidth,height:image.naturalHeight})));
    expect(referenceImages).toHaveLength(3);for(const image of referenceImages){expect(image.complete).toBe(true);expect(image.width).toBeGreaterThan(0);expect(image.height).toBeGreaterThan(0);}
    result.checks.push('The real photograph and both street-height game comparisons load; their camera and asset versions match the locked evidence.');
    expect(await page.evaluate(()=>({mode:window.stataFullReview.mode,view:window.stataFullReview.view}))).toEqual({mode:'after',view:'03-whole-building'});
    const views=await page.evaluate(()=>window.stataFullReview.views);
    for(const view of views)for(const mode of ['before','after','pair']){
      await page.locator(`[data-view="${view}"]`).click();await page.locator(`[data-mode="${mode}"]`).click();
      await page.waitForFunction(({view,mode})=>window.stataFullReview.ready&&window.stataFullReview.view===view&&window.stataFullReview.mode===mode,{view,mode});
      const figures=await page.locator('figure').evaluateAll(nodes=>nodes.map(node=>{const image=node.querySelector('img');return{side:node.dataset.side,visible:!node.hidden,label:node.querySelector('figcaption').textContent,width:image.naturalWidth,height:image.naturalHeight,complete:image.complete,src:image.getAttribute('src')};}));
      expect(figures.filter(f=>f.visible).map(f=>f.side)).toEqual(mode==='pair'?['before','after']:[mode]);
      for(const f of figures){expect(f.width).toBe(1600);expect(f.height).toBe(1000);expect(f.complete).toBe(true);expect(f.src).toBe(`./${f.side}/${view}.png`);expect(f.label).toContain(f.side==='before'?'替换前':'替换后');}
      result.modes.push({view,mode});
    }
    result.checks.push('All four cameras × three modes load correctly labeled complete images.');
    const [beforeReport,afterReport,detailReport]=await Promise.all(['before','after','details'].map(async folder=>JSON.parse(await readFile(`${directory}/${folder}/visual-report.json`,'utf8'))));
    for(const view of beforeReport.views)expect(hash(await readFile(`${directory}/before/${view.id}.png`))).toBe(view.pngSHA256);
    expect(detailReport.detailsOnly).toBe(true);expect(detailReport.sourceHashes['public/assets/mit-stata/stata-full.glb']).toBe(afterReport.sourceHashes['public/assets/mit-stata/stata-full.glb']);
    const details=await page.locator('.detail-grid img').evaluateAll(images=>images.map(image=>({complete:image.complete,width:image.naturalWidth,height:image.naturalHeight,alt:image.alt})));
    expect(details).toHaveLength(2);for(const detail of details){expect(detail.complete).toBe(true);expect(detail.width).toBe(1600);expect(detail.height).toBe(1000);expect(detail.alt).toContain('替换后独立近景');}
    result.checks.push('Immutable before image hashes still match; both independent detail images use the same Stata asset hash as the final after views and are explicitly labeled after-only.');
    await page.locator('[data-view="03-whole-building"]').click();await page.locator('[data-mode="after"]').click();await page.waitForFunction(()=>window.stataFullReview.ready);
    await page.screenshot({path:`${directory}/review-desktop.png`,fullPage:true});
    await page.locator('[data-mode="pair"]').click();await page.waitForFunction(()=>window.stataFullReview.ready);
    const desktop=await page.locator('figure').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};}));expect(desktop[0].x).toBeLessThan(desktop[1].x);expect(desktop[0].y).toBe(desktop[1].y);
    await page.screenshot({path:`${directory}/review-pair-desktop.png`,fullPage:true});await page.setViewportSize({width:390,height:844});
    const mobile=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,figures:[...document.querySelectorAll('figure')].map(node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,height:r.height};})}));expect(mobile.scrollWidth).toBeLessThanOrEqual(mobile.width);expect(mobile.figures[1].y).toBeGreaterThanOrEqual(mobile.figures[0].y+mobile.figures[0].height);
    await page.screenshot({path:`${directory}/review-mobile.png`,fullPage:true});result.checks.push('Desktop comparison is side by side; mobile comparison stacks without horizontal overflow.');
    await page.locator('#campus-link').click();await page.waitForURL(url=>url.pathname==='/');await page.goBack();await page.waitForFunction(()=>window.stataFullReview?.ready);result.checks.push('Campus navigation and browser Back work.');
    expect(result.errors).toEqual([]);result.checks.push('No browser console/page errors.');result.status='passed';
  }catch(error){result.status='failed';result.error=String(error);process.exitCode=1;}
  finally{await writeFile(`${directory}/review-check.json`,JSON.stringify(result,null,2));await browser.close();console.log(JSON.stringify(result));}
}
