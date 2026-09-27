import {chromium} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 async function talk(){await page.keyboard.press('e');const dialog=page.getByRole('dialog');await dialog.waitFor();await dialog.locator('.choices button').first().click();await dialog.locator('.choices button').first().click();await dialog.getByRole('button',{name:'继续探索',exact:true}).click();}
 async function walkTo(target,range){
  await page.locator('canvas').click();let held=[];
  try { for(let n=0;n<220;n++){
   const s=await page.evaluate(()=>window.__localCampus),dx=target[0]-s.position[0],dz=target[1]-s.position[2];if(Math.hypot(dx,dz)<range)return;
   const [fx,,fz]=s.cameraForward,len=Math.hypot(fx,fz),f=(dx*fx+dz*fz)/len,r=(-dx*fz+dz*fx)/len;
   const keys=['Shift'];if(Math.abs(f)>Math.hypot(dx,dz)*.35)keys.push(f>0?'w':'s');if(Math.abs(r)>Math.hypot(dx,dz)*.35)keys.push(r>0?'d':'a');
   for(const k of held)if(!keys.includes(k))await page.keyboard.up(k);for(const k of keys)if(!held.includes(k))await page.keyboard.down(k);held=keys;await page.waitForTimeout(200);
  }console.log('STUCK',target,await page.evaluate(()=>window.__localCampus));await page.screenshot({path:'docs/screenshots/story-stuck.png'});throw new Error('Could not reach story target with real keyboard movement');} finally {for(const k of held)await page.keyboard.up(k);}
 }
 if(process.argv.includes('--bridge-only')){
  await page.goto('http://127.0.0.1:5173/real/mit');await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent?.trim()==='拍照'&&!b.disabled));
  await page.getByRole('button',{name:'角色漫游',exact:true}).click();await page.waitForFunction(()=>window.__localCampus?.mode==='walk');
  const detail=JSON.parse(await readFile('public/data/killian/detail-manifest.json','utf8')),env=JSON.parse(await readFile('public/data/killian/environment.json','utf8')),o=detail.porticoOpening,b=env.bridge;
  const at=(u,s)=>[o.center[0]+o.normal[2]*u+o.normal[0]*s,o.center[2]-o.normal[0]*u+o.normal[2]*s];
  const along=z=>[b.start[0]+(b.end[0]-b.start[0])/(b.end[1]-b.start[1])*(z-b.start[1]),z];
  for(const point of [at(0,129.5),at(0,174),...[-20,-40,-60,-80,-100,-120,-140,-155].map(u=>at(u,174)),...[192,198,204,210,216,222,228,236].map(along),...Array.from({length:15},(_,i)=>along(244+i*8))])await walkTo(point,1.5);
  const position=await page.evaluate(()=>window.__localCampus.position);assert.ok(Math.abs(position[1]-b.deckHeight)<.2,'bridge deck supports the avatar');
  await page.screenshot({path:'docs/screenshots/mit-bridge-walk.png'});console.log('MIT: bridge reached from campus and deck traversed with keyboard');
 }
 for(const id of process.argv.includes('--bridge-only')?[]:['mit','harvard']){
  const data=JSON.parse(await readFile(`public/data/campuses/${id}/manifest.json`,'utf8')),goal=data.points[id==='mit'?'mit-dome':'harvard-widener'];
  await page.goto(`http://127.0.0.1:5173/real/${id}`);await page.getByRole('button',{name:'拍照',exact:true}).waitFor();await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent?.trim()==='拍照'&&!b.disabled));
  await page.getByRole('button',{name:'角色漫游',exact:true}).click();await page.locator('canvas').click();await talk();
  assert.match(await page.locator('.quest-hud').innerText(),/带着问题/);
  await walkTo(goal,8);await page.keyboard.press('e');await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');
  assert.match(await page.locator('.quest-hud').innerText(),/分享/);
  await walkTo([goal[0]+5,goal[1]+3],3.8);await talk();
  assert.match(await page.locator('.quest-hud').innerText(),/故事已完成/);
  if(id==='mit'){
   const detail=JSON.parse(await readFile('public/data/killian/detail-manifest.json','utf8')),o=detail.porticoOpening;
   // Approach the central gap from outside; a straight diagonal from the NPC crosses a column.
   await walkTo([o.center[0]+o.normal[0]*9,o.center[2]+o.normal[2]*9],.7);
   await walkTo([o.center[0]+o.normal[0]*2,o.center[2]+o.normal[2]*2],.7);
   const p=await page.evaluate(()=>window.__localCampus.position);assert.ok(Math.abs(p[1]-detail.platformHeight)<.2,'character climbs the entrance steps onto the portico landing');
   console.log('MIT: entrance steps and raised landing reached with keyboard');
   if(process.argv.includes('--courts')){
    const at=(u,s)=>[o.center[0]+o.normal[2]*u+o.normal[0]*s,o.center[2]-o.normal[0]*u+o.normal[2]*s];
    for(const [u,s] of [[0,9],[0,129.5],[-86,129.5],[0,129.5],[86,129.5]])await walkTo(at(u,s),1.5);
    await page.screenshot({path:'docs/screenshots/mit-side-courts-walk.png'});
    console.log('MIT: both side courts reached from the central path with keyboard');
    if(process.argv.includes('--bridge')){
     const env=JSON.parse(await readFile('public/data/killian/environment.json','utf8')),b=env.bridge;
     const approach=[192,198,204,210,216,222,228,236].map(z=>[b.start[0]+(b.end[0]-b.start[0])/(b.end[1]-b.start[1])*(z-b.start[1]),z]);
     const deck=Array.from({length:15},(_,i)=>{const z=244+i*8;return [b.start[0]+(b.end[0]-b.start[0])/(b.end[1]-b.start[1])*(z-b.start[1]),z];});
     for(const point of [at(0,129.5),at(0,174),...[-20,-40,-60,-80,-100,-120,-140,-155].map(u=>at(u,174)),...approach,...deck])await walkTo(point,1.5);
     const position=await page.evaluate(()=>window.__localCampus.position);assert.ok(Math.abs(position[1]-b.deckHeight)<.2,'bridge deck supports the avatar');
     await page.screenshot({path:'docs/screenshots/mit-bridge-walk.png'});console.log('MIT: bridge reached from campus and deck traversed with keyboard');
    }
   }
  }
  await page.screenshot({path:`docs/screenshots/story-${id}-complete.png`});
  await page.reload();await page.getByRole('button',{name:'角色漫游',exact:true}).click();await page.locator('.quest-hud').waitFor();assert.match(await page.locator('.quest-hud').innerText(),/故事已完成/);
  console.log(`${id}: full story completed with keyboard movement; progress survives reload`);
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
