import {mkdir,readFile,writeFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from '@playwright/test';
import {authenticateContext} from './test-auth.mjs';

const directory='output/mit-poetic';
const phase=process.argv.find(v=>v.startsWith('--phase='))?.slice(8)??'before';
const mobile=process.argv.includes('--mobile');
const postProcessing=!mobile&&!process.argv.includes('--no-post');
const base=process.env.WORLD_BASE_URL||'http://127.0.0.1:5186';
const folder=`${directory}/${mobile&&phase==='before'?'mobile':phase}`;
const lockPath=`${directory}/camera-lock.json`;
const frames=[
 {id:'01-court-front',title:'主楼与 Killian Court 全景',eye:[65.7,8,79.8],target:[5,21,-51],fov:52,wholeDome:true},
 {id:'02-portico-front',title:'主立面与穹顶',eye:[37.2,6.5,18.1],target:[8,23,-45],fov:68,wholeDome:true},
 {id:'03-portico-walk',title:'柱廊步行视高近景',eye:[18.77,6.6,-21.87],target:[11,13,-38],fov:73},
 {id:'04-court-oblique',title:'左侧斜视与庭院关系',eye:[-19.2,9,62.9],target:[6,21,-42],fov:58,wholeDome:true},
 {id:'05-dome-elevated',title:'穹顶及主楼屋面层次',eye:[83,57,33],target:[1,29,-58],fov:52,wholeDome:true},
];
// The original 04 camera was found to be behind a side wing during visual QA.
// Keep its immutable lock for traceability, but never present it as a main-hall view.
const supplementalFrames=[
 {id:'06-court-walk-oblique',title:'庭院内步行斜视（本轮补充，无修改前同机位）',eye:[2.42,7,14.31],target:[5,22,-45],fov:70,wholeDome:true,supplemental:true},
 {id:'07-capitals-close',title:'柱头实体与梁底近景（本轮补充，无修改前同机位）',eye:[16.6,7,-26.6],target:[12.9,19.3,-34.6],fov:45,supplemental:true},
];
const captureFrames=phase==='before'&&!mobile?frames:[...frames.filter(f=>f.id!=='04-court-oblique'),...supplementalFrames];
const settings={width:1600,height:1000,pixelRatio:1,exposure:1,background:'#c5d9d5',fog:[180,2600],shadowCamera:{left:-95,right:95,top:95,bottom:-95,near:1,far:390}};
async function exists(path){try{await stat(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
if(await exists(`${folder}/report.json`))throw Error(`Refusing to overwrite ${folder}/report.json; retain completed evidence.`);
if(phase==='before'&&await exists(lockPath))throw Error('Before camera lock already exists.');
const lock=phase!=='before'||mobile?JSON.parse(await readFile(lockPath,'utf8')):null;
if(lock&&JSON.stringify(lock.frames)!==JSON.stringify(frames))throw Error('Camera definitions changed since baseline.');
if(lock&&JSON.stringify(lock.settings)!==JSON.stringify(settings))throw Error('Render settings changed since baseline.');
await mkdir(folder,{recursive:true});
const paths=['src/features/world/scene-assets.ts','src/features/world/scene-assets-desktop.ts','src/features/world/painterly-surfaces.ts','src/features/world/campus-daylight.ts','src/features/world/mit-poetic-materials.ts','src/features/world/mit-main-building-detail.ts','src/features/world/mit-glass-reflection.ts','src/features/world/mit-scene-renderer.ts','src/features/world/mobile-campus.ts','public/data/killian/detail.glb','public/data/killian/detail-manifest.json','public/data/killian/mobile-portico.glb'];
const sources={};for(const path of paths)sources[path]=createHash('sha256').update(await readFile(path)).digest('hex');
const report={phase,mobile,postProcessing,capturedAt:new Date().toISOString(),kind:'Actual world asset loader and selected game rendering path with Boston daylight; fixed inspection camera without player HUD, not a complete gameplay check.',settings,sources,excludedViews:[{id:'04-court-oblique',reason:'Original camera was blocked by a side-wing facade; retained in camera lock for history only, excluded from acceptance and presentation.'}],supplementalFrames:phase==='before'&&!mobile?[]:supplementalFrames,frames:[],errors:[]};
let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 const context=await browser.newContext({viewport:{width:settings.width,height:settings.height},deviceScaleFactor:1});await authenticateContext(context,base);
 const page=await context.newPage();page.setDefaultTimeout(180000);
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 await page.route('**/mit-poetic-capture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><head><link rel="icon" href="data:,"></head><body style="margin:0"></body>'}));
 await page.goto(`${base}/mit-poetic-capture`);
 report.loaded=await page.evaluate(async({settings,mobile,postProcessing,lockedLight})=>{
  const T=await import('/node_modules/three/build/three.module.js'),{loadWorldAssets}=await import('/src/features/world/scene-assets.ts'),{BOSTON_DAYLIGHT:L}=await import('/src/features/world/campus-daylight.ts');
  if(lockedLight&&JSON.stringify(lockedLight)!==JSON.stringify(L))throw Error('Boston daylight changed since baseline.');
  const assets=await loadWorldAssets(new AbortController().signal,'boston',mobile);assets.setQuality(mobile);assets.wind.value=0;
  const renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(settings.width,settings.height);renderer.setPixelRatio(settings.pixelRatio);renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=settings.exposure;renderer.shadowMap.enabled=!mobile;renderer.shadowMap.type=T.PCFSoftShadowMap;document.body.appendChild(renderer.domElement);
  const scene=new T.Scene();scene.background=new T.Color(settings.background);scene.fog=new T.Fog(settings.background,...settings.fog);scene.add(assets.model,new T.HemisphereLight(L.sky,L.ground,L.ambient));
  const sun=new T.DirectionalLight(L.sun,L.intensity);sun.castShadow=!mobile;sun.shadow.mapSize.set(4096,4096);Object.assign(sun.shadow.camera,settings.shadowCamera);sun.shadow.bias=-.00008;sun.shadow.normalBias=.035;sun.shadow.radius=3;scene.add(sun,sun.target);
  const camera=new T.PerspectiveCamera(52,settings.width/settings.height,.12,4200);
  const pipeline=!mobile?(await import('/src/features/world/mit-scene-renderer.ts')).createMITSceneRenderer(renderer,scene):null;
  window.capture={T,assets,renderer,scene,sun,camera,L,pipeline,postProcessing};
  return {light:L,userData:assets.model.userData};
 },{settings,mobile,postProcessing,lockedLight:lock?.light});
 await page.waitForFunction(()=>{let ready=true;window.capture.assets.model.traverse(o=>{if(o.material?.uniforms?.uSkyReady&&o.material.uniforms.uSkyReady.value!==1)ready=false;});return ready;},null,{timeout:30000});
 for(const frame of captureFrames){
  const out=await page.evaluate(async f=>{
   const {T,assets,renderer,scene,sun,camera,L,pipeline,postProcessing}=window.capture;camera.position.fromArray(f.eye);camera.fov=f.fov;camera.updateProjectionMatrix();camera.lookAt(...f.target);camera.updateMatrixWorld();sun.target.position.set(f.target[0],5,f.target[2]);sun.position.copy(sun.target.position).add(new T.Vector3(...L.offset));sun.target.updateMatrixWorld();assets.update(camera.position,0);assets.model.updateMatrixWorld(true);
   for(let i=0;i<3;i++){await new Promise(requestAnimationFrame);if(pipeline)pipeline.render(camera,postProcessing);else renderer.render(scene,camera);}
   const crown=[-19.15,19.15].flatMap(x=>[-19.15,19.15].flatMap(z=>[27.02,47.57].map(y=>new T.Vector3(-1.849+x,y,-67.139+z).project(camera).toArray())));
   return {png:renderer.domElement.toDataURL('image/png'),calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometryCount:renderer.info.memory.geometries,textureCount:renderer.info.memory.textures,groundHeight:assets.collision.groundHeight(f.eye[0],f.eye[2])??null,crownProjectionBounds:{min:[0,1,2].map(i=>Math.min(...crown.map(p=>p[i]))),max:[0,1,2].map(i=>Math.max(...crown.map(p=>p[i])))}};
  },frame);
  await writeFile(`${folder}/${frame.id}.png`,Buffer.from(out.png.split(',')[1],'base64'));delete out.png;report.frames.push({...frame,...out});console.log(JSON.stringify({phase,frame:frame.id,calls:out.calls,crown:out.crownProjectionBounds}));
 }
 report.finalUserData=await page.evaluate(()=>window.capture.assets.model.userData);
 report.rendering=await page.evaluate(()=>window.capture.pipeline?.stats??{mode:'direct'});
 if(report.rendering.error)report.errors.push(report.rendering.error);
 if(!mobile&&report.finalUserData.mitGlassReflection?.error)report.errors.push(report.finalUserData.mitGlassReflection.error);
 await page.evaluate(()=>{window.capture.pipeline?.dispose();window.capture.assets.dispose();window.capture.renderer.dispose();});
 report.status=report.errors.length?'failed':'passed';if(report.errors.length)process.exitCode=1;
 if(phase==='before'&&!mobile&&report.status==='passed')await writeFile(lockPath,JSON.stringify({createdAt:report.capturedAt,frames,settings,light:report.loaded.light,sources},null,2),{flag:'wx'});
}catch(e){report.status='failed';report.errors.push(String(e));process.exitCode=1;}
finally{await writeFile(`${folder}/report.json`,JSON.stringify(report,null,2));await browser?.close();console.log(JSON.stringify({status:report.status,errors:report.errors}));}
