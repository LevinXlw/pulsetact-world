import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
import {authenticateContext} from './test-auth.mjs';

// Inspect the actual runtime geometry from pedestrian/oblique viewpoints.
const districtReview=process.argv.includes('--districts');
const directory=districtReview?'output/maryland-districts':'output/maryland-fidelity',base='http://127.0.0.1:5186';
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
const context=await browser.newContext({viewport:{width:1600,height:1000}});
await authenticateContext(context,base);
const page=await context.newPage(),errors=[];
page.on('pageerror',error=>errors.push(error.message));
page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
await page.route('**/umd-fidelity-review',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><title>UMD terrain and architecture inspection</title></head><body style="margin:0"></body></html>'}));
try{
  await page.goto(`${base}/umd-fidelity-review`);
  await page.evaluate(async()=>{
    const THREE=await import('/node_modules/three/build/three.module.js');
    const {loadWorldAssets}=await import('/src/features/world/scene-assets.ts');
    const {marylandElevation}=await import('/src/features/world/maryland-terrain.ts');
    const {UMD_FULL_BUILDINGS}=await import('/src/features/world/maryland-full-layout.ts');
    const assets=await loadWorldAssets(new AbortController().signal,'umd');
    const scene=new THREE.Scene();scene.background=new THREE.Color('#c5d9d5');scene.fog=new THREE.Fog('#c5d9d5',180,2600);
    scene.add(assets.model,new THREE.HemisphereLight('#c2d8f2','#b6b09e',1.2));
    const sun=new THREE.DirectionalLight('#fff5dc',2.9);sun.castShadow=true;
    sun.shadow.mapSize.set(4096,4096);Object.assign(sun.shadow.camera,{left:-95,right:95,top:95,bottom:-95,near:1,far:390});
    sun.shadow.bias=-.00008;sun.shadow.normalBias=.035;sun.shadow.radius=3;scene.add(sun,sun.target);
    const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
    renderer.setSize(1600,1000);renderer.setPixelRatio(1);renderer.toneMapping=THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    document.body.appendChild(renderer.domElement);
    const camera=new THREE.PerspectiveCamera(55,1.6,.12,4200);
    window.review={THREE,assets,scene,renderer,camera,sun,marylandElevation,buildings:UMD_FULL_BUILDINGS};
  });
  await page.waitForTimeout(900);
  const frames=await page.evaluate(districtReview=>{
    if(districtReview)return [
      {id:'01-business-east-entry',eye:[-348,3.8,361],target:[-415,8,365]},
      {id:'02-business-courtyard',eye:[-595,4.0,414],target:[-493,7,408]},
      {id:'03-business-overview',eye:[-698,130,610],target:[-477,7,390]},
      {id:'04-martin-front',eye:[438,3.5,-295],target:[449,8,-373]},
      {id:'05-kim-plaza',eye:[505,4.5,-531],target:[450,9,-638]},
      {id:'06-clark-entry',eye:[522,3.5,-697],target:[473,9,-768]},
      {id:'07-engineering-overview',eye:[830,190,-238],target:[443,9,-620]},
    ];
    const garages=window.review.buildings.filter(b=>b.kind==='garage');
    return [
      {id:'01-campus-drive-uphill',eye:[80,2.3,-154],target:[-205,5,-176]},
      {id:'02-stamp-front',eye:[-185,2.2,-164],target:[-185,8,-236]},
      {id:'03-union-lane-uphill',eye:[-280,2.4,-372],target:[-282,1.6,-178]},
      {id:'04-stamp-neighbourhood',eye:[-465,72,-105],target:[-230,0,-246]},
      ...garages.map(b=>({id:`garage-${b.sourceBuildingId}`,eye:[b.x+b.width*.55+28,8,b.z+b.depth*.65+32],target:[b.x,b.height*.40,b.z]})),
    ];
  },districtReview);
  const report=[];
  for(const frame of frames){
    const result=await page.evaluate(frame=>{
      const {assets,scene,renderer,camera,sun,marylandElevation}=window.review;
      const [x,h,z]=frame.eye,[tx,th,tz]=frame.target;
      camera.position.set(x,marylandElevation(x,z)+h,z);camera.lookAt(tx,marylandElevation(tx,tz)+th,tz);camera.updateMatrixWorld();
      sun.target.position.set(x,marylandElevation(x,z),z);sun.position.copy(sun.target.position).add(new window.review.THREE.Vector3(110,135,90));sun.target.updateMatrixWorld();
      assets.update(camera.position);renderer.render(scene,camera);
      return {png:renderer.domElement.toDataURL('image/png'),calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,camera:camera.position.toArray(),target:[tx,marylandElevation(tx,tz)+th,tz]};
    },frame);
    await writeFile(`${directory}/${frame.id}.png`,Buffer.from(result.png.split(',')[1],'base64'));
    const {png,...stats}=result;report.push({id:frame.id,...stats});console.log(`Captured ${frame.id}`);
  }
  await writeFile(`${directory}/visual-report.json`,JSON.stringify({views:report,errors},null,2));
  if(errors.length)throw Error(errors.join('\n'));
}finally{await browser.close();}
