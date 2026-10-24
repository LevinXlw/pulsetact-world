import {mkdir,writeFile} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {authenticateContext} from './test-auth.mjs';

// Uses the nickname, map, actual door interaction, and real player controls. Inspector reads
// observe the result; no scene coordinates or saved position are injected.
const base=process.argv.find(arg=>/^https?:\/\//.test(arg))??'http://127.0.0.1:5186';
const mobile=process.argv.includes('--mobile'),stairs=process.argv.includes('--stairs');
const mode=mobile?'mobile':'desktop',directory=`output/cds-interior-playable-20261019/${mode}`;
const saveKey='pulsetact.world.solo.v1';
const report={mode,base,startedAt:new Date().toISOString(),status:'running',checks:[],errors:[],networkFailures:[],requests:[],responses:[],checkpoints:[],screenshots:[]};
await mkdir(directory,{recursive:true});
let browser,context,page,cdp,intentionalFailure=false;
const check=(name,details={})=>{report.checks.push({name,...details});console.log(`PASS ${mode}: ${name}`);};
const saved=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),saveKey);
const scene=()=>page.evaluate(()=>window.__worldScene??null);
const activate=locator=>mobile?locator.tap():locator.click();
const pause=ms=>page.waitForTimeout(ms);
const dist=(p,q)=>Math.hypot(p[0]-q[0],p[2]-q[2]);
async function exteriorReady(){
 await expect(page.getByRole('navigation',{name:'世界菜单',exact:true})).toBeVisible({timeout:180000});
 await expect(page.getByRole('button',{name:'拍照下载',exact:true})).toBeEnabled({timeout:180000});
 await expect(page.locator('.pw-loading')).toHaveCount(0,{timeout:180000});
 await page.waitForFunction(()=>window.__worldScene?.interior===null&&window.__worldScene?.characterReady,null,{timeout:180000});
 await expect(page.locator('.pw-scene canvas')).toHaveCount(1);
}
async function indoorReady(){
 await expect(page.getByTestId('cds-interior-visit')).toBeVisible({timeout:180000});
 await expect(page.locator('.cds-visit-loading')).toHaveCount(0,{timeout:180000});
 await expect(page.locator('.cds-visit-error')).toHaveCount(0);
 await page.waitForFunction(()=>window.__worldScene?.interior==='cds'&&window.__worldScene?.characterReady,null,{timeout:180000});
 await expect(page.locator('.cds-visit-scene canvas')).toHaveCount(1);
 await expect(page.locator('.pw-scene canvas')).toHaveCount(0);
 await expect(page.locator('canvas')).toHaveCount(1);
}
async function shot(name){
 await pause(900);await page.screenshot({path:`${directory}/${name}.png`});
 report.screenshots.push(`${name}.png`);report.checkpoints.push({name,scene:await scene(),save:await saved()});
 console.log(`SCREENSHOT ${directory}/${name}.png`);
}
async function openingFrame(name,inside,door='east'){
 const button=inside?page.locator('.cds-visit-interact'):page.getByTestId('enter-cds-interior');
 await expect(button).toHaveAttribute('data-phase','opening');
 await expect(button).toHaveAttribute('data-door',door);
 // Capture during the actual R3F hinge motion, before replacing the canvas.
 // The normal scene screenshot's 900 ms settling delay would miss this state.
 await pause(220);await expect(button).toHaveAttribute('data-phase','opening');
 await expect.poll(async()=>(await scene()).doorHinges?.filter(hinge=>hinge.name.includes(door)).every(hinge=>Math.abs(hinge.angle)>.02)).toBe(true);
 await expect(page.locator(inside?'.cds-visit-scene canvas':'.pw-scene canvas')).toHaveCount(1);
 await page.screenshot({path:`${directory}/${name}.png`,animations:'allow'});
 report.screenshots.push(`${name}.png`);report.checkpoints.push({name,door,phase:'opening',inside,scene:await scene()});
 check(`${inside?'interior':'exterior'} ${door} door remains visibly opening before scene transition`);
}
async function openInterior(frame){
 await expect(page.getByTestId('enter-cds-interior')).toBeEnabled();
 await expect(page.getByTestId('enter-cds-interior')).toContainText('开门进入');
 await activate(page.getByTestId('enter-cds-interior'));
 if(frame)await openingFrame(frame,false);
}
async function holdForward(milliseconds){
 if(mobile){
  const box=await page.getByRole('navigation',{name:'室内移动方向',exact:true}).getByRole('button',{name:'向前',exact:true}).boundingBox();
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2,id:1}]});
  await pause(milliseconds);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 }else{await page.keyboard.down('w');await pause(milliseconds);await page.keyboard.up('w');}
 await pause(150);
}
const wrap=value=>Math.atan2(Math.sin(value),Math.cos(value));
async function face(target){
 const current=await scene(),[x,,z]=current.position,[cx,,cz]=current.cameraPosition;
 let delta=-wrap(Math.atan2(x-target[0],z-target[1])-Math.atan2(cx-x,cz-z))/.004;
 const canvas=await page.locator('.cds-visit-scene canvas').boundingBox();
 while(Math.abs(delta)>1){
  const step=Math.max(-canvas.width*.5,Math.min(canvas.width*.5,delta));
  const sx=canvas.x+canvas.width*.5-step*.5,sy=canvas.y+canvas.height*.48;
  await page.mouse.move(sx,sy);await page.mouse.down();await page.mouse.move(sx+step,sy,{steps:10});await page.mouse.up();
  delta-=step;await pause(160);
 }
}
async function walkTo(target,tolerance=.22){
 let stuck=0,last=Infinity;
 for(let i=0;i<80;i++){
  const current=await scene(),distance=Math.hypot(current.position[0]-target[0],current.position[2]-target[1]);
  if(distance<tolerance)return current;
  if(distance>=last-.025)stuck++;else stuck=0;
  if(stuck>5)throw Error(`Player blocked approaching ${JSON.stringify(target)} at ${JSON.stringify(current.position)}`);
  last=distance;await face(target);await holdForward(Math.min(600,Math.max(70,(distance-tolerance*.5)/3.6*1000)));
 }
 throw Error(`Player did not reach ${JSON.stringify(target)}`);
}
try{
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 context=await browser.newContext(mobile?{viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true}:{viewport:{width:1500,height:960},deviceScaleFactor:1});
 await authenticateContext(context,base);page=await context.newPage();page.setDefaultTimeout(30000);
 if(mobile)cdp=await context.newCDPSession(page);
 page.on('pageerror',error=>report.errors.push(error.message));page.on('crash',()=>report.errors.push('Browser page crashed'));
 page.on('console',message=>{if(message.type()==='error'&&/WebGLProgram|VALIDATE_STATUS|shader error|GL_INVALID|Context Lost|WebGL context/i.test(message.text()))report.errors.push(message.text());});
 page.on('request',request=>report.requests.push({url:request.url(),stage:report.stage??'entry'}));
 page.on('response',response=>{if(/\.glb(?:\.gz)?(?:\?|$)/.test(response.url()))report.responses.push({url:response.url(),status:response.status()});if(response.status()>=400&&/\/assets\/|\/data\//.test(response.url())&&!intentionalFailure)report.networkFailures.push({url:response.url(),status:response.status()});});
 page.on('requestfailed',request=>{const error=request.failure()?.errorText??'Unknown';if(!intentionalFailure&&!/ERR_ABORTED|cancelled|canceled/i.test(error)&&/\/assets\/|\/data\//.test(request.url()))report.networkFailures.push({url:request.url(),error});});
 await page.goto(base,{waitUntil:'domcontentloaded'});
 await page.getByLabel('旅途中，怎么称呼你？',{exact:true}).fill(mobile?'CDS 室内手机':'CDS 室内游玩');
 await activate(page.getByRole('button',{name:/开始校园漫游|继续校园漫游/}));await exteriorReady();
 expect(report.requests.filter(r=>r.url.includes('/assets/bu-cds-interior/'))).toEqual([]);
 check('interior is not fetched before the player enters');
 await activate(page.getByRole('navigation',{name:'世界菜单',exact:true}).getByRole('button',{name:'地图',exact:true}));
 await activate(page.getByRole('button',{name:'河岸与 BU',exact:true}));
 await activate(page.getByRole('button',{name:'快速前往Duan 数据科学中心',exact:true}));await exteriorReady();
 await expect.poll(async()=>(await saved()).trackedId).toBe('bu-cds');
 await expect(page.getByTestId('enter-cds-interior')).toContainText('开门进入');
 await expect.poll(async()=>{const state=await scene(),checkpoint=(await saved()).position;return Math.hypot(state.position[0]-checkpoint[0],state.position[2]-checkpoint[1]);}).toBeLessThan(.1);
 const outside=(await scene()).position;report.outsideCheckpoint=outside;
 report.stage='interior';await openInterior('00-opening-door');await indoorReady();
 check('map travel reaches the east door and opening it enters one interior canvas');
 await expect(page.locator('.cds-visit-header').getByRole('button',{name:'返回校园',exact:true})).toHaveCount(0);
 const initial=(await scene()).position;await shot('01-entry');
 expect(report.responses.some(r=>r.url.includes(`/assets/bu-cds-interior/interior-${mode}.glb`)&&r.status===200)).toBe(true);
 const stored=(await saved()).position;expect(Math.hypot(stored[0]-outside[0],stored[1]-outside[2])).toBeLessThan(.1);
 check('entering preserves the outdoor save checkpoint',{outside,inside:initial});
 await holdForward(1200);
 const moved=(await scene()).position;expect(dist(moved,initial)).toBeGreaterThan(.7);
 check(`${mobile?'touch pad':'WASD'} moves the actual character`,{before:initial,after:moved});await shot('02-walking');
 if(stairs&&!mobile){
  await activate(page.getByRole('button',{name:'回到入口',exact:true}));
  await expect.poll(async()=>dist((await scene()).position,initial)).toBeLessThan(.1);
  await walkTo([31.2,16.8]);await walkTo([31.2,13.04]);await walkTo([30.05,13.04]);
  await walkTo([6.96,13.04]);await walkTo([5.92,13.04]);await walkTo([5.92,11]);
  const upper=await scene();expect(upper.position[1]).toBeCloseTo(5.6,1);
  check('keyboard walks the grand stair to the second floor',{position:upper.position});await shot('03-second-floor');
  await walkTo([5.92,13.04]);await walkTo([30.05,13.04]);await walkTo([31.2,13.04]);
  expect((await scene()).position[1]).toBeCloseTo(0,1);check('keyboard walks back down to the first floor');
 }
 if(mobile){
  await activate(page.getByRole('button',{name:'切换清晰画面',exact:true}));await indoorReady();
  await expect.poll(async()=>(await scene()).quality).toBe('standard');await shot('03-phone-clear');
  expect(report.requests.some(r=>/\/assets\/bu-cds\/cds-full\.glb/.test(r.url)||r.url.includes('/bu-cds-interior/interior-desktop.glb'))).toBe(false);
  check('phone clear mode remains on the mobile interior without desktop building assets');
  await activate(page.getByRole('button',{name:'切回省电画面',exact:true}));await indoorReady();
 }
 await activate(page.getByRole('button',{name:'回到入口',exact:true}));
 await expect.poll(async()=>dist((await scene()).position,initial)).toBeLessThan(.1);
 await expect(page.locator('.cds-visit-interact')).toContainText('开门离开');
 if(!mobile){
  const other=await context.newPage();
  await other.goto(`${base}/assets/bu-cds-interior/manifest.json`);
  await other.evaluate(key=>{
   const progress=JSON.parse(localStorage.getItem(key));
   progress.position=[57,60];progress.campusPositions={...progress.campusPositions,boston:[57,60]};
   progress.visitedPlaces=[...new Set([...progress.visitedPlaces,'bu-beach'])];
   localStorage.setItem(key,JSON.stringify(progress));
  },saveKey);
  await other.close();await page.bringToFront();await pause(300);
 }
 if(mobile)await activate(page.locator('.cds-visit-interact'));else await page.keyboard.press('e');
 await openingFrame('04-opening-exit',true);
 report.stage='returned';await exteriorReady();
 expect(dist((await scene()).position,outside)).toBeLessThan(.1);
 expect((await saved()).trackedId).toBe('bu-cds');
 if(!mobile){expect((await saved()).visitedPlaces).toContain('bu-beach');check('another tab may add progress but cannot move the interior return doorway');}
 check('return to entrance and exit restore the outdoor position and exploration record');await shot('04-returned-campus');
 // An explicit asset failure must remain escapable; abort only this one room.
 report.stage='failure';intentionalFailure=true;
 const failurePattern=`**/assets/bu-cds-interior/interior-${mode}.glb`;
 await page.route(failurePattern,route=>route.abort('failed'));
 await openInterior();await expect(page.locator('.cds-visit-error')).toBeVisible({timeout:60000});
 await expect(page.locator('.cds-visit-header').getByRole('button',{name:'返回校园',exact:true})).toBeEnabled();
 await expect(page.locator('canvas')).toHaveCount(0);await shot('05-load-failure');
 await activate(page.locator('.cds-visit-header').getByRole('button',{name:'返回校园',exact:true}));
 await exteriorReady();await page.unroute(failurePattern);intentionalFailure=false;
 expect(dist((await scene()).position,outside)).toBeLessThan(.1);
 check('failed room load disposes its canvas and returns safely to the saved campus position');
 report.stage='reentry';await openInterior();await indoorReady();await shot('06-reentered');
 check('a subsequent entry recovers after an asset load failure');
 if(!mobile){
  await walkTo([37.2,16.818]);
  await expect(page.locator('.cds-visit-interact')).toHaveCount(0);
  await page.keyboard.press('e');await pause(300);
  await expect(page.getByTestId('cds-interior-visit')).toBeVisible();
  check('E in the middle of the facade cannot trigger a doorway');
  await walkTo([30.2,16.818]);await walkTo([30.2,18.5],.12);
  await expect(page.locator('.cds-visit-interact')).toHaveAttribute('data-door','west');
  await holdForward(600);
  await expect(page.locator('.cds-visit-interact')).toHaveAttribute('data-door','west');
  expect((await scene()).position[2]).toBeLessThanOrEqual(18.71);
  check('closed west glass door stops the body and keeps the prompt visible up close');
  await page.keyboard.press('e');await openingFrame('07-west-exit',true,'west');await exteriorReady();
  await expect(page.getByTestId('enter-cds-interior')).toHaveAttribute('data-door','west');
  expect(dist((await scene()).position,outside)).toBeCloseTo(14,1);
  check('leaving through the west door returns outside that same west door');
  await openInterior();await indoorReady();
  expect((await scene()).position[0]).toBeCloseTo(30.2,2);
  await shot('08-west-entry');check('entering through the west door spawns at the matching interior door');
 }
 await expect(page.locator('.cds-visit-interact')).toContainText('开门离开');
 await activate(page.locator('.cds-visit-interact'));await exteriorReady();
 expect(report.errors).toEqual([]);expect(report.networkFailures).toEqual([]);
 check('no unexpected page, WebGL, crash, or asset errors');report.status='passed';
}catch(error){report.status='failed';report.failure=String(error);process.exitCode=1;await page?.screenshot({path:`${directory}/failure.png`}).catch(()=>{});if(page)report.failedScene=await scene().catch(()=>null);}
finally{report.finishedAt=new Date().toISOString();await writeFile(`${directory}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({mode,status:report.status,checks:report.checks,failure:report.failure,failedScene:report.failedScene,errors:report.errors}));await browser?.close();}
