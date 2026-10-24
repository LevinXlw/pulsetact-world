import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
import {authenticateContext} from './test-auth.mjs';

// Offline QA viewpoints of the very same runtime scene, not concept artwork.
const directory='output/maryland-full-campus/overview',base='http://127.0.0.1:5186';
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
const context=await browser.newContext({viewport:{width:1800,height:1200}});
await authenticateContext(context,base);
const page=await context.newPage(),errors=[];
page.on('pageerror',error=>errors.push(error.message));
await page.route('**/umd-model-review',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><title>UMD model inspection</title></head><body style="margin:0"></body></html>'}));
try{
  await page.goto(`${base}/umd-model-review`);
  await page.evaluate(async()=>{
    const THREE=await import('/node_modules/three/build/three.module.js');
    const {loadWorldAssets}=await import('/src/features/world/scene-assets.ts');
    const {UMD_DISTRICTS,UMD_FULL_BOUNDS}=await import('/src/features/world/maryland-full-layout.ts');
    const assets=await loadWorldAssets(new AbortController().signal,'umd');
    const scene=new THREE.Scene();scene.background=new THREE.Color('#c5d9d5');
    scene.add(assets.model,new THREE.HemisphereLight('#e4eeef','#89936b',1.2));
    const sun=new THREE.DirectionalLight('#fff5dc',2.9);sun.position.set(110,135,90);scene.add(sun);
    const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
    renderer.setSize(1800,1200);renderer.setPixelRatio(1);renderer.toneMapping=THREE.ACESFilmicToneMapping;
    document.body.appendChild(renderer.domElement);
    const camera=new THREE.PerspectiveCamera(48,1.5,.5,6000);
    window.review={THREE,assets,scene,renderer,camera,districts:UMD_DISTRICTS,bounds:UMD_FULL_BOUNDS};
  });
  await page.waitForTimeout(800);
  const frames=await page.evaluate(()=>{
    const {districts,bounds}=window.review;
    return [{id:'whole-campus',center:[(bounds.minX+bounds.maxX)/2,(bounds.minZ+bounds.maxZ)/2],span:Math.max(bounds.maxX-bounds.minX,bounds.maxZ-bounds.minZ)},...districts.map(d=>({id:d.id,center:d.center,span:420}))];
  });
  const report=[];
  for(const frame of frames){
    const result=await page.evaluate(frame=>{
      const {assets,scene,renderer,camera}=window.review,[x,z]=frame.center;
      camera.position.set(x+frame.span*.22,frame.span*.80,z+frame.span*.74);camera.lookAt(x,0,z);camera.updateMatrixWorld();
      assets.update(camera.position);renderer.render(scene,camera);
      return {png:renderer.domElement.toDataURL('image/png'),calls:renderer.info.render.calls,triangles:renderer.info.render.triangles};
    },frame);
    await writeFile(`${directory}/${frame.id}.png`,Buffer.from(result.png.split(',')[1],'base64'));
    report.push({id:frame.id,calls:result.calls,triangles:result.triangles});console.log(`Captured ${frame.id}`);
  }
  await writeFile(`${directory}/report.json`,JSON.stringify({views:report,errors},null,2));
  if(errors.length)throw Error(errors.join('\n'));
}finally{await browser.close();}
