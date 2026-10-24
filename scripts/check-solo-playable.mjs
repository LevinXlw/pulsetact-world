import {mkdir,writeFile} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {authenticateContext} from './test-auth.mjs';

const directory='output/solo-playable';
await mkdir(directory,{recursive:true});
const report={startedAt:new Date().toISOString(),checks:[],errors:[],worldRequests:[]};
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
const context=await browser.newContext({viewport:{width:1440,height:960},hasTouch:true});
await authenticateContext(context);
// Make every multiplayer endpoint unavailable throughout the entire journey.
await context.route('**/api/world/**',route=>{report.worldRequests.push(route.request().url());return route.abort();});
const page=await context.newPage();page.setDefaultTimeout(20_000);
page.on('pageerror',error=>report.errors.push(error.message));
const scene=()=>page.evaluate(()=>window.__worldScene);
const record=(name,details={})=>{report.checks.push({name,...details});console.log(`PASS ${name}`);};
const shot=async name=>{await page.locator('.pw-panel').evaluateAll(elements=>Promise.all(elements.flatMap(element=>element.getAnimations().map(animation=>animation.finished.catch(()=>{})))));await page.screenshot({path:`${directory}/${name}`,fullPage:true});};
const dock=name=>page.getByRole('navigation',{name:'世界菜单'}).getByRole('button',{name,exact:true});
const close=()=>page.getByRole('button',{name:'关闭面板',exact:true}).click();
const save=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('pulsetact.world.solo.v1')));

async function face(x,z){
  const state=await scene();
  const current=Math.atan2(state.cameraPosition[0]-state.position[0],state.cameraPosition[2]-state.position[2]);
  const wanted=Math.atan2(state.position[0]-x,state.position[2]-z);
  let pixels=Math.atan2(Math.sin(current-wanted),Math.cos(current-wanted))/.004;
  while(Math.abs(pixels)>1){
    const step=Math.max(-350,Math.min(350,pixels));
    await page.mouse.move(720,500);await page.mouse.down();await page.mouse.move(720+step,500,{steps:8});await page.mouse.up();pixels-=step;
  }
  await page.waitForFunction(wanted=>{const s=window.__worldScene;const angle=Math.atan2(s.cameraPosition[0]-s.position[0],s.cameraPosition[2]-s.position[2]);return Math.abs(Math.atan2(Math.sin(angle-wanted),Math.cos(angle-wanted)))<.04;},wanted);
}
async function walk(x,z){
  await face(x,z);await page.keyboard.down('Shift');await page.keyboard.down('w');
  try{await page.waitForFunction(([x,z])=>{const p=window.__worldScene.position;return Math.hypot(p[0]-x,p[2]-z)<3.2;},[x,z],{timeout:24_000});}
  finally{await page.keyboard.up('w');await page.keyboard.up('Shift');}
}
async function setMirror(label,target){
  const slider=page.getByRole('slider',{name:`镜面 ${label}`,exact:true});await slider.scrollIntoViewIfNeeded();
  const box=await slider.boundingBox();await page.mouse.click(box.x+8+(box.width-16)*((target+80)/160),box.y+box.height/2);
  for(let index=0;index<20;index++){
    const value=Number(await slider.inputValue());if(value===target)return;
    await page.getByRole('button',{name:`${value<target?'顺':'逆'}时针转动镜面 ${label} 0.5 度`,exact:true}).click();
  }
  throw new Error(`Mirror ${label} not at ${target}`);
}
try{
  await page.goto('http://127.0.0.1:5186/?character=sakurada',{waitUntil:'domcontentloaded'});
  const enter=page.getByRole('button',{name:/开始校园漫游|继续校园漫游/});
  await expect(enter).toBeEnabled({timeout:90_000});
  await page.getByLabel('旅途中，怎么称呼你？').fill('独自漫游');await shot('01-entry.png');await enter.click();
  await page.waitForFunction(()=>window.__worldScene?.character==='sakurada'&&window.__worldScene.characterReady);
  await expect(page.getByRole('button',{name:'当前目标 庭院的中轴'})).toBeVisible();
  record('single player enters with selected character and no world service');
  const background=await context.newPage();await background.goto('http://127.0.0.1:5186/',{waitUntil:'domcontentloaded'});
  await expect(background.getByRole('button',{name:/开始校园漫游|继续校园漫游/})).toBeEnabled({timeout:90_000});
  await page.bringToFront();
  await dock('地图').click();await shot('02-local-map.png');await close();
  await walk(44,20);await page.keyboard.press('e');
  await expect(page.getByRole('heading',{name:'庭院的中轴',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'穹顶偏在庭院的一角',exact:true}).click();
  await expect(page.getByRole('button',{name:'记下这个发现'})).toBeDisabled();
  await page.getByRole('button',{name:'中央入口形成中轴，两翼在两侧展开',exact:true}).click();
  await page.getByRole('button',{name:'记下这个发现'}).click();
  await expect(page.getByRole('button',{name:'当前目标 穹顶留影'})).toBeVisible();
  record('walk to first discovery, observe and unlock next destination');
  await walk(28,-6);await face(-1.849,-67.139);
  await page.mouse.move(720,500);await page.mouse.down();await page.mouse.move(720,670,{steps:8});await page.mouse.up();
  await page.waitForFunction(()=>!window.__worldScene?.domeInFrame);
  const groundPhoto=page.waitForEvent('download');await page.getByRole('button',{name:'拍照下载',exact:true}).click();await groundPhoto;
  expect((await save()).photoSpots).not.toContain('dome');
  record('photo without dome in frame does not complete viewpoint task');
  await page.mouse.move(720,500);await page.mouse.down();await page.mouse.move(720,330,{steps:8});await page.mouse.up();
  await page.mouse.move(720,500);await page.mouse.down();await page.mouse.move(720,410,{steps:8});await page.mouse.up();
  await page.waitForFunction(()=>window.__worldScene?.domeInFrame);
  await shot('03-dome-view.png');
  const photo=page.waitForEvent('download');await page.getByRole('button',{name:'拍照下载',exact:true}).click();
  await (await photo).saveAs(`${directory}/04-dome-photo.png`);
  await expect.poll(async()=>(await save()).photoSpots).toContain('dome');
  record('actual viewpoint photo downloaded and discovery recorded');
  await walk(63.5,37.5);await page.keyboard.press('e');
  await page.getByRole('button',{name:'开始个人实验',exact:true}).click();
  await setMirror('A',-45);await page.getByRole('button',{name:'继续探索',exact:true}).click();
  await expect(page.getByRole('heading',{name:'发现光的约定',exact:true})).toBeVisible();
  await expect(page.locator('.optics-angle-readings')).toHaveCount(0);
  await page.getByRole('button',{name:'离开光学工坊',exact:true}).click();
  const before=(await scene()).position;
  // Repeat while an older preview tab remains open: both the scene and the
  // interaction UI must acknowledge the same restored workshop checkpoint.
  for(let attempt=0;attempt<3;attempt++){
    await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__worldScene?.characterReady);
    const after=(await scene()).position;
    expect(Math.hypot(after[0]-before[0],after[2]-before[2])).toBeLessThan(.6);
    await expect(page.locator('.pw-interaction')).toBeVisible();
  }
  await page.locator('.pw-interaction').click();
  await page.getByRole('button',{name:'继续我的实验',exact:true}).click();
  await expect(page.getByRole('heading',{name:'发现光的约定',exact:true})).toBeVisible();
  record('refresh restores position, character, discovery stamps and unfinished experiment');
  await page.getByRole('button',{name:'两角相等',exact:true}).click();
  await expect(page.locator('.optics-angle-readings')).toBeVisible();
  await page.getByRole('button',{name:'继续探索',exact:true}).click();
  await setMirror('A',-45);await setMirror('B',-45);await shot('05-solo-optics.png');
  await page.getByRole('button',{name:'记录这次发现',exact:true}).click();
  await page.getByRole('button',{name:'把发现带回庭院',exact:true}).click();
  await expect(page.getByRole('heading',{name:'MIT · 初访纪念',exact:true})).toBeVisible();await shot('06-complete-journal.png');
  expect((await save()).visited.sort()).toEqual(['axis','dome','optics']);
  record('all three single-player discoveries finish and award first-visit journal');await close();
  await background.bringToFront();
  await expect(background.getByRole('button',{name:/开始校园漫游|继续校园漫游/})).toBeEnabled();
  await background.getByRole('button',{name:/开始校园漫游|继续校园漫游/}).click();
  await expect(background.getByRole('button',{name:'探索进度 3/3',exact:true})).toBeVisible();
  await background.close();await page.bringToFront();
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__worldScene?.characterReady);
  await expect(page.getByRole('button',{name:'探索进度 3/3',exact:true})).toBeVisible();
  record('an older tab adopts latest progress and cannot overwrite completed discoveries');
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'标准',exact:true}).click();
  await page.getByRole('button',{name:'回到入口',exact:true}).click();
  await page.waitForFunction(()=>Math.hypot(window.__worldScene.position[0]-53.5,window.__worldScene.position[2]-52.5)<.5);
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__worldScene?.characterReady&&window.__worldScene?.quality==='low');
  expect((await save()).visited).toHaveLength(3);record('quality setting and entrance reset persist without losing discoveries');
  for(const viewport of [{width:390,height:844},{width:844,height:390},{width:768,height:1024}]){
    await page.setViewportSize(viewport);const forward=page.getByRole('button',{name:'向前',exact:true});await expect(forward).toBeVisible();
    const before=(await scene()).position;const box=await forward.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
    try{await page.waitForFunction(p=>{const n=window.__worldScene.position;return Math.hypot(n[0]-p[0],n[2]-p[2])>.7;},before,{timeout:6000});}finally{await page.mouse.up();}
    const layout=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,height:innerHeight,scrollHeight:document.documentElement.scrollHeight}));
    expect(layout.scrollWidth).toBeLessThanOrEqual(viewport.width+1);expect(layout.scrollHeight).toBeLessThanOrEqual(viewport.height+1);
    await shot(`07-touch-${viewport.width}.png`);record('touch controls move avatar and layout fits',{viewport});
  }
  expect(report.worldRequests).toEqual([]);expect(report.errors).toEqual([]);report.status='passed';
}catch(error){report.status='failed';report.failure=String(error.stack??error);report.scene=await scene().catch(()=>null);report.save=await save().catch(()=>null);console.error(report.failure);await shot('failure.png');process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();await writeFile(`${directory}/report.json`,JSON.stringify(report,null,2));await context.close();await browser.close();console.log(`Solo report: ${directory}/report.json`);}
