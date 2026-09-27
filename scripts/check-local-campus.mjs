import {chromium} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:process.env.CAMPUS_BROWSER||'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],external=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith('http://127.0.0.1:5173'))external.push(r.url());});
 await mkdir('docs/screenshots',{recursive:true});
 for(const id of ['mit','harvard']){
  await page.goto(`http://127.0.0.1:5173/real/${id}`);
  await page.waitForFunction(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent===' 拍照'||b.textContent==='拍照');return b&&!b.disabled;},{},{timeout:30000});
  await page.screenshot({path:`docs/screenshots/local-${id}-orbit.png`});console.log(`${id}: model ready`);
  await page.getByRole('button',{name:'角色漫游',exact:true}).click();await page.locator('canvas').click();await page.keyboard.press('e');
  await page.getByRole('dialog').waitFor();
  const before=await page.evaluate(()=>window.__localCampus.position);
  await page.keyboard.down('w');await page.waitForTimeout(400);await page.keyboard.up('w');
  assert.deepEqual(await page.evaluate(()=>window.__localCampus.position),before,'modal pauses movement');
  await page.keyboard.press('Escape');await page.locator('canvas').click();
  await page.keyboard.down('s');await page.waitForTimeout(1000);await page.keyboard.up('s');
  const after=await page.evaluate(()=>window.__localCampus.position);assert.ok(Math.hypot(after[0]-before[0],after[2]-before[2])>1,'keyboard moves character');
  await page.screenshot({path:`docs/screenshots/local-${id}-walk.png`});
  await page.getByRole('button',{name:'拍照',exact:true}).click();await page.getByRole('status').filter({hasText:'照片已保存'}).waitFor();
  await page.getByRole('button',{name:'航拍地图',exact:true}).click();await page.locator('.local-map img').waitFor();await page.screenshot({path:`docs/screenshots/local-${id}-map.png`});
  console.log(`${id}: interaction, photograph, orthophoto passed`);
 }
 const fallback=await browser.newPage();await fallback.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...rest){return type==='webgl2'?null:original.call(this,type,...rest);};});
 await fallback.goto('http://127.0.0.1:5173/real/mit');await fallback.locator('.local-map img').waitFor();assert.equal(await fallback.getByRole('button',{name:'3D 鸟瞰'}).isDisabled(),true);console.log('no WebGL: orthophoto fallback passed');
 assert.deepEqual(external,[],'no external map requests');
 if(errors.length)throw new Error(errors.join('\n'));
}finally{await browser.close();}
