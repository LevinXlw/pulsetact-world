import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from '@playwright/test';
import {authenticateContext} from './test-auth.mjs';

const base=process.env.WORLD_BASE_URL||'http://127.0.0.1:5186';
const directory=process.argv.find(value=>value.startsWith('--output='))?.slice(9)||process.env.STATA_REVIEW_DIR||'output/stata-full-20261022';
const report={base,startedAt:new Date().toISOString(),profiles:[],errors:[]};
const sourceFiles=['public/assets/mit-stata/stata-full.glb','public/assets/mit-stata/stata-mobile.glb','public/assets/mit-stata/campus-without-stata.glb','public/assets/mit-stata/boston-without-stata.glb','src/features/world/mit-stata-asset.ts','src/features/world/charles-geography.ts','src/features/world/world-destinations.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(sourceFiles.map(async file=>{const bytes=await readFile(file);return[file,{bytes:bytes.byteLength,sha256:createHash('sha256').update(bytes).digest('hex')}];})));
report.sources=await hashes();
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  for(const mobile of [false,true]){
    const context=await browser.newContext();await authenticateContext(context,base);
    const page=await context.newPage();page.setDefaultTimeout(120000);
    page.on('pageerror',error=>report.errors.push(error.message));
    await page.route('**/stata-navigation-check',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><link rel="icon" href="data:,"></head><body></body></html>'}));
    await page.goto(`${base}/stata-navigation-check`);
    const result=await page.evaluate(async mobile=>{
      const {Vector3}=await import('/node_modules/three/build/three.module.js');
      const {loadWorldAssets}=await import('/src/features/world/scene-assets.ts');
      const {MIT_STATA_PLACES,MIT_STATA_WALK_ROUTES,RIVER_WALK_ROUTE,isWalkableWorld,isCharlesWater}=await import('/src/features/world/charles-geography.ts');
      const {navigationGuide,WORLD_DESTINATIONS}=await import('/src/features/world/world-destinations.ts');
      const assets=await loadWorldAssets(new AbortController().signal,'boston',mobile);
      const failures=[],checks=[],origin=new Vector3(),direction=new Vector3();let samples=0;
      const verify=(a,b,label)=>{
        samples++;const ay=assets.collision.groundHeight(...a),by=assets.collision.groundHeight(...b);
        if(ay===undefined||by===undefined){failures.push({label,reason:'missing ground',a,b});return false;}
        if(Math.abs(by-ay)>.68){failures.push({label,reason:'ground step',a,b,ay,by});return false;}
        if(!isWalkableWorld(...b)||isCharlesWater(...b)){failures.push({label,reason:'walk boundary',b});return false;}
        origin.set(a[0],ay+.9,a[1]);direction.set(b[0]-a[0],0,b[1]-a[1]);const length=direction.length();direction.normalize();
        const obstacle=assets.collision.distance(origin,direction,length+.34);
        if(obstacle!==undefined){failures.push({label,reason:'wall',a,b,ay,obstacle});return false;}
        return true;
      };
      try{
        if(assets.model.userData.stataReplacement?.status!=='loaded')throw Error('Stata replacement did not load');
        for(const [routeIndex,route] of MIT_STATA_WALK_ROUTES.entries())for(const reverse of [false,true]){
          const path=reverse?[...route].reverse():route,label=`path ${routeIndex} ${reverse?'reverse':'forward'}`;let passed=true;
          for(let i=1;i<path.length&&passed;i++){
            const a=path[i-1],b=path[i],count=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/.35);let previous=a;
            for(let j=1;j<=count;j++){const point=[a[0]+(b[0]-a[0])*j/count,a[1]+(b[1]-a[1])*j/count];if(!verify(previous,point,label)){passed=false;break;}previous=point;}
          }
          checks.push({label,passed});
        }
        const points=[RIVER_WALK_ROUTE[0],MIT_STATA_PLACES.vassar,MIT_STATA_PLACES.west];
        for(let from=0;from<points.length;from++)for(let to=0;to<points.length;to++)if(from!==to){
          const destination=points[to],label=`guide ${from} -> ${to}`;let current=[...points[from]],passed=true,steps=0;
          for(;steps<7000&&Math.hypot(current[0]-destination[0],current[1]-destination[1])>.7;steps++){
            const guide=navigationGuide(current,destination),dx=guide.point[0]-current[0],dz=guide.point[1]-current[1],length=Math.hypot(dx,dz),stride=Math.min(.35,length);
            if(!Number.isFinite(guide.distance)||length<.00001){failures.push({label,reason:'disconnected guide',current,guide});passed=false;break;}
            const point=[current[0]+dx/length*stride,current[1]+dz/length*stride];
            if(!verify(current,point,label)){passed=false;break;}current=point;
          }
          const remaining=Math.hypot(current[0]-destination[0],current[1]-destination[1]);
          if(remaining>.7&&passed){failures.push({label,reason:'guide stalled',current,remaining});passed=false;}
          checks.push({label,passed,steps,remaining});
        }
        const destinations=WORLD_DESTINATIONS.filter(place=>place.id.startsWith('mit-stata')).map(place=>({id:place.id,position:place.position,lookAt:place.lookAt,height:assets.collision.groundHeight(...place.position),note:place.note}));
        return {profile:mobile?'mobile':'desktop',replacement:assets.model.userData.stataReplacement,samples,destinations,checks,failures};
      }finally{assets.dispose();}
    },mobile);
    report.profiles.push(result);console.log(JSON.stringify(result));await context.close();
  }
  if(JSON.stringify(report.sources)!==JSON.stringify(await hashes()))throw Error('Stata assets or navigation changed during verification.');
  report.status=report.errors.length||report.profiles.some(profile=>profile.failures.length)?'failed':'passed';
  if(report.status==='failed')process.exitCode=1;
}catch(error){report.status='failed';report.errors.push(String(error));process.exitCode=1;}
finally{await mkdir(directory,{recursive:true});await writeFile(`${directory}/navigation-check.json`,JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify({status:report.status,errors:report.errors}));}
