import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
import {authenticateContext} from './test-auth.mjs';

const directory='output/maryland-parking',base='http://127.0.0.1:5186';
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
const context=await browser.newContext({viewport:{width:1500,height:1000}});await authenticateContext(context,base);
const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
await page.route('**/umd-parking-review',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><title>UMD parking structure review</title></head><body style="margin:0"></body></html>'}));
try{
  await page.goto(`${base}/umd-parking-review`);
  const garages=await page.evaluate(async()=>{
    const THREE=await import('/node_modules/three/build/three.module.js');
    const {loadWorldAssets}=await import('/src/features/world/scene-assets.ts');
    const {UMD_FULL_BUILDINGS}=await import('/src/features/world/maryland-full-layout.ts');
    const {marylandElevation}=await import('/src/features/world/maryland-terrain.ts');
    const assets=await loadWorldAssets(new AbortController().signal,'umd');
    const scene=new THREE.Scene();scene.background=new THREE.Color('#c5d9d5');scene.add(assets.model,new THREE.HemisphereLight('#e4eeef','#89936b',1.2));
    const sun=new THREE.DirectionalLight('#fff5dc',2.9);sun.position.set(110,135,90);scene.add(sun);
    const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(1500,1000);renderer.setPixelRatio(1);renderer.toneMapping=THREE.ACESFilmicToneMapping;document.body.appendChild(renderer.domElement);
    const camera=new THREE.PerspectiveCamera(48,1.5,.25,3000);window.review={assets,scene,renderer,camera,marylandElevation};
    return UMD_FULL_BUILDINGS.filter(b=>b.kind==='garage');
  });
  const report=[];
  for(const garage of garages)for(const view of ['street','roof']){
    const result=await page.evaluate(({garage:b,view})=>{
      const {assets,scene,renderer,camera,marylandElevation}=window.review,span=Math.max(b.width,b.depth),y=marylandElevation(b.x,b.z);
      camera.position.set(b.x+span*.65,y+(view==='roof'?span*.8:12),b.z+span*.75);camera.lookAt(b.x,y+7,b.z);camera.updateMatrixWorld();assets.update(camera.position);renderer.render(scene,camera);
      return{png:renderer.domElement.toDataURL('image/png'),calls:renderer.info.render.calls,triangles:renderer.info.render.triangles};
    },{garage,view});
    await writeFile(`${directory}/${garage.sourceBuildingId}-${view}.png`,Buffer.from(result.png.split(',')[1],'base64'));report.push({name:garage.name,view,calls:result.calls,triangles:result.triangles});console.log(`Captured ${garage.name}: ${view}`);
  }
  await writeFile(`${directory}/report.json`,JSON.stringify({views:report,errors},null,2));if(errors.length)throw Error(errors.join('\n'));
}finally{await browser.close();}
