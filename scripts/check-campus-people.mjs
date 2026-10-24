import {chromium,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

// An isolated browser exercises the actual scene; it never uses the user's tabs
// or persistent profile. Run after generating public/assets/people/*.glb.
const output='docs/screenshots/campus-people';
const base=process.env.CAMBRIDGE_BASE_URL||'http://127.0.0.1:5173';
const saveKey='pulsetact:campus-explorer:save:v1';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
const contexts=[],checks=[],captures=[],errors=[],requests=[],modelRequests=[];
const context=await newContext(),page=await context.newPage();
let activePage=page,failure,reducedResult,assetFailureResult;
page.on('pageerror',error=>errors.push(error.message));
page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
page.on('request',request=>{
 requests.push(request.url());
 if(/\/assets\/people\/(nathan|sophia)\.glb(?:\?|$)/.test(request.url()))modelRequests.push(request.url());
});

async function newContext(options={}){
 const created=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1,...options});
 contexts.push(created);return created;
}
const state=(target=page)=>target.evaluate(()=>window.__localCampus);
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[2]-b[2]);
const person=(scene,id)=>scene.people.find(value=>value.person===id);
const player=scene=>scene.people.find(value=>value.person==='nathan'&&distance(value.position,scene.position)<.02);
function record(name,details){checks.push({name,passed:true,...details});console.log('Passed:',name);}
async function ready(target=page,count=2,mode){
 await expect(target.getByRole('button',{name:'拍照',exact:true})).toBeEnabled({timeout:90000});
 await target.waitForFunction(({count,mode})=>{
  const scene=window.__localCampus;
  return scene&&(!mode||scene.mode===mode)&&scene.people?.length===count&&scene.people.every(value=>value.ready&&Number.isFinite(value.time)&&value.position?.every(Number.isFinite));
 },{count,mode},{timeout:90000});
}
async function unpaused(target=page){
 await target.waitForFunction(()=>window.__localCampus?.people?.length&&window.__localCampus.people.every(value=>!value.paused));
}
async function capture(key,label,target=page,clean=false){
 await target.waitForTimeout(400);
 let style;
 if(clean)style=await target.addStyleTag({content:'.real-toolbar,.real-status,.courtyard-caption,.local-credit,.quest-hud{visibility:hidden!important}'});
 try{await target.locator('canvas').screenshot({path:`${output}/${key}.png`});}
 finally{if(style)await style.evaluate(element=>element.remove());}
 captures.push({key,label,scene:await state(target)});
}
function assertFrozen(before,after,label){
 assert.equal(after.people.length,before.people.length,`${label}: person count remains stable`);
 before.people.forEach((value,index)=>{
  assert.equal(after.people[index].person,value.person,`${label}: person order remains stable`);
  assert.ok(Math.abs(after.people[index].time-value.time)<1e-6,`${label}: animation time stops`);
  assert.ok(distance(after.people[index].position,value.position)<1e-6,`${label}: world movement stops`);
 });
}

try{
 await page.goto(`${base}/real/mit`);await ready(page,2,'stroll');
 const initial=await state();
 assert.deepEqual(initial.people.map(value=>value.person).sort(),['nathan','sophia']);
 assert.match(person(initial,'nathan').clip,/walk/i);assert.match(person(initial,'sophia').clip,/idle/i);
 await capture('01-default','Default environment stroll');
 const motionBefore=await state();await page.waitForTimeout(1100);const motionAfter=await state();
 assert.ok(distance(person(motionAfter,'nathan').position,person(motionBefore,'nathan').position)>.3,'Nathan walks through the scene');
 assert.ok(Math.abs(person(motionAfter,'sophia').time-person(motionBefore,'sophia').time)>.15,'Sophia idle animation advances');
 assert.ok(distance(person(motionAfter,'sophia').position,person(motionBefore,'sophia').position)<1e-6,'Sophia remains at her standing position');
 record('Two ambient people animate independently',{before:motionBefore.people,after:motionAfter.people});

 await page.getByRole('button',{name:'设置',exact:true}).click();
 await page.waitForFunction(()=>window.__localCampus?.people?.every(value=>value.paused));
 const paused=await state();await page.waitForTimeout(900);assertFrozen(paused,await state(),'Settings pause');
 await page.keyboard.press('Escape');await unpaused();
 const resumed=await state();await page.waitForTimeout(900);const resumeAfter=await state();
 assert.ok(distance(person(resumeAfter,'nathan').position,person(resumed,'nathan').position)>.25,'Nathan resumes his path');
 assert.ok(Math.abs(person(resumeAfter,'sophia').time-person(resumed,'sophia').time)>.15,'Sophia resumes her animation');
 record('Opening settings pauses both animation and movement; closing resumes both');

 await page.getByRole('button',{name:'设置',exact:true}).click();
 await page.getByRole('button',{name:'画质：标准',exact:true}).click();await page.keyboard.press('Escape');
 await page.waitForFunction(()=>window.__localCampus?.quality==='low');await ready(page,2);await unpaused();
 await capture('02-low-quality','Both people in low quality');record('Low quality keeps both realistic characters');
 await page.getByRole('button',{name:'设置',exact:true}).click();
 await page.getByRole('button',{name:'画质：省电',exact:true}).click();await page.keyboard.press('Escape');
 await page.waitForFunction(()=>window.__localCampus?.quality==='standard');

 await page.getByRole('button',{name:'机位',exact:true}).click();
 await page.getByRole('button',{name:'人物近景',exact:true}).click();await ready(page,2,'orbit');
 await capture('03-people-close','People close-up',page,true);
 record('People close-up camera opens with both models');

 await page.getByRole('button',{name:'角色探索',exact:true}).click();await ready(page,3,'walk');await unpaused();
 const story=await state();
 assert.deepEqual(story.people.map(value=>value.person).sort(),['nathan','nathan','sophia']);
 assert.ok(player(story),'A Nathan model occupies the controlled player position');
 assert.match(player(story).clip,/idle/i);
 await capture('04-story','Player and story NPCs');
 await page.locator('canvas').click();await page.keyboard.press('e');
 await expect(page.getByRole('dialog')).toBeVisible();
 await expect(page.getByRole('dialog')).toContainText('虚构学生角色');
 await page.locator('.choices button').first().click();await page.locator('.choices button').first().click();
 await expect(page.getByText('再聊一个话题',{exact:true})).toBeVisible();
 await page.screenshot({path:`${output}/05-story-dialogue.png`});
 record('E opens the first NPC dialogue and a reply completes the interaction',{dialogue:await page.getByRole('dialog').getAttribute('aria-label')});
 await page.keyboard.press('Escape');await unpaused();

 const playerBefore=await state();
 await page.keyboard.down('s');
 try{
  await page.waitForFunction(()=>{
   const scene=window.__localCampus;
   const actor=scene?.people?.find(value=>value.person==='nathan'&&Math.hypot(value.position[0]-scene.position[0],value.position[2]-scene.position[2])<.02);
   return actor&&/walk/i.test(actor.clip);
  },null,{timeout:10000});
  await page.waitForTimeout(650);
  const moving=await state();assert.ok(distance(moving.position,playerBefore.position)>.15,'Walking input moves the player');
  record('Player movement selects the Walk clip',{actor:player(moving)});
 }finally{await page.keyboard.up('s');}
 await page.waitForFunction(()=>{
  const scene=window.__localCampus;
  const actor=scene?.people?.find(value=>value.person==='nathan'&&Math.hypot(value.position[0]-scene.position[0],value.position[2]-scene.position[2])<.02);
  return actor&&/idle/i.test(actor.clip);
 },null,{timeout:10000});
 record('Releasing movement returns the player to Idle');

 for(let index=0;index<2;index++){
  await page.getByRole('button',{name:'环境漫步',exact:true}).click();await ready(page,2,'stroll');
  await page.getByRole('button',{name:'角色探索',exact:true}).click();await ready(page,3,'walk');
 }
 assert.equal(modelRequests.filter(url=>url.includes('/nathan.glb')).length,1,'Nathan is downloaded once across all mode changes');
 assert.equal(modelRequests.filter(url=>url.includes('/sophia.glb')).length,1,'Sophia is downloaded once across all mode changes');
 assert.ok(requests.every(url=>!/^https?:/.test(url)||new URL(url).origin===new URL(base).origin),'Scene resources remain local');
 assert.deepEqual(errors,[],'Primary scene has no browser runtime or console errors');
 record('Mode changes reuse the two cached local assets',{modelRequests});

 // Use a copied save only in a fresh test context to exercise the real persisted
 // accessibility setting without changing the developer's own browser data.
 const storageState=await context.storageState();
 const saved=storageState.origins.flatMap(origin=>origin.localStorage).find(entry=>entry.name===saveKey);
 assert.ok(saved,'Story progress creates a valid save for the reduced-motion fixture');
 const save=JSON.parse(saved.value);save.settings.reducedMotion=true;saved.value=JSON.stringify(save);
 await context.close();
 const reducedContext=await newContext({storageState}),reducedPage=await reducedContext.newPage();activePage=reducedPage;
 const reducedErrors=[];reducedPage.on('pageerror',error=>reducedErrors.push(error.message));
 await reducedPage.goto(`${base}/real/mit`);await ready(reducedPage,2,'stroll');
 await reducedPage.waitForFunction(()=>window.__localCampus?.people?.every(value=>value.reduced));
 const reducedBefore=await state(reducedPage);await reducedPage.waitForTimeout(900);reducedResult=await state(reducedPage);
 assertFrozen(reducedBefore,reducedResult,'Reduced motion');assert.match(person(reducedResult,'nathan').clip,/idle/i);
 assert.deepEqual(reducedErrors,[]);await capture('06-reduced-motion','Reduced motion uses a standing pose',reducedPage);
 record('Reduced motion holds grounded standing and idle poses');await reducedContext.close();

 const failedContext=await newContext(),failedPage=await failedContext.newPage();activePage=failedPage;
 const failureErrors=[],blocked=[];failedPage.on('pageerror',error=>failureErrors.push(error.message));
 await failedPage.route('**/assets/people/nathan.glb',async route=>{
  blocked.push(route.request().url());await route.fulfill({status:503,contentType:'text/plain',body:'Intentional QA failure'});
 });
 await failedPage.goto(`${base}/real/mit`);await ready(failedPage,1,'stroll');
 assetFailureResult=await state(failedPage);
 assert.ok(blocked.length>0,'The Nathan asset failure was actually injected');
 assert.equal(assetFailureResult.people[0].person,'sophia','The other person still loads');
 await expect(failedPage.locator('canvas')).toBeVisible();await expect(failedPage.locator('.local-map')).toHaveCount(0);
 assert.deepEqual(failureErrors,[],'A failed person asset does not throw an unhandled page error');
 const survivingTime=assetFailureResult.people[0].time;await failedPage.waitForTimeout(800);
 assert.ok(Math.abs((await state(failedPage)).people[0].time-survivingTime)>.1,'The surviving person keeps animating');
 await capture('07-person-load-failure','One missing person leaves the 3D scene usable',failedPage);
 record('A missing person asset preserves the 3D scene and the other person',{blocked});
}catch(error){
 failure={message:error.message,stack:error.stack,scene:await state(activePage).catch(()=>null)};
 console.error(error.message);process.exitCode=1;
 await activePage.screenshot({path:`${output}/failure.png`}).catch(()=>{});
}finally{
 await writeFile(`${output}/report.json`,JSON.stringify({checkedAt:new Date().toISOString(),base,checks,captures,modelRequests,errors,reducedResult,assetFailureResult,failure,note:'Isolated headless Chrome checks of the development scene. Screenshots require human review; model grounding and conversion metadata are checked separately.'},null,2));
 await Promise.allSettled(contexts.map(value=>value.close()));await browser.close();
}
