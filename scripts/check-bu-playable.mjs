import {mkdir,writeFile} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {createServer} from 'vite';
import {authenticateContext} from './test-auth.mjs';
const base=process.argv.find(arg=>/^https?:\/\//.test(arg))??'http://127.0.0.1:5186',production=new URL(base).hostname==='world.pulsetact.ai',mobile=process.argv.includes('--mobile');
const directory=process.env.BU_PLAYABLE_DIRECTORY??`output/bu-full-campus/${production?'production':'local'}${mobile?'-mobile':''}`;await mkdir(directory,{recursive:true});
const vite=await createServer({server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true,include:[],entries:[]},appType:'custom',logLevel:'error'});
const {WORLD_DESTINATIONS}=await vite.ssrLoadModule('/src/features/world/world-destinations.ts');
const {buNavigationBlocked}=await vite.ssrLoadModule('/src/features/world/bu-campus-layout.ts');await vite.close();
const places=WORLD_DESTINATIONS.filter(p=>p.id.startsWith('bu-'));
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
const context=await browser.newContext(mobile?{viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true}:{viewport:{width:1600,height:1000}});await authenticateContext(context,base);
await context.addInitScript(()=>{
 if(!localStorage.getItem('pulsetact.world.solo.v1'))localStorage.setItem('pulsetact.world.solo.v1',JSON.stringify({version:1,campus:'boston',position:[-980.657,1095.065],visited:['axis'],visitedPlaces:['bu-marsh','bu-questrom'],campusVisits:['umd-library'],photos:2,quality:'standard',trackedId:'bu-marsh'}));
});
const page=await context.newPage(),report={checks:[],errors:[],views:[]};page.setDefaultTimeout(30000);
page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/WebGLProgram|VALIDATE_STATUS|shader error|GL_INVALID|Context Lost/i.test(m.text()))report.errors.push(m.text());});
const save=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('pulsetact.world.solo.v1')));
const map=()=>page.getByRole('navigation',{name:'世界菜单'}).getByRole('button',{name:'地图',exact:true}).click();
const check=name=>{report.checks.push(name);console.log(`PASS ${name}`);};
async function ready(){await expect(page.locator('.pw-loading')).toHaveCount(0,{timeout:180000});await expect(page.getByRole('button',{name:'拍照下载',exact:true})).toBeEnabled({timeout:180000});await expect(page.locator('.pw-scene-error')).toHaveCount(0);}
async function capture(name){await page.waitForTimeout(650);await page.screenshot({path:`${directory}/${name}.png`});report.views.push({name,scene:await page.evaluate(()=>window.__worldScene)});}
async function recordVisit(place){
 if((await save()).visitedPlaces.includes(place.id))return;
 if(place.id==='bu-cds'){
   // The real CDS door takes priority over the stamp panel and records entry.
   const enter=page.getByTestId('enter-cds-interior');await expect(enter).toBeEnabled();
   if(mobile)await enter.tap();else await page.keyboard.press('e');
   await expect(page.getByTestId('cds-interior-visit')).toBeVisible({timeout:180000});
   await expect(page.locator('.cds-visit-loading')).toHaveCount(0,{timeout:180000});
   await expect(page.locator('.cds-visit-error')).toHaveCount(0);
   await expect(page.locator('.cds-visit-scene canvas')).toBeVisible();
   await expect(page.locator('.pw-scene canvas')).toHaveCount(0);
   await expect.poll(async()=>(await save()).visitedPlaces.includes(place.id),{timeout:15000}).toBe(true);
   const exit=page.locator('.cds-visit-interact');await expect(exit).toContainText('开门离开');await expect(exit).toBeEnabled();
   if(mobile)await exit.tap();else await page.keyboard.press('e');
   await ready();await expect(page.getByTestId('cds-interior-visit')).toHaveCount(0);
   await expect.poll(async()=>(await save()).visitedPlaces.includes(place.id),{timeout:15000}).toBe(true);
   check('CDS door entry records the visit and returns to the campus');
 }else{
   if(mobile)await page.locator('.pw-interaction').tap();else await page.keyboard.press('e');
   const stamp=page.getByRole('button',{name:'记录这次到访',exact:true});await expect(stamp).toBeVisible();await stamp.click();
   await expect.poll(async()=>(await save()).visitedPlaces.includes(place.id),{timeout:15000}).toBe(true);
 }
}
try{
 await page.goto(base,{waitUntil:'domcontentloaded'});const enter=page.getByRole('button',{name:/开始校园漫游|继续校园漫游/});await expect(enter).toBeEnabled({timeout:180000});await page.getByLabel('旅途中，怎么称呼你？').fill('BU 漫游检查');await enter.click();await ready();
 expect((await save()).visited).toEqual(['axis']);expect((await save()).campusVisits).toEqual(['umd-library']);check('legacy Boston save and other-campus history retained');
 await expect.poll(async()=>buNavigationBlocked(...(await save()).position),{timeout:15000}).toBe(false);check('old checkpoint inside Warren Towers moves to a safe arrival');
 await map();await expect(page.locator('.pw-river-destinations article')).toHaveCount(WORLD_DESTINATIONS.length);await capture('01-whole-campus-map');
 await page.getByLabel('选择 BU 校园分区').selectOption('west');await capture('02-west-campus-map');
 await page.getByLabel('搜索 BU 建筑或地点').fill('Agganis');await expect(page.getByRole('button',{name:/查看 BU 建筑.*Agganis/}).first()).toBeVisible();await page.getByRole('button',{name:/查看 BU 建筑.*Agganis/}).first().click();await capture('03-building-search');
 for(const query of ['CDS','Booth','Marciano','Rajen']){await page.getByLabel('搜索 BU 建筑或地点').fill(query);await expect(page.getByRole('button',{name:new RegExp(`查看 BU 建筑.*${query}`)}).first()).toBeVisible();}
 await page.getByLabel('搜索 BU 建筑或地点').fill('no-such-campus-building');await expect(page.getByText(/没有找到匹配地点/)).toBeVisible();
 await page.getByLabel('选择 BU 校园分区').selectOption('all');await page.getByRole('button',{name:'关闭面板',exact:true}).click();check('district selection, building search and empty state work');
 for(const p of places){
   await map();await page.getByLabel('选择 BU 校园分区').selectOption('all');await page.getByRole('button',{name:`快速前往${p.title}`,exact:true}).click();await ready();await expect(page.locator('.pw-location')).toContainText('BOSTON UNIVERSITY');
   await expect.poll(async()=>{const point=(await save()).position;return Math.hypot(point[0]-p.position[0],point[1]-p.position[1]);},{timeout:15000}).toBeLessThan(1);
   await capture(p.id);await recordVisit(p);console.log(`Visited ${p.id}`);
 }
 expect((await save()).visitedPlaces.filter(id=>id.startsWith('bu-'))).toHaveLength(places.length);check(`all ${places.length} BU destinations load and can be recorded`);
 await map();await page.getByRole('button',{name:'快速前往Agganis Arena',exact:true}).click();await ready();
 const before=(await save()).position;
 if(mobile){const box=await page.getByRole('navigation',{name:'移动方向'}).getByRole('button',{name:'向后',exact:true}).boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.waitForTimeout(2000);await page.mouse.up();}
 else{await page.keyboard.down('s');await page.waitForTimeout(2000);await page.keyboard.up('s');}
 await page.waitForTimeout(3200);const after=(await save()).position;
 expect(Math.hypot(after[0]-before[0],after[1]-before[1])).toBeGreaterThan(2);check(`${mobile?'direction-pad':'keyboard'} movement works on West Campus`);
 if(mobile){
   await page.getByRole('navigation',{name:'场景工具'}).getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'切换高清材质',exact:true}).click();await ready();
   await expect.poll(async()=>(await save()).quality).toBe('standard');await capture('mobile-bu-hd');check('BU supports opting into HD after mobile entry');
   await map();await page.getByRole('button',{name:'快速前往Mugar Memorial Library',exact:true}).click();await ready();
   await capture('mobile-gsu-link-hd');check('shared Link arrival renders its brick paving and concrete in mobile HD');
   for(const [title,id] of [['Duan 数据科学中心','cds'],['Bay State Road','bay-state']]){
     await map();await page.getByRole('button',{name:`快速前往${title}`,exact:true}).click();await ready();await capture(`mobile-${id}-hd`);
   }
   check('CDS street-level glazing and Bay State entrances render after the HD switch');
 }
 await page.reload({waitUntil:'domcontentloaded'});
 if(mobile){await expect(enter).toBeEnabled({timeout:180000});await expect(page.locator('.pw-scene canvas')).toHaveCount(0);await enter.click();}
 await ready();expect((await save()).visitedPlaces.filter(id=>id.startsWith('bu-'))).toHaveLength(places.length);expect((await save()).campusVisits).toEqual(['umd-library']);check('new BU visits survive refresh');
 if(mobile){expect((await save()).quality).toBe('low');check('mobile reload safely starts in low quality');}
 await page.setViewportSize({width:390,height:844});await map();await page.getByLabel('选择 BU 校园分区').selectOption('west');await capture('mobile-west-map');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);check('mobile map fits the viewport');
 expect(report.errors).toEqual([]);report.status='passed';
}catch(e){report.status='failed';report.error=String(e);await page.screenshot({path:`${directory}/failure.png`}).catch(()=>{});process.exitCode=1;}
finally{await writeFile(`${directory}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,checks:report.checks,error:report.error,errors:report.errors}));await browser.close();}
