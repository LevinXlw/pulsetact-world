import {mkdir,writeFile} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {createServer} from 'vite';
import {authenticateContext} from './test-auth.mjs';

const captureOnly=process.argv.includes('--capture-only');
const base=process.argv.find(arg=>/^https?:\/\//.test(arg))??'http://127.0.0.1:5186';
const vite=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,entries:[]},server:{middlewareMode:true,hmr:false,watch:null},appType:'custom',logLevel:'error'});
let geo,riverCore,destinations;
try{[geo,riverCore,destinations]=await Promise.all([
  vite.ssrLoadModule('/src/features/world/charles-geography.ts'),vite.ssrLoadModule('/src/features/world/bu-river-core-layout.ts'),vite.ssrLoadModule('/src/features/world/world-destinations.ts'),
]);}finally{await vite.close();}
const {BU_FOOTBRIDGE,HARVARD_BRIDGE,LANDMARKS,RIVER_WALK_ROUTE,SOUTH_RIVER_WALK,BU_STREET_ROUTE,distanceToSegment}=geo;
const {BU_SILBER_FOOTBRIDGE,BU_SILBER_RIVER_LINK}=riverCore;
const {WORLD_DESTINATIONS,BU_CAMPUS_ROUTE}=destinations;
const eastwardShore=[...SOUTH_RIVER_WALK].reverse(),junction=BU_SILBER_RIVER_LINK[0];
const connection=eastwardShore.slice(1).map((b,i)=>({i,distance:distanceToSegment(...junction,eastwardShore[i],b)})).sort((a,b)=>a.distance-b.distance)[0];
if(!connection||connection.distance>.2)throw new Error('Shared Silber Way branch is disconnected from the riverside path.');
const shoreToSilber=[...eastwardShore.slice(0,connection.i+1),junction];
if(process.argv.includes('--validate-only')){console.log(JSON.stringify({status:'route-data-valid',bayState:BU_FOOTBRIDGE.length,silber:BU_SILBER_FOOTBRIDGE.length,shore:shoreToSilber.length,beachToMarsh:BU_CAMPUS_ROUTE.length}));process.exit(0);}
const directory=captureOnly?'output/questrom-modeling/final':'output/questrom-modeling';await mkdir(directory,{recursive:true});
const report={base,captureOnly,checks:[],errors:[],views:[],routes:{bayState:BU_FOOTBRIDGE,silber:BU_SILBER_FOOTBRIDGE,shoreToSilber,beachToMarsh:BU_CAMPUS_ROUTE}};
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
const context=await browser.newContext({viewport:{width:1600,height:900}});
const page=await context.newPage();page.setDefaultTimeout(30_000);
page.on('pageerror',error=>report.errors.push(error.message));
page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
const scene=()=>page.evaluate(()=>window.__worldScene);
const check=(name)=>{report.checks.push(name);console.log(`PASS ${name}`);};
const save=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('pulsetact.world.solo.v1')));
async function ready(){
  await expect(page.locator('.pw-loading')).toHaveCount(0,{timeout:180_000});
  await expect(page.getByRole('button',{name:'拍照下载',exact:true})).toBeEnabled({timeout:180_000});
  await expect(page.locator('.pw-scene-error')).toHaveCount(0);
  await page.waitForFunction(()=>window.__worldScene?.characterReady,{},{timeout:30_000});
}
async function face(x,z){
  const state=await scene(),current=Math.atan2(state.cameraPosition[0]-state.position[0],state.cameraPosition[2]-state.position[2]),wanted=Math.atan2(state.position[0]-x,state.position[2]-z);
  let pixels=Math.atan2(Math.sin(current-wanted),Math.cos(current-wanted))/.004;
  while(Math.abs(pixels)>1){const step=Math.max(-300,Math.min(300,pixels));await page.mouse.move(800,450);await page.mouse.down();await page.mouse.move(800+step,450,{steps:8});await page.mouse.up();pixels-=step;}
  await page.waitForTimeout(500);
}
async function tilt(amount){
  await page.mouse.move(800,450);await page.mouse.down();await page.mouse.move(800,450-amount/.003,{steps:8});await page.mouse.up();await page.waitForTimeout(350);
}
async function walkTo(x,z){
  const from=(await scene()).position;if(Math.hypot(from[0]-x,from[2]-z)<.35)return;
  await face(x,z);await page.keyboard.down('w');const started=Date.now(),timeout=Math.max(30000,Math.hypot(from[0]-x,from[2]-z)*700);
  try{
    while(Date.now()-started<timeout){
      const position=(await scene()).position;
      if(Math.hypot(position[0]-x,position[2]-z)<.35)return;
      await page.waitForTimeout(60);
    }
    throw new Error(`Walking stopped short of ${x},${z}: ${JSON.stringify((await scene()).position)}`);
  }finally{await page.keyboard.up('w');await page.waitForTimeout(150);}
}
async function walkRoute(route){for(const [x,z] of route)await walkTo(x,z);}
async function capture(name){
  await page.waitForTimeout(900);await page.screenshot({path:`${directory}/${name}.png`});
  const png=await page.locator('canvas').evaluate(canvas=>canvas.toDataURL('image/png'));
  await writeFile(`${directory}/${name}-scene.png`,Buffer.from(png.split(',')[1],'base64'));
  report.views.push({name,...await scene()});console.log(`Captured ${name}`);
}
async function openMap(){await page.getByRole('navigation',{name:'世界菜单'}).getByRole('button',{name:'地图',exact:true}).click();await page.getByRole('button',{name:'河岸与 BU',exact:true}).click();await page.getByLabel('选择 BU 校园分区').selectOption('all');await expect(page.locator('.pw-river-destinations article')).toHaveCount(WORLD_DESTINATIONS.length);}
async function travel(name){
  const point=WORLD_DESTINATIONS.find(place=>place.title===name)?.position;if(!point)throw new Error(`Missing destination ${name}`);
  await openMap();await page.getByRole('button',{name:`快速前往${name}`,exact:true}).click();
  await ready();
  await page.waitForFunction(([x,z])=>Math.hypot(window.__worldScene.position[0]-x,window.__worldScene.position[2]-z)<1,point);
  await page.waitForTimeout(600);
}
async function stamp(id){
  await page.keyboard.press('e');await page.getByRole('button',{name:'记录这次到访',exact:true}).click();
  await expect.poll(async()=>(await save()).visitedPlaces).toContain(id);
}
try{
  await authenticateContext(context,base);await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.getByLabel('旅途中，怎么称呼你？').fill('沿河漫游');
  const enter=page.getByRole('button',{name:/开始校园漫游|继续校园漫游/});await expect(enter).toBeEnabled({timeout:180_000});await enter.click();await ready();
  const initialMitProgress=[...(await save()).visited];
  await capture('01-mit-entrance');
  await openMap();await page.screenshot({path:`${directory}/map.png`});await expect(page.getByRole('button',{name:'关闭面板',exact:true})).toBeInViewport();await page.getByRole('button',{name:'关闭面板',exact:true}).click();
  await travel('查尔斯河畔');await face(-680,740);await capture('02-charles-river');await stamp('charles');
  check('riverbank quick travel and visit stamp');
  if(!captureOnly){const start=RIVER_WALK_ROUTE.findIndex(p=>Math.hypot(p[0]-LANDMARKS.charles[0],p[1]-LANDMARKS.charles[1])<.01),end=RIVER_WALK_ROUTE.findIndex(p=>Math.hypot(p[0]-HARVARD_BRIDGE[0][0],p[1]-HARVARD_BRIDGE[0][1])<.01);await walkRoute(RIVER_WALK_ROUTE.slice(start+1,end+1));check('walk the shared MIT waterfront approach onto Harvard Bridge');}
  await travel('Harvard Bridge');await face(-1070,940);await capture('03-harvard-bridge');await stamp('harvard-bridge');
  const bridgeStart=(await scene()).position;await face(155,805);await page.keyboard.down('w');await page.waitForTimeout(1800);await page.keyboard.up('w');
  const bridgeAfter=(await scene()).position;expect(Math.hypot(bridgeAfter[0]-bridgeStart[0],bridgeAfter[2]-bridgeStart[2])).toBeGreaterThan(3);
  check('walk along bridge with continuous raised ground');
  await travel('BU Beach');await face(-1178,950);await tilt(.36);await capture('04-bu-beach');await stamp('bu-beach');await tilt(-.36);
  await face(-905,1009);await capture('05-bu-skyline');
  if(!captureOnly){await walkRoute([...BU_FOOTBRIDGE].reverse());check('walk current Bay State bridge switchbacks');await walkRoute(shoreToSilber);await walkRoute(BU_SILBER_RIVER_LINK);await walkRoute(BU_SILBER_FOOTBRIDGE);await capture('05b-silber-footbridge');check('walk riverside promenade and Silber Way bridge to campus');await travel('BU Beach');await walkRoute(BU_CAMPUS_ROUTE);check('walk current Beach-to-Marsh route through Law/Mugar courtyards');}else await travel('Marsh Plaza');
  await face(-1178,944);await tilt(.3);await capture('06-marsh-plaza');await stamp('bu-marsh');
  await tilt(-.3);await travel('Questrom 商学院');await stamp('bu-questrom');
  if(!captureOnly){await walkRoute(BU_STREET_ROUTE.slice(-2).reverse());await walkRoute(BU_STREET_ROUTE.slice(-2));}await face(-627.457,1062.434);await tilt(.28);await capture('07-questrom');
  check('Questrom quick travel, forecourt walking and fifth visit stamp');
  const before=(await scene()).position;await page.waitForTimeout(3300);await page.reload({waitUntil:'domcontentloaded'});await ready();
  const restored=(await scene()).position;expect(Math.hypot(restored[0]-before[0],restored[2]-before[2])).toBeLessThan(.6);
  expect((await save()).visitedPlaces.slice().sort()).toEqual(['charles','harvard-bridge','bu-beach','bu-marsh','bu-questrom'].sort());expect((await save()).visited).toEqual(initialMitProgress);
  check('Questrom checkpoint and five stamps survive reload without changing MIT quest progress');
  await page.getByRole('navigation',{name:'场景工具'}).getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'标准',exact:true}).click();await ready();
  await face(-627.457,1062.434);await tilt(.28);await capture('08-questrom-low');expect((await scene()).quality).toBe('low');check('BU low quality renders');
  await page.setViewportSize({width:390,height:844});await openMap();await page.screenshot({path:`${directory}/09-mobile-map.png`});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)).toBeTruthy();await expect(page.getByRole('button',{name:'关闭面板',exact:true})).toBeInViewport();check('mobile regional map stays within viewport');
  expect(report.errors).toEqual([]);report.status='passed';
}catch(error){report.status='failed';report.error=String(error);console.error(error);await page.screenshot({path:`${directory}/failure.png`}).catch(()=>{});process.exitCode=1;}
finally{await writeFile(`${directory}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));await browser.close();}
