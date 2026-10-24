import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
import {authenticateContext} from './test-auth.mjs';

const base='http://127.0.0.1:5186',directory='output/arizona-campus/art-review';
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
const context=await browser.newContext({viewport:{width:1600,height:1000}});await authenticateContext(context,base);
const page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
await page.route('**/arizona-art-review',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html><head><title>Arizona campus inspection</title></head><body style="margin:0"></body></html>'}));
try{
  await page.goto(`${base}/arizona-art-review`);
  await page.evaluate(async()=>{
    const THREE=await import('/node_modules/three/build/three.module.js');
    const {loadWorldAssets}=await import('/src/features/world/scene-assets.ts');
    const {ARIZONA_BUILDINGS,arizonaElevation}=await import('/src/features/world/arizona-geography.ts');
    const {ARIZONA_LAYOUT}=await import('/src/features/world/arizona-layout.ts');
    const assets=await loadWorldAssets(new AbortController().signal,'arizona');
    const scene=new THREE.Scene();scene.background=new THREE.Color('#d4dfd7');scene.fog=new THREE.Fog('#d4dfd7',240,2800);
    scene.add(assets.model,new THREE.HemisphereLight('#c2d8f2','#c7b18b',1.3));
    const sun=new THREE.DirectionalLight('#fff5dc',2.9);sun.castShadow=true;sun.shadow.mapSize.set(4096,4096);
    Object.assign(sun.shadow.camera,{left:-95,right:95,top:95,bottom:-95,near:1,far:390});sun.shadow.bias=-.00008;sun.shadow.normalBias=.035;sun.shadow.radius=3;scene.add(sun,sun.target);
    const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(1600,1000);renderer.setPixelRatio(1);renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;document.body.appendChild(renderer.domElement);
    const camera=new THREE.PerspectiveCamera(55,1.6,.12,4200);
    window.review={THREE,assets,scene,renderer,camera,sun,elevation:arizonaElevation,buildings:ARIZONA_BUILDINGS,layout:ARIZONA_LAYOUT};
  });
  await page.waitForTimeout(800);
  const frames=await page.evaluate(()=>{
    const {buildings,layout}=window.review;
    const result=[{id:'00-overview',eye:[-600,490,900],target:[180,0,0]}];
    for(const id of ['arizona-old-main','arizona-eller','arizona-enr2','arizona-stadium']){
      const point=layout.points.find(p=>p.id===id);if(!point)continue;
      const target=point.lookAt??point.position;
      const length=Math.hypot(point.position[0]-target[0],point.position[1]-target[1])||1;
      result.push({id,eye:[point.position[0]+(point.position[0]-target[0])/length*20,3.6,point.position[1]+(point.position[1]-target[1])/length*20],target:[target[0],8,target[1]]});
      const sourceId={'arizona-old-main':'21','arizona-eller':'108','arizona-enr2':'137','arizona-stadium':'58'}[id];
      const b=buildings.filter(b=>b.sourceId===sourceId).sort((a,b)=>b.width*b.depth-a.width*a.depth)[0];
      if(b)result.push({id:`${id}-oblique`,eye:[b.x-b.width*.7-40,Math.max(b.height+25,40),b.z+b.depth*.8+40],target:[b.x,b.height*.3,b.z]});
    }
    result.push({id:'arizona-enr2-canyon',eye:[-169,3.6,403],target:[-205,10,403]});
    result.push({id:'arizona-enr2-overview',eye:[-118,67,465],target:[-178.13,9,403.26]});
    return result;
  });
  const report=[];
  for(const frame of frames){
    const result=await page.evaluate(frame=>{
      const {assets,scene,renderer,camera,sun,elevation,THREE}=window.review;const [x,h,z]=frame.eye,[tx,th,tz]=frame.target;
      camera.position.set(x,elevation(x,z)+h,z);camera.lookAt(tx,elevation(tx,tz)+th,tz);camera.updateMatrixWorld();
      sun.target.position.set(x,elevation(x,z),z);sun.position.copy(sun.target.position).add(new THREE.Vector3(-95,115,135));sun.target.updateMatrixWorld();
      assets.update(camera.position);renderer.render(scene,camera);
      return {png:renderer.domElement.toDataURL('image/png'),calls:renderer.info.render.calls,triangles:renderer.info.render.triangles};
    },frame);
    await writeFile(`${directory}/${frame.id}.png`,Buffer.from(result.png.split(',')[1],'base64'));const {png,...stats}=result;report.push({id:frame.id,...stats});console.log(`Captured ${frame.id}`);
  }
  await writeFile(`${directory}/report.json`,JSON.stringify({views:report,errors},null,2));if(errors.length)throw Error(errors.join('\n'));
}finally{await browser.close();}
