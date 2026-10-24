import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
import {authenticateContext} from './test-auth.mjs';

const directory=process.env.BU_COMM_REVIEW_DIR||'output/bu-comm-ave-20261024';
const phase=process.argv.includes('--before')?'before':process.argv.includes('--mobile')?'mobile':process.argv.includes('--detail')?'detail':'after';
const mobile=phase==='mobile',base=process.env.WORLD_BASE_URL||'http://127.0.0.1:5186';
const selected=process.argv.find(arg=>arg.startsWith('--views='))?.slice(8).split(',');
const frames=[
 {id:'01-central-platform',title:'BU Central · 站台与架空线',eye:[-1242,1.75,1016.5],target:[-1201,2.1,1022],fov:60},
 {id:'02-central-street',title:'CAS / Marsh · Commonwealth 街景',eye:[-1250,1.75,1000],target:[-1035,9,1008],fov:62},
 {id:'03-east-platform',title:'BU East · CDS 与轨道',eye:[-1000,1.75,1065],target:[-921,11,1044],fov:60},
 {id:'04-warren-front',title:'Warren Towers · 临街基座',eye:[-971,1.75,1044],target:[-981,13,1095],fov:65},
 {id:'05-cas-front',title:'CAS · 立面与街道关系',eye:[-1043,1.75,1063],target:[-1036,11,1003],fov:64},
 {id:'06-questrom-street',title:'Questrom · Blandford 街段',eye:[-711,1.75,1115],target:[-624,12,1081],fov:62},
 {id:'07-amory-platform',title:'Amory Street · 站台近景',eye:[-1898,1.75,914],target:[-1856,2.3,918],fov:60},
 {id:'08-gsu-frontage',title:'GSU · 西侧街道界面',eye:[-1444,1.75,989],target:[-1368,6,961],fov:62},
];
if(process.argv.includes('--pass2'))frames.splice(0,frames.length,
 {id:'01-gsu-street',title:'GSU · Commonwealth 临街立面',eye:[-1444,1.75,989],target:[-1368,6,961],fov:62},
 {id:'02-link-entry',title:'GSU–Mugar Link · 共享入口',eye:[-12.52,1.75,86],target:[-12.52,2,74.53],fov:65,sertLocal:true},
 {id:'03-mugar-south',title:'Mugar · 南侧遮阳立面',eye:[11,1.75,102],target:[8,10,81],fov:65,sertLocal:true},
 {id:'04-gsu-front',title:'GSU · 窗墙与结构近景',eye:[-65,1.75,97],target:[-57,7,80],fov:68,sertLocal:true},
 {id:'05-warren-front',title:'Warren Towers · 北侧街面',eye:[-971,1.75,1044],target:[-981,13,1095],fov:65},
 {id:'06-warren-entry',title:'Warren · 门厅与接地',eye:[-973.3,1.75,1069.4],target:[-969.6,4.0,1079.1],fov:69},
 {id:'07-link-oblique',title:'GSU–Mugar · 入口侧向关系',eye:[-23,1.75,94],target:[-9,2,74],fov:60,sertLocal:true},
 {id:'08-cas-walk',title:'CAS · 主街延续关系',eye:[-1002,1.75,3.3],target:[-1102,2.2,3.3],fov:61,casLocal:true},
);
if(phase==='detail')frames.splice(0,frames.length,
 {id:'09-cas-walk',title:'CAS · 花池之间的步行视角（本轮近景）',eye:[-1002,1.75,3.3],target:[-1102,2.2,3.3],fov:61,casLocal:true},
 {id:'10-warren-entry',title:'Warren · 北门厅与雨篷（本轮近景）',eye:[-973.3,1.75,1069.4],target:[-969.6,4.0,1079.1],fov:69},
);
await mkdir(`${directory}/${phase}`,{recursive:true});
if(phase==='before')try{const old=JSON.parse(await readFile(`${directory}/before/report.json`,'utf8'));if(old.status==='passed')throw Error('Immutable before exists');}catch(e){if(e.code!=='ENOENT')throw e;}
const lock=phase==='before'?null:JSON.parse(await readFile(`${directory}/before/report.json`,'utf8'));
const report={phase,startedAt:new Date().toISOString(),base,views:[],errors:[],status:'running'};
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
try{
 const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1});await authenticateContext(context,base);
 const page=await context.newPage();page.setDefaultTimeout(180000);page.on('pageerror',e=>report.errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 await page.route('**/bu-comm-ave-capture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html><head><link rel="icon" href="data:,"></head><body style="margin:0"></body></html>'}));
 await page.goto(`${base}/bu-comm-ave-capture`);
 report.setup=await page.evaluate(async({mobile,lockedLight})=>{
  const T=await import('/node_modules/three/build/three.module.js');
  const {loadWorldAssets}=await import('/src/features/world/scene-assets.ts');
  const {buElevation}=await import('/src/features/world/bu-terrain.ts');
  const {BOSTON_DAYLIGHT:light}=await import('/src/features/world/campus-daylight.ts');
  if(lockedLight&&JSON.stringify(light)!==JSON.stringify(lockedLight))throw Error('Daylight changed since baseline');
  const assets=await loadWorldAssets(new AbortController().signal,'boston',mobile);assets.wind.value=0;assets.setQuality(mobile);
  const scene=new T.Scene();scene.background=new T.Color('#c5d9d5');scene.fog=new T.Fog('#c5d9d5',180,2600);scene.add(assets.model,new T.HemisphereLight(light.sky,light.ground,light.ambient));
  const sun=new T.DirectionalLight(light.sun,light.intensity);sun.castShadow=!mobile;sun.shadow.mapSize.set(4096,4096);Object.assign(sun.shadow.camera,{left:-100,right:100,top:100,bottom:-100,near:1,far:420});sun.shadow.bias=-.00008;sun.shadow.normalBias=.035;sun.shadow.radius=3;scene.add(sun,sun.target);
  const renderer=new T.WebGLRenderer({antialias:!mobile,preserveDrawingBuffer:true});renderer.setPixelRatio(1);renderer.setSize(1440,900);renderer.toneMapping=T.ACESFilmicToneMapping;renderer.shadowMap.enabled=!mobile;renderer.shadowMap.type=T.PCFSoftShadowMap;document.body.appendChild(renderer.domElement);
  const camera=new T.PerspectiveCamera(60,1.6,.12,4200),invalid=[];
  assets.model.traverse(o=>{if(!o.isMesh)return;const p=o.geometry.attributes.position;if(!p)return;for(const v of p.array)if(!Number.isFinite(v)){invalid.push(o.name);break;}});
  window.comm={T,assets,scene,sun,renderer,camera,buElevation,light};
  return{light,invalid,streets:assets.model.getObjectByName('BU · Commonwealth Avenue and campus streets')?.userData};
 },{mobile,lockedLight:lock?.setup.light});
 await page.waitForFunction(()=>{let ready=true;window.comm.assets.model.traverse(o=>{if(o.material?.uniforms?.uSkyReady&&o.material.uniforms.uSkyReady.value!==1)ready=false;});return ready;},{},{timeout:30000});
 for(const frame of frames.filter(frame=>!selected||selected.includes(frame.id))){
  const data=await page.evaluate(async({frame,locked})=>{
   const {T,assets,scene,sun,renderer,camera,buElevation,light}=window.comm;
   let [x,h,z]=frame.eye,[tx,th,tz]=frame.target;
   if(frame.casLocal){const {buCASPointAt}=await import('/src/features/world/bu-comm-ave-landscape-layout.ts');[x,z]=buCASPointAt(x,z);[tx,tz]=buCASPointAt(tx,tz);}
   if(frame.sertLocal){const {buSertPoint}=await import('/src/features/world/bu-sert-layout.ts');[x,z]=buSertPoint(x,z);[tx,tz]=buSertPoint(tx,tz);}
   const eye=locked?.camera??[x,(assets.collision.groundHeight(x,z)??buElevation(x,z))+h,z],target=locked?.target??[tx,buElevation(tx,tz)+th,tz];
   camera.fov=frame.fov;camera.updateProjectionMatrix();camera.position.fromArray(eye);camera.lookAt(...target);camera.updateMatrixWorld(true);
   sun.target.position.set(tx,buElevation(tx,tz),tz);sun.position.copy(sun.target.position).add(new T.Vector3(...light.offset));sun.target.updateMatrixWorld(true);
   assets.update(camera.position,0);await renderer.compileAsync(scene,camera);renderer.render(scene,camera);await new Promise(r=>requestAnimationFrame(r));renderer.render(scene,camera);
   const dir=new T.Vector3();camera.getWorldDirection(dir);
   return{png:renderer.domElement.toDataURL('image/png'),camera:eye,target,calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,nearObstacle:assets.collision.distance(camera.position,dir,1)??null,glError:renderer.getContext().getError()};
  },{frame,locked:lock?.views.find(v=>v.id===frame.id)});
  await writeFile(`${directory}/${phase}/${frame.id}.png`,Buffer.from(data.png.split(',')[1],'base64'));const {png,...stats}=data;report.views.push({...frame,...stats});console.log(`Captured ${phase} ${frame.id}`);
 }
 if(report.errors.length||report.setup.invalid.length||report.views.some(v=>v.glError||v.nearObstacle!==null))throw Error('Capture validation failed; see report');
 report.status='passed';
}catch(e){report.status='failed';report.error=String(e);process.exitCode=1;}finally{await writeFile(`${directory}/${phase}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,error:report.error,errors:report.errors}));await browser.close();}
