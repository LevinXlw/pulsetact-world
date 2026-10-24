import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
import {authenticateContext} from './test-auth.mjs';

// Raw-scene browser QA against the actual Vite asset loaders, not a copy of the
// water shader. Run after desktop integration and the mobile material adapter
// are stable. This does not rebuild or modify any campus GLB.
//   node scripts/check-campus-water.mjs
// Optional: --only=boston-desktop,boston-mobile,umd-desktop
const base=process.env.WORLD_BASE_URL||'http://127.0.0.1:5186';
const directory='output/water-green-line';
const selection=process.argv.find(arg=>arg.startsWith('--only='))?.slice(7).split(',');
const cases=[
  {id:'boston-desktop',campus:'boston',mobile:false},
  {id:'boston-mobile',campus:'boston',mobile:true},
  {id:'umd-desktop',campus:'umd',mobile:false},
];
if(selection?.some(id=>!cases.some(test=>test.id===id)))throw Error('Unknown water QA --only selection');
const report={startedAt:new Date().toISOString(),base,method:'Actual scene loaders; fixed views; isolated real water mesh pixels at t=0,3,0; no bitmap or geometry replacement in the product.',checks:[],views:[],errors:[],failures:[]};
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
const check=(name,condition,details)=>{report.checks.push({name,passed:!!condition,...(details===undefined?{}:{details})});if(!condition)report.failures.push(name);};

async function inspect(test){
  const viewport=test.mobile?{width:390,height:844}:{width:1600,height:900};
  const context=await browser.newContext({...test.mobile?{isMobile:true,hasTouch:true}:{},viewport,deviceScaleFactor:1});
  let page;
  try{
    await authenticateContext(context,base);
    page=await context.newPage();page.setDefaultTimeout(180000);
    page.on('pageerror',error=>report.errors.push({case:test.id,type:'pageerror',message:error.message}));
    page.on('console',message=>{if(message.type()==='error')report.errors.push({case:test.id,type:'console',message:message.text()});});
    await page.route('**/campus-water-review',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><title>Campus water review</title><link rel="icon" href="data:,"></head><body style="margin:0;background:#122b32"></body></html>'}));
    await page.goto(`${base}/campus-water-review`);
    const setup=await page.evaluate(async({test,viewport})=>{
      const THREE=await import('/node_modules/three/build/three.module.js');
      const {loadWorldAssets}=await import('/src/features/world/scene-assets.ts');
      const {BOSTON_DAYLIGHT}=await import('/src/features/world/campus-daylight.ts');
      const assets=await loadWorldAssets(new AbortController().signal,test.campus,test.mobile);
      const expected=test.campus==='boston'?'Charles River water':'UMD detail-water';
      const waters=[],otherSourceWater=[];
      assets.model.traverse(object=>{
        if(!object.isMesh)return;
        if(object.name===expected)waters.push(object);
        else if(object.name==='water')otherSourceWater.push({name:object.name,visible:object.visible});
      });
      if(waters.length!==1)throw Error(`Expected one ${expected}, got ${waters.length}`);
      const water=waters[0],geometry=water.geometry,position=geometry.getAttribute('position');
      const originalGeometry=geometry.uuid,originalPosition=position.array;
      const light=test.campus==='boston'?BOSTON_DAYLIGHT:{sky:'#c2d8f2',ground:'#b6b09e',ambient:1.2,sun:'#fff5dc',intensity:2.9,offset:[110,135,90]};
      const scene=new THREE.Scene();scene.background=new THREE.Color('#c5d9d5');scene.fog=new THREE.Fog('#c5d9d5',180,2600);
      const hemisphere=new THREE.HemisphereLight(light.sky,light.ground,light.ambient),sun=new THREE.DirectionalLight(light.sun,light.intensity);
      sun.castShadow=!test.mobile;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-95,right:95,top:95,bottom:-95,near:1,far:390});sun.shadow.bias=-.00008;sun.shadow.normalBias=.035;sun.shadow.radius=3;
      scene.add(assets.model,hemisphere,sun,sun.target);
      const renderer=new THREE.WebGLRenderer({antialias:!test.mobile,preserveDrawingBuffer:true,powerPreference:test.mobile?'low-power':'default'});
      renderer.setSize(viewport.width,viewport.height);renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;
      renderer.shadowMap.enabled=!test.mobile;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.debug.checkShaderErrors=true;document.body.appendChild(renderer.domElement);
      const camera=new THREE.PerspectiveCamera(54,viewport.width/viewport.height,.12,4200);
      assets.model.updateMatrixWorld(true);
      const waterBounds=new THREE.Box3().setFromObject(water),waterCentre=waterBounds.getCenter(new THREE.Vector3());
      const frames=test.campus==='boston'?[
        {id:'charles-nearshore',eye:[-1110,3.1,851],target:[-1215,.24,735],fov:54},
        {id:'charles-distance',eye:[-1175,38,775],target:[-980,.24,590],fov:58},
      ]:[{id:'odk-fountain',eye:[waterCentre.x-55,waterBounds.max.y+4.4,waterCentre.z+13],target:[waterCentre.x,waterBounds.max.y,waterCentre.z],fov:54}];
      const info=()=>{
        const materials=Array.isArray(water.material)?water.material:[water.material];
        return {
          mesh:water.name,meshVisible:water.visible,geometry:water.geometry.uuid,vertices:position.count,triangles:(geometry.index?.count??position.count)/3,
          geometryUnchanged:water.geometry.uuid===originalGeometry&&water.geometry.getAttribute('position').array===originalPosition,
          mobileGround:water.userData.mobileGround??false,mobileWall:water.userData.mobileWall??false,
          materials:materials.map(material=>({name:material.name,type:material.type,uuid:material.uuid,key:material.customProgramCacheKey(),sharedWater:material.userData.campusWater===true,quality:material.userData.campusWaterQuality,clockShared:material.waterUniforms?.uCampusWaterTime===assets.wind})),
        };
      };
      const setFrame=frame=>{
        camera.fov=frame.fov;camera.updateProjectionMatrix();camera.position.set(...frame.eye);camera.lookAt(...frame.target);camera.updateMatrixWorld(true);
        sun.target.position.set(frame.target[0],frame.target[1],frame.target[2]);sun.position.copy(sun.target.position).add(new THREE.Vector3(...light.offset));sun.target.updateMatrixWorld(true);
        assets.update(camera.position);
      };
      const diagnostics=()=>({glError:renderer.getContext().getError(),programs:(renderer.info.programs??[]).map(p=>({id:p.id,runnable:p.diagnostics?.runnable??null,programLog:p.diagnostics?.programLog??'',vertexLog:p.diagnostics?.vertexShader?.log??'',fragmentLog:p.diagnostics?.fragmentShader?.log??''}))});
      window.waterReview={THREE,assets,water,scene,renderer,camera,sun,hemisphere,frames,info,setFrame,diagnostics,test,viewport};
      return{...info(),waterBounds:{min:waterBounds.min.toArray(),max:waterBounds.max.toArray()},otherSourceWater,frames};
    },{test,viewport});
    check(`${test.id}: one intended visible water surface`,setup.meshVisible,setup);
    check(`${test.id}: source MIT water remains hidden`,setup.otherSourceWater.every(water=>!water.visible),setup.otherSourceWater);
    if(test.mobile)check(`${test.id}: water remains outside ground and wall collision`,!setup.mobileGround&&!setup.mobileWall);
    const tiers=test.mobile?[{id:'low',low:true,quality:'mobile'},{id:'hd',low:false,quality:'mobile-hd'},{id:'low-again',low:true,quality:'mobile'}]:[{id:'standard',low:false,quality:'desktop'}];
    for(const tier of tiers){
      const materialState=await page.evaluate(async tier=>{
        const r=window.waterReview;r.assets.setQuality(tier.low);r.assets.wind.value=0;r.setFrame(r.frames[0]);
        await r.renderer.compileAsync(r.scene,r.camera);r.renderer.render(r.scene,r.camera);
        return{...r.info(),diagnostics:r.diagnostics()};
      },tier);
      const prefix=`${test.id}/${tier.id}`;
      check(`${prefix}: shared animated shader remains installed`,materialState.materials.every(m=>m.sharedWater&&m.key.startsWith('campus-water-')),materialState.materials);
      check(`${prefix}: intended water quality`,materialState.materials.every(m=>m.quality===tier.quality),materialState.materials);
      check(`${prefix}: scene clock reaches water uniform`,materialState.materials.every(m=>m.clockShared));
      check(`${prefix}: original geometry and buffers retained`,materialState.geometryUnchanged);
      check(`${prefix}: WebGL compilation`,materialState.diagnostics.glError===0&&materialState.diagnostics.programs.every(p=>p.runnable!==false),materialState.diagnostics);
      for(const [index,frame] of setup.frames.entries()){
        // The repeat-low check is a material/lifecycle regression; avoid another
        // pair of otherwise identical far-view screenshots.
        if(tier.id==='low-again'&&index>0)continue;
        const temporal=await page.evaluate(async frame=>{
          const r=window.waterReview,{THREE,assets,water,renderer,camera}=r;r.setFrame(frame);
          // Isolate only the real water mesh using its current product material.
          // Otherwise the shared wind also moves trees/clouds and can falsely
          // pass a test whose water itself is static.
          const scene=new THREE.Scene();scene.background=new THREE.Color(0x000000);
          scene.add(r.hemisphere.clone());const sun=r.sun.clone();sun.castShadow=false;sun.target=r.sun.target.clone();scene.add(sun,sun.target);
          water.updateWorldMatrix(true,false);
          const mesh=new THREE.Mesh(water.geometry,water.material);mesh.matrixAutoUpdate=false;mesh.matrix.copy(water.matrixWorld);scene.add(mesh);
          const width=320,height=Math.max(120,Math.round(width/camera.aspect)),target=new THREE.WebGLRenderTarget(width,height,{depthBuffer:true,stencilBuffer:false});
          const originalTarget=renderer.getRenderTarget(),maskMaterial=new THREE.MeshBasicMaterial({color:0xffffff,side:THREE.DoubleSide});
          const pixels=()=>{const result=new Uint8Array(width*height*4);renderer.setRenderTarget(target);renderer.render(scene,camera);renderer.readRenderTargetPixels(target,0,0,width,height,result);return result;};
          try{
            mesh.material=maskMaterial;const mask=pixels();mesh.material=water.material;
            assets.wind.value=0;const a=pixels();assets.wind.value=3;const b=pixels();assets.wind.value=0;const repeat=pixels();
            let covered=0,changed=0,totalDifference=0,maxDifference=0,repeatDifference=0;
            for(let i=0;i<a.length;i+=4){if(mask[i]<128)continue;covered++;let delta=0;for(let c=0;c<3;c++){delta+=Math.abs(a[i+c]-b[i+c]);repeatDifference+=Math.abs(a[i+c]-repeat[i+c]);}if(delta>3)changed++;totalDifference+=delta;maxDifference=Math.max(maxDifference,delta/3);}
            return{width,height,coveredPixels:covered,changedPixels:changed,changedFraction:covered?changed/covered:0,meanDifference:covered?totalDifference/(covered*3):0,maxDifference,repeatMeanDifference:covered?repeatDifference/(covered*3):0,diagnostics:r.diagnostics()};
          }finally{renderer.setRenderTarget(originalTarget);target.dispose();maskMaterial.dispose();scene.remove(mesh);assets.wind.value=0;}
        },frame);
        check(`${prefix}/${frame.id}: enough water pixels sampled`,temporal.coveredPixels>200,temporal);
        check(`${prefix}/${frame.id}: time changes water pixels`,temporal.changedFraction>.01&&temporal.meanDifference>.03,temporal);
        check(`${prefix}/${frame.id}: same time is deterministic`,temporal.repeatMeanDifference<.01,temporal);
        check(`${prefix}/${frame.id}: isolated shader compiles`,temporal.diagnostics.glError===0&&temporal.diagnostics.programs.every(p=>p.runnable!==false),temporal.diagnostics);
        for(const time of [0,3]){
          const rendered=await page.evaluate(async({frame,time})=>{
            const r=window.waterReview;r.assets.wind.value=time;r.setFrame(frame);
            await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
            r.renderer.render(r.scene,r.camera);
            return{png:r.renderer.domElement.toDataURL('image/png'),calls:r.renderer.info.render.calls,triangles:r.renderer.info.render.triangles,camera:r.camera.position.toArray(),target:frame.target,material:r.info(),diagnostics:r.diagnostics()};
          },{frame,time});
          const file=`${test.id}-${tier.id}-${frame.id}-t${time}.png`;
          await writeFile(`${directory}/${file}`,Buffer.from(rendered.png.split(',')[1],'base64'));
          const {png,...stats}=rendered;report.views.push({case:test.id,tier:tier.id,frame:frame.id,time,file,temporal,...stats});
        }
        console.log(JSON.stringify({case:test.id,tier:tier.id,frame:frame.id,temporal:{coverage:temporal.coveredPixels,changedFraction:temporal.changedFraction,meanDifference:temporal.meanDifference}}));
      }
    }
    const disposal=await page.evaluate(()=>{
      const r=window.waterReview,materials=new Set(Array.isArray(r.water.material)?r.water.material:[r.water.material]),counts=[];
      for(const material of materials){const row={name:material.name,count:0};material.addEventListener('dispose',()=>row.count++);counts.push(row);}
      r.assets.dispose();r.renderer.dispose();r.renderer.domElement.remove();delete window.waterReview;return counts;
    });
    check(`${test.id}: active water material released once`,disposal.length>0&&disposal.every(row=>row.count===1),disposal);
  }catch(error){
    report.failures.push(`${test.id}: ${String(error)}`);
    if(page)await page.screenshot({path:`${directory}/${test.id}-failure.png`}).catch(()=>{});
  }finally{await context.close();}
}

try{
  for(const test of cases.filter(test=>!selection||selection.includes(test.id)))await inspect(test);
  check('No browser or shader errors',report.errors.length===0,report.errors);
}finally{
  report.completedAt=new Date().toISOString();report.status=report.failures.length?'failed':'passed';
  await writeFile(`${directory}/water-report.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify({status:report.status,checks:report.checks.length,views:report.views.length,failures:report.failures,errors:report.errors}));
  await browser.close();
}
assert.equal(report.status,'passed','Campus water QA failed; see output/water-green-line/water-report.json');
