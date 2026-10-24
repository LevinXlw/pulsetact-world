import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
import {authenticateContext} from './test-auth.mjs';

// Inspect the actual runtime geometry from pedestrian/oblique viewpoints.
const directory='output/bu-full-campus/art',base='http://127.0.0.1:5186';
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
const context=await browser.newContext({viewport:{width:1600,height:1000}});
await authenticateContext(context,base);
const page=await context.newPage(),errors=[];
page.on('pageerror',error=>errors.push(error.message));
page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
await page.route('**/bu-fidelity-review',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><title>BU architecture inspection</title></head><body style="margin:0"></body></html>'}));
try{
  await page.goto(`${base}/bu-fidelity-review`);
  await page.evaluate(async()=>{
    const THREE=await import('/node_modules/three/build/three.module.js');
    const {loadWorldAssets}=await import('/src/features/world/scene-assets.ts');
    const {buElevation}=await import('/src/features/world/bu-terrain.ts');
    const {BU_FULL_BUILDINGS}=await import('/src/features/world/bu-full-layout.ts');
    const {BOSTON_DAYLIGHT:light}=await import('/src/features/world/campus-daylight.ts');
    const assets=await loadWorldAssets(new AbortController().signal,'boston');
    const scene=new THREE.Scene();scene.background=new THREE.Color('#c5d9d5');scene.fog=new THREE.Fog('#c5d9d5',180,2600);
    scene.add(assets.model,new THREE.HemisphereLight(light.sky,light.ground,light.ambient));
    const sun=new THREE.DirectionalLight(light.sun,light.intensity);sun.castShadow=true;
    sun.shadow.mapSize.set(4096,4096);Object.assign(sun.shadow.camera,{left:-95,right:95,top:95,bottom:-95,near:1,far:390});
    sun.shadow.bias=-.00008;sun.shadow.normalBias=.035;sun.shadow.radius=3;scene.add(sun,sun.target);
    const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
    renderer.setSize(1600,1000);renderer.setPixelRatio(1);renderer.toneMapping=THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    document.body.appendChild(renderer.domElement);
    const camera=new THREE.PerspectiveCamera(55,1.6,.12,4200);
    window.review={THREE,assets,scene,renderer,camera,sun,buElevation,light,buildings:BU_FULL_BUILDINGS};
  });
  await page.waitForTimeout(900);
  const frames=[
    {id:'01-west-campus',eye:[-2450,200,1100],target:[-2070,25,740]},
    {id:'02-central-campus',eye:[-1500,140,1200],target:[-1210,22,930]},
    {id:'03-east-campus',eye:[-460,100,1240],target:[-660,15,1000]},
    {id:'04-south-campus',eye:[-1000,90,1470],target:[-1110,4,1240]},
    {id:'05-commonwealth-walk',eye:[-1950,2.6,899],target:[-2280,12,850]},
    {id:'06-nickerson-field',eye:[-2190,30,717],target:[-2232,4,642]},
    {id:'07-new-balance',eye:[-2530,20,770],target:[-2456,5,641]},
    {id:'08-bay-state',eye:[-510,2.6,1010],target:[-770,9,980]},
    {id:'09-warren-street',eye:[-1010,3,1017],target:[-980,28,1095]},
    {id:'10-cds-street',eye:[-930,3,1050],target:[-900,45,1010]},
    {id:'11-west-residences',eye:[-2211,3,678],target:[-2315,20,700]},
    {id:'12-marsh-plaza',eye:[-1163,2.2,1009],target:[-1178,16,944]},
    {id:'13-questrom-front',eye:[-592,2.2,1128],target:[-627,20,1062]},
  ];
  const report=[];
  for(const frame of frames){
    const result=await page.evaluate(frame=>{
      const {assets,scene,renderer,camera,sun,buElevation}=window.review;
      const [x,h,z]=frame.eye,[tx,th,tz]=frame.target;
      camera.position.set(x,buElevation(x,z)+h,z);camera.lookAt(tx,buElevation(tx,tz)+th,tz);camera.updateMatrixWorld();
      sun.target.position.set(x,buElevation(x,z),z);sun.position.copy(sun.target.position).add(new window.review.THREE.Vector3(...window.review.light.offset));sun.target.updateMatrixWorld();
      assets.update(camera.position);renderer.render(scene,camera);
      return {png:renderer.domElement.toDataURL('image/png'),calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,camera:camera.position.toArray(),target:[tx,buElevation(tx,tz)+th,tz]};
    },frame);
    await writeFile(`${directory}/${frame.id}.png`,Buffer.from(result.png.split(',')[1],'base64'));
    const {png,...stats}=result;report.push({id:frame.id,...stats});console.log(`Captured ${frame.id}`);
  }
  await writeFile(`${directory}/visual-report.json`,JSON.stringify({views:report,errors},null,2));
  if(errors.length)throw Error(errors.join('\n'));
}finally{await browser.close();}
