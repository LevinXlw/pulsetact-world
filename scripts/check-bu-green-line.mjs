import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
import {authenticateContext} from './test-auth.mjs';

// Actual integrated desktop/mobile loaders; no separate mock train scene.
// node scripts/check-bu-green-line.mjs [--only=desktop,mobile]
const base=process.env.WORLD_BASE_URL||'http://127.0.0.1:5186',directory='output/bu-green-line';
const selection=process.argv.find(a=>a.startsWith('--only='))?.slice(7).split(',')??['desktop','mobile'];
if(selection.some(s=>!['desktop','mobile'].includes(s)))throw Error('Unknown --only selection');
await mkdir(directory,{recursive:true});
const report={startedAt:new Date().toISOString(),base,checks:[],views:[],errors:[],failures:[]};
const check=(name,passed,detail)=>{report.checks.push({name,passed,detail});if(!passed)report.failures.push(name);};
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
try{
  for(const quality of selection){
    const mobile=quality==='mobile',viewport=mobile?{width:430,height:932}:{width:1600,height:1000};
    const context=await browser.newContext({viewport,deviceScaleFactor:1,...mobile?{isMobile:true,hasTouch:true}:{}});
    try{
      await authenticateContext(context,base);const page=await context.newPage();page.setDefaultTimeout(180000);
      page.on('pageerror',e=>report.errors.push({quality,message:e.message}));page.on('console',m=>{if(m.type()==='error')report.errors.push({quality,message:m.text()});});
      await page.route('**/bu-green-line-review',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html><head><title>BU Green Line review</title><link rel="icon" href="data:,"></head><body style="margin:0"></body></html>'}));
      await page.goto(`${base}/bu-green-line-review`);
      const setup=await page.evaluate(async({mobile,viewport})=>{
        const THREE=await import('/node_modules/three/build/three.module.js');
        const {loadWorldAssets}=await import('/src/features/world/scene-assets.ts');
        const layout=await import('/src/features/world/bu-green-line-layout.ts');
        const {buElevation}=await import('/src/features/world/bu-terrain.ts');
        const {BOSTON_DAYLIGHT:light}=await import('/src/features/world/campus-daylight.ts');
        const assets=await loadWorldAssets(new AbortController().signal,'boston',mobile),transit=assets.model.getObjectByName('BU · Green Line B service');
        if(!transit)throw Error('Integrated Green Line group missing');
        const trains=Object.fromEntries(['inbound','outbound'].map(d=>[d,transit.getObjectByName(`Green Line B ${d}`)]));
        if(Object.values(trains).some(t=>!t))throw Error('Expected both train directions');
        const initialPhases=Object.fromEntries(Object.entries(trains).map(([d,train])=>{const leg=layout.BU_GREEN_LINE_TIMETABLES[d].legs.find(l=>l.stopId===train.userData.stationId);return[d,leg.at+leg.duration+2];}));
        const scene=new THREE.Scene();scene.background=new THREE.Color('#c5d9d5');scene.fog=new THREE.Fog('#c5d9d5',180,2600);
        const sun=new THREE.DirectionalLight(light.sun,light.intensity);sun.castShadow=!mobile;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-65,right:65,top:65,bottom:-65,near:1,far:390});sun.shadow.bias=-.00008;sun.shadow.normalBias=.035;
        scene.add(assets.model,new THREE.HemisphereLight(light.sky,light.ground,light.ambient),sun,sun.target);
        const renderer=new THREE.WebGLRenderer({antialias:!mobile,preserveDrawingBuffer:true});renderer.setSize(viewport.width,viewport.height);renderer.setPixelRatio(1);renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.shadowMap.enabled=!mobile;renderer.shadowMap.type=THREE.PCFSoftShadowMap;document.body.appendChild(renderer.domElement);
        const camera=new THREE.PerspectiveCamera(mobile?61:54,viewport.width/viewport.height,.12,4200);
        const invalid=[];transit.traverse(o=>{if(!o.isMesh)return;const p=o.geometry.attributes.position;for(let i=0;i<p.count;i++)if(!Number.isFinite(p.getX(i)+p.getY(i)+p.getZ(i))){invalid.push(o.name);break;}});
        window.greenReview={THREE,assets,transit,trains,initialPhases,layout,buElevation,light,scene,sun,renderer,camera,mobile,elapsed:0};
        return{runtimeOnly:transit.userData.runtimeOnly,trainCount:Object.keys(trains).length,invalid,initial:Object.fromEntries(Object.entries(trains).map(([d,t])=>[d,t.userData]))};
      },{mobile,viewport});
      check(`${quality}: integrated runtime-only finite cars`,setup.runtimeOnly&&setup.trainCount===2&&!setup.invalid.length,setup);
      const frames=[
        {id:'01-bu-central-open',direction:'inbound',mode:'initial'},
        {id:'02-bu-central-departure',direction:'inbound',mode:'advance',seconds:12},
        {id:'03-curve-running',direction:'inbound',mode:'curve'},
        {id:'04-amory-open',direction:'outbound',mode:'station',station:'place-amory'},
      ];
      for(const frame of frames){
        const result=await page.evaluate(async frame=>{
          const r=window.greenReview,{THREE,assets,layout,trains,camera,renderer,scene,sun,light}=r,table=layout.BU_GREEN_LINE_TIMETABLES[frame.direction],train=trains[frame.direction];
          let advance=frame.seconds??0,curveDistance;
          if(frame.mode==='station'||frame.mode==='curve'){
            let target;
            if(frame.mode==='station'){const leg=table.legs.find(l=>l.stopId===frame.station);target=leg.at+leg.duration+5;}
            else{
              const path=layout.BU_GREEN_LINE_PATHS[frame.direction];let score=-Infinity;
              for(let d=100;d<path.length-100;d+=4){
                const a=layout.sampleBUGreenLine(path,d-12),b=layout.sampleBUGreenLine(path,d+12),angle=1-(a.dx*b.dx+a.dz*b.dz);
                if(layout.BU_GREEN_LINE_STATIONS.some(s=>Math.abs(s.distances[frame.direction]-d)<50))continue;
                if(angle>score){score=angle;curveDistance=d;}
              }
              let lo=0,hi=table.runEnd;for(let i=0;i<35;i++){const middle=(lo+hi)/2;if(layout.sampleBUGreenLineService(table,middle).distance<curveDistance)lo=middle;else hi=middle;}target=(lo+hi)/2;
            }
            advance=(target-r.initialPhases[frame.direction]-r.elapsed)%table.duration;if(advance<0)advance+=table.duration;
          }
          while(advance>1e-8){const step=Math.min(1,advance);assets.update(camera.position,step);advance-=step;r.elapsed+=step;}
          const state={...train.userData},p=layout.sampleBUGreenLine(layout.BU_GREEN_LINE_PATHS[frame.direction],state.distance),nx=-p.dz,nz=p.dx;
          const along=r.mobile?26:18,across=r.mobile?11:10,height=r.mobile?7.5:6;
          camera.position.set(p.x+p.dx*along+nx*across,r.buElevation(p.x,p.z)+height,p.z+p.dz*along+nz*across);camera.lookAt(p.x,r.buElevation(p.x,p.z)+2.05,p.z);camera.updateMatrixWorld(true);
          sun.target.position.set(p.x,r.buElevation(p.x,p.z),p.z);sun.position.copy(sun.target.position).add(new THREE.Vector3(...light.offset));sun.target.updateMatrixWorld(true);
          assets.update(camera.position,0);assets.model.updateMatrixWorld(true);await renderer.compileAsync(scene,camera);renderer.render(scene,camera);
          const doors=[];train.traverse(o=>{if(o.isMesh&&o.userData.dynamicDoor)doors.push(o.position.z);});
          const geometry=[];for(const part of train.children){const {x,y,z}=part.position;geometry.push({part:part.name,position:part.position.toArray(),trackClearance:y-r.buElevation(x,z)});}
          const glError=renderer.getContext().getError(),direction=new THREE.Vector3();camera.getWorldDirection(direction);
          const nearObstacle=assets.collision.distance(camera.position,direction,3)??null;
          return{png:renderer.domElement.toDataURL('image/png'),state,doors,geometry,curveDistance,elapsed:r.elapsed,camera:camera.position.toArray(),nearObstacle,calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,glError,programs:(renderer.info.programs??[]).map(p=>({runnable:p.diagnostics?.runnable??null,log:p.diagnostics?.programLog??''}))};
        },frame);
        const {png,...stats}=result,file=`${quality}-${frame.id}.png`;await writeFile(`${directory}/${file}`,Buffer.from(png.split(',')[1],'base64'));report.views.push({quality,...frame,file,...stats});
        check(`${quality}/${frame.id}: shader and track clearance`,result.glError===0&&result.programs.every(p=>p.runnable!==false)&&result.geometry.every(p=>Number.isFinite(p.trackClearance)&&p.trackClearance>=.191),stats);
        check(`${quality}/${frame.id}: camera is clear of nearby walls`,result.nearObstacle===null,stats);
        if(frame.mode==='initial'||frame.mode==='station')check(`${quality}/${frame.id}: stopped at platform with only platform-side doors open`,result.state.speed===0&&result.state.stationId===(frame.station??'place-bucen')&&result.doors.filter(z=>Math.abs(z)>.8).length===8&&result.doors.filter(z=>Math.abs(z)<.4).length===8,stats);
        else check(`${quality}/${frame.id}: moving with doors closed`,result.state.speed>0&&result.state.doors===0&&result.doors.every(z=>Math.abs(z)<.4),stats);
        console.log(JSON.stringify({quality,frame:frame.id,file,speed:result.state.speed,station:result.state.stationId,checks:report.checks.length}));
      }
      await page.evaluate(()=>{const r=window.greenReview;r.assets.dispose();r.renderer.dispose();r.renderer.domElement.remove();delete window.greenReview;});
    }catch(error){report.failures.push(`${quality}: ${String(error)}`);}finally{await context.close();}
  }
}finally{
  await browser.close();check('No browser errors',report.errors.length===0,report.errors);report.status=report.failures.length?'failed':'passed';report.completedAt=new Date().toISOString();await writeFile(`${directory}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,checks:report.checks.length,views:report.views.length,failures:report.failures,errors:report.errors}));
}
assert.equal(report.status,'passed','Green Line visual QA failed; see output/bu-green-line/report.json');
