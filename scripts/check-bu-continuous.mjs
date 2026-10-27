import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {authenticateContext} from './test-auth.mjs';
const base=process.env.WORLD_BASE_URL||'http://127.0.0.1:5186';
const out=process.env.BU_CONTINUOUS_DIR||'output/bu-reality-20261026/continuous';
const startId=process.argv.find(arg=>arg.startsWith('--start='))?.slice(8)||'bu-gsu';
const low=process.argv.includes('--low'),viewport=low?{width:1100,height:700}:{width:1600,height:1000};
const waypointFile=process.argv.find(arg=>arg.startsWith('--waypoints='))?.slice(12);
const customGoals=waypointFile?JSON.parse(await readFile(waypointFile,'utf8')):[];
const routeIds=customGoals.length?customGoals.map(goal=>goal.id):process.argv.find(arg=>arg.startsWith('--legs='))?.slice(7).split(',')||['bu-mugar','bu-marsh','bu-warren','bu-cds','bu-questrom'];
await mkdir(out,{recursive:true});
const report={kind:'Complete game; one initial map transfer, then ordinary mouse orbit and WASD along the live navigation guide; custom inspection points use a clear final approach',quality:low?'low':'standard',viewport,legs:[],errors:[]};
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
let page;
try{
 const context=await browser.newContext({viewport,deviceScaleFactor:1});await authenticateContext(context,base);page=await context.newPage();page.setDefaultTimeout(180000);
 if(low)await context.addInitScript(()=>localStorage.setItem('pulsetact.world.solo.v1',JSON.stringify({version:1,campus:'boston',position:[-980.657,1095.065],visited:[],visitedPlaces:[],campusVisits:[],photos:0,quality:'low'})));
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/WebGL|shader|GL_INVALID|Context Lost/i.test(m.text()))report.errors.push(m.text());});
 await page.goto(base,{waitUntil:'domcontentloaded'});await page.getByLabel('旅途中，怎么称呼你？').fill('BU 连续步行');await page.getByRole('button',{name:/开始校园漫游|继续校园漫游/}).click();
 await page.waitForFunction(()=>window.__worldScene?.characterReady);
 await page.evaluate(async()=>{window.buWalk=await import('/src/features/world/world-destinations.ts');window.buWalkLayout=await import('/src/features/world/bu-campus-layout.ts');});
 await page.evaluate(goals=>{window.buWalkTargets=goals;},customGoals);
 const startTitle=await page.evaluate(id=>window.buWalk.WORLD_DESTINATIONS.find(place=>place.id===id)?.title,startId);
 if(!startTitle)throw Error('Unknown initial destination '+startId);
 await page.getByRole('navigation',{name:'世界菜单'}).getByRole('button',{name:'地图',exact:true}).click();
 const bu=page.getByRole('button',{name:'河岸与 BU',exact:true});if(await bu.isVisible())await bu.click();
 await page.getByRole('button',{name:`快速前往${startTitle}`,exact:true}).click();
 await page.waitForFunction(id=>{const p=window.__worldScene?.position,d=window.buWalk.WORLD_DESTINATIONS.find(place=>place.id===id)?.position;return p&&d&&Math.hypot(p[0]-d[0],p[2]-d[1])<2;},startId);
 await page.waitForTimeout(600);report.start=await page.evaluate(()=>window.__worldScene);report.startId=startId;await page.screenshot({path:`${out}/00-${startId.replace(/^bu-/,'')}.png`});
 for(const [index,id] of routeIds.entries()){
   const started=Date.now(),samples=[],leg={id,elapsedMs:0,samples,status:'walking'};report.legs.push(leg);let previous=null,stuck=0,lastLog=started;
   while(true){
     const state=await page.evaluate(id=>{
       const s=window.__worldScene,p=[s.position[0],s.position[2]],place=window.buWalkTargets.find(p=>p.id===id)||window.buWalk.WORLD_DESTINATIONS.find(p=>p.id===id);
       if(!place)throw Error(`Unknown destination ${id}`);
              const directDistance=Math.hypot(p[0]-place.position[0],p[1]-place.position[1]);
       // Arbitrary inspection waypoints are not registered graph endpoints.
       // Use ordinary input for their final clear approach instead of looping
       // around a projected navigation node. Runtime collision remains active.
       const clearApproach=window.buWalkTargets.length>0&&directDistance<14&&Array.from({length:Math.ceil(directDistance*2)+1},(_,i)=>{const t=i/Math.max(1,Math.ceil(directDistance*2));return !window.buWalkLayout.buNavigationBlocked(p[0]+(place.position[0]-p[0])*t,p[1]+(place.position[1]-p[1])*t);}).every(Boolean);
       const guide=clearApproach?{point:place.position,distance:directDistance,viaRoute:false,inspectionApproach:true}:window.buWalk.navigationGuide(p,place.position),dx=guide.point[0]-p[0],dz=guide.point[1]-p[1];
       return{position:s.position,quality:s.quality,frames:s.rendering?.frames,movementSpeed:s.movementSpeed,guide,distance:Math.hypot(p[0]-place.position[0],p[1]-place.position[1]),
         viewYaw:Math.atan2(s.cameraPosition[0]-p[0],s.cameraPosition[2]-p[1]),desiredYaw:Math.atan2(-dx,-dz),nextDistance:Math.hypot(dx,dz)};
     },id);
     leg.elapsedMs=Date.now()-started;leg.lastState=state;
     if(state.distance<1.2){Object.assign(leg,{arrival:state.position,status:'walked'});break;}
     if(Date.now()-started>300000)throw Error(`Walking timeout: ${id} ${JSON.stringify(state)}`);
     if(Date.now()-lastLog>30000){console.log(JSON.stringify({leg:id,elapsedMs:leg.elapsedMs,distance:state.distance,frames:state.frames,speed:state.movementSpeed}));lastLog=Date.now();}
     if(previous&&Math.hypot(state.position[0]-previous[0],state.position[2]-previous[2])<.025)stuck++;else stuck=0;
     if(stuck>14)throw Error(`Player blocked: ${id} ${JSON.stringify(state)}`);
     previous=state.position;
     const angle=Math.atan2(Math.sin(state.desiredYaw-state.viewYaw),Math.cos(state.desiredYaw-state.viewYaw));
     if(Math.abs(angle)>.035){
       await page.keyboard.up('w');await page.keyboard.up('Shift');
       const mx=viewport.width/2,my=viewport.height*.42;
       await page.mouse.move(mx,my);await page.mouse.down();await page.mouse.move(mx-angle/.004,my,{steps:4});await page.mouse.up();
       await page.waitForTimeout(160);
     }
     await page.keyboard.down('Shift');await page.keyboard.down('w');
     await page.waitForTimeout(Math.max(70,Math.min(450,state.nextDistance/7.2*550)));
     if(samples.length===0||Date.now()-samples.at(-1).time>1200)samples.push({time:Date.now(),position:state.position,distance:state.distance,frames:state.frames,movementSpeed:state.movementSpeed});
   }
   await page.keyboard.up('w');await page.keyboard.up('Shift');await page.waitForTimeout(300);
   await page.screenshot({path:`${out}/${String(index+1).padStart(2,'0')}-${id}.png`});
   console.log(JSON.stringify({leg:id,status:'walked',arrival:report.legs.at(-1).arrival}));
 }
 expect(report.errors).toEqual([]);report.status='passed';
}catch(error){report.status='failed';report.errors.push(String(error));process.exitCode=1;await page?.screenshot({path:`${out}/failure.png`}).catch(()=>{});}
finally{await page?.keyboard.up('w').catch(()=>{});await page?.keyboard.up('Shift').catch(()=>{});await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify({status:report.status,errors:report.errors}));}
