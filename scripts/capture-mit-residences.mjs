import {mkdir,readFile,writeFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from '@playwright/test';
import {authenticateContext} from './test-auth.mjs';

const dir=process.env.MIT_REVIEW_DIR||'output/mit-residences-20261023',base=process.env.WORLD_BASE_URL||'http://127.0.0.1:5186';
const phase=process.argv.includes('--before')?'before':'after';
const mobile=process.argv.includes('--mobile');
const folder=`${dir}/${mobile?'mobile':phase}`;
const frames=[
 {id:'baker-river',title:'Baker · 河侧波浪立面',eye:[-321,11,367],target:[-302,17,280],fov:68},
 {id:'baker-campus',title:'Baker · 校园侧与楼梯',eye:[-283,18,204],target:[-300,16,278],fov:74},
 {id:'baker-overview',title:'Baker · 整体与餐厅亭',eye:[-402,90,388],target:[-300,13,280],fov:52},
 {id:'maseeh-river',title:'Maseeh · 沿河街角',eye:[-60,10,238],target:[-111,21,171],fov:64},
 {id:'maseeh-campus',title:'Maseeh · Amherst 街入口',eye:[-177,10,102],target:[-116,20,161],fov:70},
 {id:'maseeh-overview',title:'Maseeh · 铜顶与庭院',eye:[-21,95,256],target:[-114,17,169],fov:52},
];
if(process.env.MIT_REVIEW_CLOSEUPS==='1')frames.push(
 {id:'baker-window',title:'Baker · 步行视角窗框与砖墙',eye:[-319,4.6,306],target:[-319,7.5,297],fov:63},
 {id:'baker-stair',title:'Baker · 北侧楼梯近景',eye:[-283,5.6,231],target:[-300,12,265],fov:67},
 {id:'maseeh-entry',title:'Maseeh · 庭院入口近景',eye:[-112,5.5,184],target:[-112,8,166],fov:64},
 {id:'maseeh-stone',title:'Maseeh · 窗框砖石近景',eye:[-95,5.6,199],target:[-98,10,186],fov:63},
);
if(process.env.MIT_REVIEW_SITE==='1')frames.splice(0,frames.length,
 {id:'baker-entry',title:'Baker · 北入口步行视角',eye:[-285.1,4.6,234.9],target:[-293.6,5.4,251.2],fov:67},
 {id:'baker-court',title:'Baker · 北入口台地全貌',eye:[-272,14,225],target:[-294,3,246],fov:64},
);
if(phase==='before'&&!mobile){try{const prior=JSON.parse(await readFile(`${folder}/report.json`,'utf8'));if(prior.status==='passed'||prior.frames.length)throw Error('Before baseline is immutable.');}catch(e){if(e.code!=='ENOENT')throw e;}}
await mkdir(folder,{recursive:true});
const sources=['src/features/world/scene-assets-desktop.ts','src/features/world/mobile-campus.ts','src/features/world/mit-residence-streets.ts','src/features/world/mit-surface-projection.ts','src/features/world/mit-residence-landscape.ts','public/assets/mit-stata/stata-full.glb',...['baker','maseeh'].map(id=>`public/assets/mit-residences/${id}-${mobile?'mobile':'full'}.glb`)];
const report={phase,mobile,createdAt:new Date().toISOString(),kind:'Actual world asset loader and Boston daylight, fixed review cameras (not player HUD).',sources:{},frames:[],errors:[]};
for(const path of sources){const bytes=await readFile(path);report.sources[path]=createHash('sha256').update(bytes).digest('hex');}
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
try{
 const context=await browser.newContext({viewport:{width:1440,height:960},deviceScaleFactor:1});await authenticateContext(context,base);
 const page=await context.newPage();page.setDefaultTimeout(180000);page.on('pageerror',e=>report.errors.push(e.message));
 await page.route('**/mit-residence-capture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><head><link rel="icon" href="data:,"></head><body style="margin:0"></body>'}));
 await page.goto(`${base}/mit-residence-capture`);
 report.loaded=await page.evaluate(async mobile=>{
  const T=await import('/node_modules/three/build/three.module.js'),{loadWorldAssets}=await import('/src/features/world/scene-assets.ts'),{BOSTON_DAYLIGHT:L}=await import('/src/features/world/campus-daylight.ts');
  const assets=await loadWorldAssets(new AbortController().signal,'boston',mobile);assets.setQuality(mobile);assets.wind.value=0;
  const renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(1440,960);renderer.setPixelRatio(1);renderer.toneMapping=T.ACESFilmicToneMapping;renderer.shadowMap.enabled=!mobile;renderer.shadowMap.type=T.PCFSoftShadowMap;document.body.appendChild(renderer.domElement);
  const scene=new T.Scene();scene.background=new T.Color('#c5d9d5');scene.fog=new T.Fog('#c5d9d5',180,2600);scene.add(assets.model,new T.HemisphereLight(L.sky,L.ground,L.ambient));
  const sun=new T.DirectionalLight(L.sun,L.intensity);sun.castShadow=!mobile;sun.shadow.mapSize.set(4096,4096);Object.assign(sun.shadow.camera,{left:-110,right:110,top:110,bottom:-110,near:1,far:390});sun.shadow.bias=-.00008;sun.shadow.normalBias=.035;sun.shadow.radius=3;scene.add(sun,sun.target);
  const camera=new T.PerspectiveCamera(60,1.5,.12,4200);window.capture={T,assets,renderer,scene,sun,camera,L};
  return {stata:assets.model.userData.stataReplacement,residences:assets.model.userData.mitResidenceReplacement,underpassConcreteTriangles:assets.model.userData.mitUnderpassConcreteTriangles,bakerReplacedSurveyPlanterTriangles:assets.model.userData.bakerReplacedSurveyPlanterTriangles};
 },mobile);
 await page.waitForFunction(()=>{let ready=true;window.capture.assets.model.traverse(o=>{if(o.material?.uniforms?.uSkyReady&&o.material.uniforms.uSkyReady.value!==1)ready=false;});return ready;},null,{timeout:30000});
 for(const frame of frames){
  const out=await page.evaluate(async f=>{
   const {T,assets,renderer,scene,sun,camera,L}=window.capture;camera.position.fromArray(f.eye);camera.fov=f.fov;camera.updateProjectionMatrix();camera.lookAt(...f.target);sun.target.position.set(f.target[0],5,f.target[2]);sun.position.copy(sun.target.position).add(new T.Vector3(...L.offset));sun.target.updateMatrixWorld();assets.update(camera.position,0);assets.model.updateMatrixWorld(true);
   for(let i=0;i<3;i++){await new Promise(requestAnimationFrame);renderer.render(scene,camera);}
   return {png:renderer.domElement.toDataURL('image/png'),calls:renderer.info.render.calls,triangles:renderer.info.render.triangles};
  },frame);
  await writeFile(`${folder}/${frame.id}.png`,Buffer.from(out.png.split(',')[1],'base64'));delete out.png;report.frames.push({...frame,...out});console.log(`${phase}/${frame.id}: ${out.calls} calls`);
 }
 await page.evaluate(()=>{window.capture.assets.dispose();window.capture.renderer.dispose();});
 report.status=report.errors.length?'failed':'passed';if(report.errors.length)process.exitCode=1;
}catch(e){report.status='failed';report.errors.push(String(e));process.exitCode=1;}
finally{await writeFile(`${folder}/report.json`,JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify({status:report.status,errors:report.errors}));}
