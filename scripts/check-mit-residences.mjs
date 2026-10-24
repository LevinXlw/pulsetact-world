import {mkdir,writeFile} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {authenticateContext} from './test-auth.mjs';
const dir=process.env.MIT_REVIEW_DIR||'output/mit-residences-20261023',base='http://127.0.0.1:5186';
const report={profiles:[],errors:[],viewer:[],ui:[]};await mkdir(dir,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
try{
 for(const mobile of [false,true]){
  const ctx=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:960},isMobile:mobile,hasTouch:mobile});await authenticateContext(ctx,base);const page=await ctx.newPage();page.setDefaultTimeout(120000);page.on('pageerror',e=>report.errors.push(e.message));
  await page.route('**/mit-residence-check',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><link rel="icon" href="data:,">'}));await page.goto(`${base}/mit-residence-check`);
  const result=await page.evaluate(async mobile=>{
   const {Vector3}=await import('/node_modules/three/build/three.module.js'),{loadWorldAssets}=await import('/src/features/world/scene-assets.ts'),{MIT_RESIDENCE_WALK_ROUTES,MIT_RESIDENCE_PLACES,MIT_BAKER_NORTH_ARRIVAL}=await import('/src/features/world/mit-residence-layout.ts'),{RIVER_WALK_ROUTE,isWalkableWorld,isCharlesWater}=await import('/src/features/world/charles-geography.ts'),{navigationGuide}=await import('/src/features/world/world-destinations.ts');
   const assets=await loadWorldAssets(new AbortController().signal,'boston',mobile),failures=[],origin=new Vector3(),direction=new Vector3();let samples=0;
   function check(a,b,label){samples++;const ay=assets.collision.groundHeight(...a),by=assets.collision.groundHeight(...b);if(ay===undefined||by===undefined||Math.abs(by-ay)>.68){failures.push({label,reason:'ground',a,b,ay,by});return false;}
    if(!isWalkableWorld(...b)||isCharlesWater(...b)){failures.push({label,reason:'boundary',b});return false;}origin.set(a[0],ay+.9,a[1]);direction.set(b[0]-a[0],0,b[1]-a[1]);const length=direction.length();direction.normalize();const obstacle=assets.collision.distance(origin,direction,length+.34);if(obstacle!==undefined){failures.push({label,reason:'wall',a,b,ay,obstacle});return false;}return true;
   }
   try{
    if(assets.model.userData.mitResidenceReplacement?.status!=='loaded')throw Error('Dorm replacement missing');
    for(const [index,route] of MIT_RESIDENCE_WALK_ROUTES.entries())for(const reverse of [false,true]){
     const path=reverse?[...route].reverse():route;let okay=true;for(let i=1;i<path.length&&okay;i++){const a=path[i-1],b=path[i],n=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/.35);let prev=a;for(let j=1;j<=n;j++){const p=[a[0]+(b[0]-a[0])*j/n,a[1]+(b[1]-a[1])*j/n];if(!check(prev,p,`route-${index}-${reverse}`)){okay=false;break;}prev=p;}}}
    const destinations=[RIVER_WALK_ROUTE[0],MIT_RESIDENCE_PLACES.maseeh,MIT_RESIDENCE_PLACES.baker,MIT_BAKER_NORTH_ARRIVAL];
    for(const [i,start] of destinations.entries())for(const [j,end] of destinations.entries())if(i!==j){let current=[...start];for(let k=0;k<6000&&Math.hypot(current[0]-end[0],current[1]-end[1])>.6;k++){const guide=navigationGuide(current,end),dx=guide.point[0]-current[0],dz=guide.point[1]-current[1],len=Math.hypot(dx,dz);if(!Number.isFinite(guide.distance)||len<1e-6){failures.push({reason:'guide',i,j,current});break;}const stride=Math.min(.35,len),next=[current[0]+dx/len*stride,current[1]+dz/len*stride];if(!check(current,next,`guide-${i}-${j}`))break;current=next;}if(Math.hypot(current[0]-end[0],current[1]-end[1])>.6&&!failures.some(f=>f.label===`guide-${i}-${j}`))failures.push({reason:'unfinished guide',i,j,current});}
    return {mobile,replacement:assets.model.userData.mitResidenceReplacement,samples,failures,points:destinations.map(p=>({xz:p,height:assets.collision.groundHeight(...p)}))};
   }finally{assets.dispose();}
  },mobile);report.profiles.push(result);console.log(JSON.stringify(result));await ctx.close();
 }
 if(!process.argv.includes('--navigation-only')){
  const ctx=await browser.newContext({viewport:{width:1440,height:960}});await authenticateContext(ctx,base);const page=await ctx.newPage();page.setDefaultTimeout(120000);page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(`${base}/${dir}/viewer.html`);
  for(const id of ['baker','maseeh'])for(const profile of ['full','mobile']){await page.locator(`[data-building="${id}"]`).click();await page.selectOption('#profile',profile);await page.waitForFunction(({id,profile})=>window.residenceViewer?.loaded&&window.residenceViewer.id===id&&window.residenceViewer.profile===profile,{id,profile});await page.screenshot({path:`${dir}/viewer-${id}-${profile}.png`});report.viewer.push({id,profile,loaded:true});}
  await page.goto(`${base}/${dir}/review.html`);await expect(page.locator('nav button')).toHaveCount(process.env.MIT_REVIEW_EXTENDED==='1'?12:process.env.MIT_REVIEW_CLOSEUPS==='1'?10:6);await page.screenshot({path:`${dir}/review-page.png`,fullPage:true});
  await page.goto(base);await page.getByLabel('旅途中，怎么称呼你？').fill('MIT 漫游检查');await page.getByRole('button',{name:/开始校园漫游|继续校园漫游/}).click();await page.waitForFunction(()=>window.__worldScene?.characterReady);
  for(const label of ['Maseeh Hall','Baker House','Baker · 北入口']){
   await page.getByRole('navigation',{name:'世界菜单'}).getByRole('button',{name:'地图',exact:true}).click();await page.getByRole('button',{name:'河岸与 BU',exact:true}).click();await page.getByRole('button',{name:`快速前往${label}`,exact:true}).click();await page.waitForTimeout(800);const state=await page.evaluate(()=>window.__worldScene);await page.screenshot({path:`${dir}/play-${label.includes('北入口')?'baker-entry':label.split(' ')[0].toLowerCase()}.png`});report.ui.push({place:label,position:state.position});
  }await ctx.close();
 }
 report.status=report.errors.length||report.profiles.some(p=>p.failures.length)?'failed':'passed';if(report.status==='failed')process.exitCode=1;
}catch(e){report.status='failed';report.errors.push(String(e));process.exitCode=1;}
finally{await browser.close();await writeFile(`${dir}/playable-check.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,errors:report.errors}));}
