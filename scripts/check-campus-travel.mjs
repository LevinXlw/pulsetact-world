import {mkdir,writeFile} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {authenticateContext} from './test-auth.mjs';

const directory='output/campus-travel';await mkdir(directory,{recursive:true});
const report={checks:[],errors:[],views:[],worldRequests:[],dataRequests:[]};
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
const context=await browser.newContext({viewport:{width:1600,height:900}});
await authenticateContext(context);
await context.route('**/api/world/**',route=>{report.worldRequests.push(route.request().url());return route.abort();});
await context.addInitScript(()=>{
  if(localStorage.getItem('pulsetact.world.solo.v1'))return;
  // A pre-expansion v1 save must migrate without losing original progress.
  localStorage.setItem('pulsetact.world.solo.v1',JSON.stringify({version:1,visited:['axis'],visitedPlaces:['bu-beach','bu-questrom'],photoSpots:[],photos:2,quality:'standard',trackedId:'bu-questrom',position:[-632,1098],lesson:{stage:1,mirrorA:-45,mirrorB:0,prediction:null}}));
});
const page=await context.newPage();page.setDefaultTimeout(30000);
page.on('pageerror',error=>report.errors.push(error.message));
page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
page.on('request',request=>{if(request.url().includes('/data/'))report.dataRequests.push(request.url());});
const scene=()=>page.evaluate(()=>window.__worldScene);
const save=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('pulsetact.world.solo.v1')));
const check=name=>{report.checks.push(name);console.log(`PASS ${name}`);};
const close=()=>page.getByRole('button',{name:'关闭面板',exact:true}).click();
const map=()=>page.getByRole('navigation',{name:'世界菜单'}).getByRole('button',{name:'地图',exact:true}).click();
async function ready(campus){
  await page.waitForFunction(c=>window.__worldScene?.campusId===c&&window.__worldScene.characterReady,campus,{timeout:90000});
  await expect(page.locator('.pw-loading')).toHaveCount(0,{timeout:90000});
  await expect.poll(async()=>(await save()).campus,{timeout:15000}).toBe(campus);
}
async function face(x,z){
  const s=await scene(),current=Math.atan2(s.cameraPosition[0]-s.position[0],s.cameraPosition[2]-s.position[2]),wanted=Math.atan2(s.position[0]-x,s.position[2]-z);
  let pixels=Math.atan2(Math.sin(current-wanted),Math.cos(current-wanted))/.004;
  while(Math.abs(pixels)>1){const step=Math.max(-300,Math.min(300,pixels));await page.mouse.move(800,450);await page.mouse.down();await page.mouse.move(800+step,450,{steps:8});await page.mouse.up();pixels-=step;}
  await page.waitForTimeout(300);
}
async function tilt(amount){await page.mouse.move(800,450);await page.mouse.down();await page.mouse.move(800,450-amount/.003,{steps:8});await page.mouse.up();await page.waitForTimeout(250);}
async function walk(x,z){
  await face(x,z);await page.keyboard.down('Shift');await page.keyboard.down('w');
  try{await page.waitForFunction(([x,z])=>{const p=window.__worldScene?.position;return p&&Math.hypot(p[0]-x,p[2]-z)<1.1;},[x,z],{timeout:60000});}
  finally{await page.keyboard.up('w');await page.keyboard.up('Shift');await page.waitForTimeout(200);}
}
async function capture(name){
  await page.waitForTimeout(700);await page.screenshot({path:`${directory}/${name}.png`});
  const png=await page.locator('canvas').evaluate(canvas=>canvas.toDataURL('image/png'));
  await writeFile(`${directory}/${name}-scene.png`,Buffer.from(png.split(',')[1],'base64'));
  report.views.push({name,...await scene()});console.log(`Captured ${name}`);
}
async function change(campus,label){await map();await page.getByRole('button',{name:'校园旅行',exact:true}).click();await page.getByRole('button',{name:`前往 ${label}`,exact:true}).click();await ready(campus);}
async function stamp(id){await page.keyboard.press('e');await page.getByRole('button',{name:'记录这次到访',exact:true}).click();await expect.poll(async()=>(await save()).campusVisits).toContain(id);}
async function travel(name){await map();await page.getByRole('button',{name:`快速前往${name}`,exact:true}).click();await expect(page.locator('.pw-interaction')).toBeVisible();await page.waitForTimeout(300);}
try{
  await page.goto('http://127.0.0.1:5186/',{waitUntil:'domcontentloaded'});
  const enter=page.getByRole('button',{name:/开始校园漫游|继续校园漫游/});await expect(enter).toBeEnabled({timeout:90000});
  await page.getByLabel('旅途中，怎么称呼你？').fill('校园旅行');await enter.click();await ready('boston');
  expect((await save()).visited).toEqual(['axis']);expect((await save()).visitedPlaces).toEqual(['bu-beach','bu-questrom']);
  await walk(-620,1127);await face(-627.457,1062.434);await tilt(.28);await capture('01-questrom-refined');
  const bostonCheckpoint=(await scene()).position;
  await map();await page.getByRole('button',{name:'校园旅行',exact:true}).click();
  await page.screenshot({path:`${directory}/02-campus-atlas.png`});
  await page.getByRole('button',{name:'前往 UMD',exact:true}).click();await ready('umd');
  await face(-160,0);await tilt(.22);await capture('03-maryland-library');await stamp('umd-library');
  check('legacy Boston save survives campus switch and UMD visit');
  await tilt(-.22);await walk(-84,14);check('UMD library approach supports actual keyboard walking');
  await face(-160,0);await tilt(.22);await capture('03b-maryland-library-wide');await tilt(-.22);
  await travel('McKeldin Mall');await stamp('umd-mall');await face(14,0);await tilt(.10);await capture('04-maryland-mall');
  await tilt(-.10);await walk(72,14);await walk(110,14);await stamp('umd-administration');await face(160,0);await tilt(.23);await capture('05-maryland-administration');
  check('UMD mall to administration walk, three visit records and fountain route');
  const marylandCheckpoint=(await scene()).position;
  await page.waitForTimeout(3300);const beforeReload=report.dataRequests.length;
  await page.reload({waitUntil:'domcontentloaded'});await ready('umd');
  const restored=(await scene()).position;expect(Math.hypot(restored[0]-marylandCheckpoint[0],restored[2]-marylandCheckpoint[2])).toBeLessThan(.6);
  expect(report.dataRequests.slice(beforeReload).some(url=>url.includes('/data/campuses/mit')||url.includes('/data/killian/'))).toBe(false);
  check('UMD reload restores campus and position without loading Boston geometry');
  const older=await context.newPage();await older.goto('http://127.0.0.1:5186/',{waitUntil:'domcontentloaded'});await expect(older.getByRole('button',{name:/开始校园漫游|继续校园漫游/})).toBeEnabled({timeout:90000});await page.bringToFront();
  await change('upenn','UPenn');
  await older.bringToFront();await older.waitForFunction(()=>window.__worldScene?.campusId==='upenn'&&window.__worldScene.characterReady,undefined,{timeout:90000});
  expect((await save()).campus).toBe('upenn');await older.close();await page.bringToFront();
  check('older tab adopts new campus without overwriting its checkpoint');
  await face(-23,65);await tilt(.19);await capture('06-penn-college-green');await stamp('penn-green');
  await tilt(-.19);await walk(-23,29);await stamp('penn-college');await face(-23,65);await tilt(.30);await capture('07-penn-college-hall');
  await tilt(-.30);await walk(58,29);await walk(61,11);await stamp('penn-fisher');await face(95,11);await tilt(.28);await capture('08-penn-fisher');
  check('Penn College Green, College Hall and Fisher paths are walkable and record all visits');
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'拍照下载',exact:true}).click();await (await download).saveAs(`${directory}/09-penn-photo.png`);
  expect((await save()).visited).toEqual(['axis']);expect((await save()).photoSpots).toEqual([]);
  expect((await save()).visitedPlaces).toEqual(['bu-beach','bu-questrom']);expect((await save()).campusVisits).toHaveLength(6);
  check('regional photos and visits do not complete unrelated MIT discoveries');
  const pennCheckpoint=(await scene()).position;await page.waitForTimeout(3300);await page.reload({waitUntil:'domcontentloaded'});await ready('upenn');
  expect(Math.hypot((await scene()).position[0]-pennCheckpoint[0],(await scene()).position[2]-pennCheckpoint[2])).toBeLessThan(.6);
  check('Penn campus and all six new visits survive refresh');
  await change('umd','UMD');expect(Math.hypot((await scene()).position[0]-marylandCheckpoint[0],(await scene()).position[2]-marylandCheckpoint[2])).toBeLessThan(.6);
  await change('boston','Boston');expect((await save()).visited).toEqual(['axis']);expect((await save()).visitedPlaces).toEqual(['bu-beach','bu-questrom']);expect(Math.hypot((await scene()).position[0]-bostonCheckpoint[0],(await scene()).position[2]-bostonCheckpoint[2])).toBeLessThan(.6);
  check('round trip returns to separate UMD and Boston checkpoints');
  await change('upenn','UPenn');await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'标准',exact:true}).click();await close();
  await face(95,11);await tilt(.28);await capture('10-penn-low');expect((await scene()).quality).toBe('low');check('new campus supports low quality rendering');
  await page.setViewportSize({width:390,height:844});await map();await page.getByRole('button',{name:'校园旅行',exact:true}).click();await page.screenshot({path:`${directory}/11-mobile-campus-travel.png`});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)).toBe(true);await expect(page.getByRole('button',{name:'关闭面板',exact:true})).toBeInViewport();
  await page.getByRole('button',{name:'前往 UMD',exact:true}).click();await ready('umd');await map();await page.screenshot({path:`${directory}/12-mobile-maryland-map.png`});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)).toBe(true);await expect(page.getByRole('button',{name:'关闭面板',exact:true})).toBeInViewport();await close();
  const mobileStart=(await scene()).position;const forward=page.getByRole('button',{name:'向前',exact:true});const box=await forward.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.waitForTimeout(1000);await page.mouse.up();
  expect(Math.hypot((await scene()).position[0]-mobileStart[0],(await scene()).position[2]-mobileStart[2])).toBeGreaterThan(1);
  check('mobile campus switch, map layout and touch movement');
  await page.setViewportSize({width:1600,height:900});
  await page.getByRole('navigation',{name:'世界菜单'}).getByRole('button',{name:'工坊',exact:true}).click();
  await page.getByRole('button',{name:'前往 MIT 工坊',exact:false}).click();await ready('boston');
  const atWorkshop=(await scene()).position;expect(Math.hypot(atWorkshop[0]-63.5,atWorkshop[2]-37.5)).toBeGreaterThan(2.3);
  await expect(page.locator('.pw-interaction')).toContainText('光的路径');await walk(63.5,46);
  expect((await save()).lesson.stage).toBe(1);check('return from another campus to MIT workshop lands clear of table and can walk away');
  expect(report.worldRequests).toEqual([]);expect(report.errors).toEqual([]);report.status='passed';
}catch(error){report.status='failed';report.error=String(error);console.error(error);await page.screenshot({path:`${directory}/failure.png`}).catch(()=>{});process.exitCode=1;}
finally{await writeFile(`${directory}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,checks:report.checks,errors:report.errors,error:report.error}));await browser.close();}
