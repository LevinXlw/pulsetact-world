import {mkdir,writeFile} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {authenticateContext} from './test-auth.mjs';
const dir=process.env.BU_COMM_REVIEW_DIR||'output/bu-comm-ave-20261024',base=process.env.WORLD_BASE_URL||'http://127.0.0.1:5186';
await mkdir(dir,{recursive:true});const report={profiles:[],errors:[],ui:[]};
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
try{
 for(const mobile of [false,true]){
  const context=await browser.newContext({viewport:{width:1440,height:900},isMobile:mobile,hasTouch:mobile});await authenticateContext(context,base);const page=await context.newPage();page.setDefaultTimeout(180000);page.on('pageerror',e=>report.errors.push(e.message));
  await page.route('**/bu-comm-ave-check',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><link rel="icon" href="data:,">'}));await page.goto(`${base}/bu-comm-ave-check`);
  const result=await page.evaluate(async mobile=>{
   const {Vector3}=await import('/node_modules/three/build/three.module.js');
   const {loadWorldAssets}=await import('/src/features/world/scene-assets.ts');
   const {BU_CAS_CLEAR_WALK,BU_CAS_ENTRY_GAPS,buCASPointAt,buCASFrameAt}=await import('/src/features/world/bu-comm-ave-landscape-layout.ts');
   const {BU_TRANSIT_PLATFORM_DETAILS}=await import('/src/features/world/bu-public-realm.ts');
   const {WORLD_DESTINATIONS,navigationGuide}=await import('/src/features/world/world-destinations.ts');
   const {BU_WARREN_ENTRY,BU_WARREN_FRONT,buWarrenPoint,buWarrenCurbDepth}=await import('/src/features/world/bu-warren-streetscape-layout.ts');
   const {BU_SERT_LINK_ENTRY,buSertPoint}=await import('/src/features/world/bu-sert-layout.ts');
   const assets=await loadWorldAssets(new AbortController().signal,'boston',mobile),failures=[],origin=new Vector3(),direction=new Vector3();let samples=0;
   function check(a,b,label){samples++;const ay=assets.collision.groundHeight(...a),by=assets.collision.groundHeight(...b);if(ay===undefined||by===undefined||Math.abs(ay-by)>.55){failures.push({reason:'ground',label,a,b,ay,by});return false;}origin.set(a[0],ay+.9,a[1]);direction.set(b[0]-a[0],0,b[1]-a[1]);const reach=direction.length()+.30;direction.normalize();const hit=assets.collision.distance(origin,direction,reach);if(hit!==undefined){failures.push({reason:'wall',label,a,b,hit});return false;}return true;}
   function path(points,label){let okay=true;for(let i=1;i<points.length&&okay;i++){const a=points[i-1],b=points[i],n=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/.3);let prev=a;for(let j=1;j<=n;j++){const p=[a[0]+(b[0]-a[0])*j/n,a[1]+(b[1]-a[1])*j/n];if(!check(prev,p,label)){okay=false;break;}prev=p;}}}
   try{
    for(const reverse of [false,true])path(reverse?[...BU_CAS_CLEAR_WALK].reverse():BU_CAS_CLEAR_WALK,`CAS-walk-${reverse}`);
    for(const [a,b] of BU_CAS_ENTRY_GAPS){const x=(a+b)/2,f=buCASFrameAt(x);path([buCASPointAt(x,1.9),buCASPointAt(x,Math.min(9,f.depth-1))],`CAS-entry-${x}`);}
    const warrenWalk=[];for(let s=12;s<BU_WARREN_FRONT.length-12;s+=2)warrenWalk.push(buWarrenPoint(s,buWarrenCurbDepth(s)-2.8));
    path(warrenWalk,'Warren-continuous-frontage');path([...warrenWalk].reverse(),'Warren-frontage-return');
    for(const offset of [-2,0,2])path([buWarrenPoint(BU_WARREN_ENTRY.along+offset,5),buWarrenPoint(BU_WARREN_ENTRY.along+offset,.65)],`Warren-door-approach-${offset}`);
    path([BU_SERT_LINK_ENTRY.arrival,buSertPoint(BU_SERT_LINK_ENTRY.local[0],BU_SERT_LINK_ENTRY.local[1]+.75)],'GSU-link-door');
    for(const s of BU_TRANSIT_PLATFORM_DETAILS)for(const side of [-1,1]){
     const offset=s.platformOffset*side,point=t=>[s.position[0]+s.nx*offset+s.dx*t,s.position[1]+s.nz*offset+s.dz*t];
     path([point(-s.platformLength/2-3),point(s.platformLength/2+3)],`platform-${s.name}-${side}`);
    }
    const places=WORLD_DESTINATIONS.filter(p=>['bu-marsh','bu-warren','bu-cds','bu-gsu'].includes(p.id));
    for(const [i,start] of places.entries())for(const [j,end] of places.entries())if(i!==j){let current=[...start.position];const label=`guide-${start.id}-${end.id}`;for(let step=0;step<8000&&Math.hypot(current[0]-end.position[0],current[1]-end.position[1])>.7;step++){
     const guide=navigationGuide(current,end.position),dx=guide.point[0]-current[0],dz=guide.point[1]-current[1],len=Math.hypot(dx,dz);if(!Number.isFinite(guide.distance)||len<1e-5){failures.push({reason:'guide',label,current});break;}const stride=Math.min(.35,len),next=[current[0]+dx/len*stride,current[1]+dz/len*stride];if(!check(current,next,label))break;current=next;
    }if(Math.hypot(current[0]-end.position[0],current[1]-end.position[1])>.7&&!failures.some(f=>f.label===label))failures.push({reason:'not-arrived',label,current});}
    const stationGroups=[],landscapes=[],nameplates=[];assets.model.traverse(o=>{if(o.name==='BU · Green Line platform architecture')stationGroups.push(o);if(o.name==='BU CAS · granite planters and recessed benches')landscapes.push(o);if(o.userData.buTransitNameplate)nameplates.push(o);});
    if(stationGroups.length!==1||landscapes.length!==1||nameplates.length!==20)failures.push({reason:'duplicated-or-missing-detail',stationGroups:stationGroups.length,landscapes:landscapes.length,nameplates:nameplates.length});
    const glass=[];assets.model.traverse(o=>{if(o.isMesh){const m=o.material;if(m?.userData?.buFrontageGlazing)glass.push({mesh:o,material:m});}});
    if(glass.length<3)failures.push({reason:'frontage-glazing-not-restored',count:glass.length});
    for(const low of [false,true]){assets.setQuality(low);if(glass.some(g=>g.mesh.material!==g.material))failures.push({reason:'quality-replaced-frontage-glazing',low});
      if(mobile&&!low){for(const finish of ['pavingBrick','pavingConcrete']){const paving=assets.model.getObjectByName(`BU Warren frontage · ${finish}`);if(!paving?.material.customProgramCacheKey().includes(`mobile-hd-${finish}`))failures.push({reason:'Warren-mobile-HD-finish-missing',finish});}}}
    if(mobile){assets.model.traverse(o=>{if(!o.isMesh||!o.userData.mobileGround)return;const m=o.material,layer=m.userData.buGroundLayer;if(layer==='surface'&&m.polygonOffset||layer==='terrain'&&m.polygonOffsetFactor<=0)failures.push({reason:'lost-ground-layer',name:o.name,layer});});}
    return{mobile,samples,failures,frontageGlassMeshes:glass.length,stationDetail:stationGroups[0]?.userData,trees:assets.model.getObjectByName('BU CAS · branching street trees')?.userData.stats};
   }finally{assets.dispose();assets.dispose();}
  },mobile);report.profiles.push(result);console.log(JSON.stringify(result));await context.close();
 }
 const context=await browser.newContext({viewport:{width:1440,height:900}});await authenticateContext(context,base);const page=await context.newPage();page.setDefaultTimeout(180000);page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto(`${base}/${dir}/review.html`);await expect(page.locator('nav button')).toHaveCount(8);await page.waitForFunction(()=>[...document.querySelectorAll('.grid img')].every(i=>i.complete&&i.naturalWidth>0));await page.screenshot({path:`${dir}/review-page.png`});
 await page.goto(base);await page.getByLabel('旅途中，怎么称呼你？').fill('Comm Ave 街景检查');await page.getByRole('button',{name:/开始校园漫游|继续校园漫游/}).click();await page.waitForFunction(()=>window.__worldScene?.characterReady);
 for(const name of ['Warren Towers','Marsh Plaza','George Sherman Union']){
  await page.getByRole('navigation',{name:'世界菜单'}).getByRole('button',{name:'地图',exact:true}).click();await page.getByRole('button',{name:'河岸与 BU',exact:true}).click();await page.getByRole('button',{name:`快速前往${name}`,exact:true}).click();await page.waitForTimeout(1000);await expect(page.locator('.pw-scene-error')).toHaveCount(0);await page.screenshot({path:`${dir}/play-${name.split(' ')[0].toLowerCase()}.png`});report.ui.push({name,state:await page.evaluate(()=>window.__worldScene)});
 }await context.close();report.status=report.errors.length||report.profiles.some(p=>p.failures.length)?'failed':'passed';if(report.status==='failed')process.exitCode=1;
}catch(e){report.status='failed';report.errors.push(String(e));process.exitCode=1;}finally{await writeFile(`${dir}/playable-check.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,errors:report.errors}));await browser.close();}
