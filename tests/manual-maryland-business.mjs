import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
import {authenticateContext} from '../scripts/test-auth.mjs';

const base='http://127.0.0.1:5186',directory='output/maryland-business';
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
try{
  const context=await browser.newContext({viewport:{width:1500,height:1000}});await authenticateContext(context,base);
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/business-model-review',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><body style="margin:0"></body>'}));await page.goto(`${base}/business-model-review`);
  await page.evaluate(async()=>{
    const THREE=await import('/node_modules/three/build/three.module.js'),{createMarylandBusinessDistrict}=await import('/src/features/world/maryland-business-detail.ts'),{marylandElevation,drapeMarylandGeometry}=await import('/src/features/world/maryland-terrain.ts'),{UMD_FULL_BUILDINGS}=await import('/src/features/world/maryland-full-layout.ts');
    const district=createMarylandBusinessDistrict(),b=UMD_FULL_BUILDINGS.find(b=>b.sourceBuildingId==='039');
    const scene=new THREE.Scene();scene.background=new THREE.Color('#cadbd8');scene.add(district.group,new THREE.HemisphereLight('#e4eeef','#89936b',1.2));const sun=new THREE.DirectionalLight('#fff5dc',2.9);sun.position.set(110,135,90);scene.add(sun);
    const original=new THREE.PlaneGeometry(500,500,30,30);original.rotateX(-Math.PI/2);original.translate(b.x,0,b.z);const terrain=new THREE.Mesh(drapeMarylandGeometry(original,12),new THREE.MeshStandardMaterial({color:'#91a974',roughness:1}));scene.add(terrain);original.dispose();
    const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(1500,1000);renderer.setPixelRatio(1);renderer.toneMapping=THREE.ACESFilmicToneMapping;document.body.appendChild(renderer.domElement);
    window.businessReview={THREE,district,b,scene,renderer,camera:new THREE.PerspectiveCamera(48,1.5,.5,3000),marylandElevation};
  });
  const frames=[{id:'east-arrival',offset:[108,17,115],target:[28,8,17]},{id:'west-court',offset:[-123,33,58],target:[-9,9,1]},{id:'aerial',offset:[154,188,223],target:[0,0,0]}];
  for(const frame of frames){const png=await page.evaluate(frame=>{const {district,b,scene,renderer,camera,marylandElevation}=window.businessReview,base=marylandElevation(b.x,b.z);camera.position.set(b.x+frame.offset[0],base+frame.offset[1],b.z+frame.offset[2]);camera.lookAt(b.x+frame.target[0],base+frame.target[1],b.z+frame.target[2]);camera.updateMatrixWorld();district.update(camera.position);renderer.render(scene,camera);return renderer.domElement.toDataURL('image/png');},frame);await writeFile(`${directory}/${frame.id}.png`,Buffer.from(png.split(',')[1],'base64'));}
  if(errors.length)throw Error(errors.join('\n'));console.log(JSON.stringify({views:frames.map(f=>f.id),errors}));
}finally{await browser.close();}
