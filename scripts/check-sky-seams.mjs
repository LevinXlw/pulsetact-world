import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';

// An isolated rendering harness exercises the real sky shader at the texture
// wrap, atan branch cut, both sides of the crossfade, and the animated poles.
const directory='output/sky-seam-fix';
await mkdir(directory,{recursive:true});
await writeFile(`${directory}/harness.html`,`<!doctype html><html><head><link rel="icon" href="data:,"></head><body style="margin:0;background:#000"><script type="module">
import * as THREE from 'three';
import {createPainterlySky} from '/src/features/world/painterly-sky.ts';
const clock={value:0}, sky=createPainterlySky(clock);
const renderer=new THREE.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});
renderer.setSize(1200,700);renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.SRGBColorSpace;
document.body.append(renderer.domElement);
const scene=new THREE.Scene();scene.add(sky);
const camera=new THREE.PerspectiveCamera(52,1200/700,.1,4200);
const current=sky.material;
while(current.uniforms.uSkyReady.value<.5)await new Promise(resolve=>setTimeout(resolve,20));
const old=current.clone();
const begin=old.fragmentShader.indexOf('      vec3 paintedPanorama');
const end=old.fragmentShader.indexOf('      void main()',begin);
old.fragmentShader=old.fragmentShader.slice(0,begin)+
  'vec3 paintedPanorama(vec3 d){return texture2D(uSkyMap,vec2(atan(d.z,d.x)/6.2831853+.63+uSkyTime*.000013,.43+asin(clamp(d.y,-1.0,1.0))/3.14159265*1.14)).rgb;}\\n'+
  old.fragmentShader.slice(end);
old.uniforms.uSkyMap.value=current.uniforms.uSkyMap.value.clone();
old.uniforms.uSkyMap.value.wrapS=THREE.RepeatWrapping;old.uniforms.uSkyMap.value.needsUpdate=true;
const target=new THREE.WebGLRenderTarget(1200,700);
const pixels=new Uint8Array(1200*700*4);
window.skyQa={render(kind,time,longitude,elevation,roll=0){
  sky.material=kind==='old'?old:current;sky.material.uniforms.uSkyTime.value=time;
  camera.up.set(Math.sin(roll),Math.cos(roll),0);
  if(Math.abs(elevation)>1.56)camera.up.set(Math.sin(roll),0,Math.cos(roll));
  camera.lookAt(Math.cos(longitude)*Math.cos(elevation),Math.sin(elevation),Math.sin(longitude)*Math.cos(elevation));
  renderer.setRenderTarget(target);renderer.render(scene,camera);renderer.readRenderTargetPixels(target,0,0,1200,700,pixels);
  renderer.setRenderTarget(null);renderer.render(scene,camera);
  const differences=[];
  for(let y=0;y<700;y++){let total=0;for(let c=0;c<3;c++)total+=Math.abs(pixels[(y*1200+599)*4+c]-pixels[(y*1200+600)*4+c]);differences.push(total/3);}
  const ordered=differences.toSorted((a,b)=>a-b);
  return {mean:differences.reduce((a,b)=>a+b,0)/700,max:Math.max(...differences),p95:ordered[665],center:[...pixels.slice((350*1200+600)*4,(350*1200+600)*4+3)],calls:renderer.info.render.calls};
}};
</script></body></html>`);
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1200,height:700}});
const errors=[],views=[];
page.on('pageerror',error=>errors.push(error.message));
page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
async function capture(name,kind,time,longitude,elevation,roll=0){
  const stats=await page.evaluate(args=>window.skyQa.render(...args),[kind,time,longitude,elevation,roll]);
  await page.screenshot({path:`${directory}/${name}.png`});views.push({name,...stats});return stats;
}
try{
  await page.goto('http://127.0.0.1:5186/output/sky-seam-fix/harness.html',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.skyQa,{timeout:30_000});
  for(const time of [0,34567]){
    const longitude=Math.atan2(Math.sin((.37-time*.000013)*Math.PI*2),Math.cos((.37-time*.000013)*Math.PI*2));
    const before=await capture(`wrap-${time}-before`,'old',time,longitude,.36);
    const after=await capture(`wrap-${time}-after`,'new',time,longitude,.36);
    console.log(JSON.stringify({time,before,after}));
    assert(after.mean<1,'the wrapped meridian must not leave a vertical colour jump');
    assert(after.mean<before.mean*.5,'the boundary jump should fall by at least half despite natural cloud edges');
  }
  for(const time of [0,34567])await capture(`atan-branch-${time}`,'new',time,Math.PI,.36);
  for(const phase of [.001,.08,.159,.161,.40,.839]){
    const longitude=(phase/.84-.63)*Math.PI*2;
    await capture(`cloud-phase-${phase}`,'new',0,longitude,.36);
  }
  const poles=[];
  for(const [time,roll] of [[0,0],[34567,0],[34567,Math.PI/2]])poles.push(await capture(`zenith-${time}-${roll.toFixed(2)}`,'new',time,0,Math.PI/2,roll));
  for(const pole of poles)assert.deepEqual(pole.center,poles[0].center,'the zenith must not change with longitude or cloud drift');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({status:'passed',checks:['panorama wrap at two cloud times','atan branch at two cloud times','crossfade boundary views','azimuth-independent zenith'],views,errors},null,2));
  await writeFile(`${directory}/report.json`,JSON.stringify({status:'passed',views,errors},null,2));
}finally{await browser.close();}
