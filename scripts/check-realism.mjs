import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const stage=process.argv.includes('--baseline')?'baseline':'updated';
const root=`docs/screenshots/realism-${stage}`;await mkdir(root,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],records=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:5173/real/mit');
 await page.getByRole('button',{name:'柱廊近景',exact:true}).waitFor();
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='拍照'&&!b.disabled),null,{timeout:60000});
 if(stage==='updated')await page.waitForFunction(()=>window.__localCampus?.vegetationStatus==='ready',null,{timeout:60000});
 for(const [label,key] of [['庭院鸟瞰','court'],['步行视角','eye'],['柱廊近景','portico'],['6 号楼','facade'],['河岸环境','river'],['桥面近景','bridge']]){
  await page.getByRole('button',{name:label,exact:true}).click();await page.waitForTimeout(1200);
  await page.locator('canvas').screenshot({path:`${root}/${key}.png`});
  records.push({key,scene:await page.evaluate(()=>window.__localCampus)});
 }
 if(stage==='updated')for(const [label,key] of [['步行视角','eye'],['柱廊近景','portico'],['西侧庭院','westcourt'],['东侧庭院','eastcourt'],['河岸步道','riverwalk'],['树木近景','trees']]){
  await page.getByRole('button',{name:label,exact:true}).click();await page.waitForTimeout(800);
  const state=await page.evaluate(()=>window.__localCampus);
  assert.ok(Math.abs(state.cameraPosition[1]-state.cameraGroundHeight-1.65)<.06,`${label} stays at human eye height`);
  await page.locator('canvas').screenshot({path:`${root}/${key}.png`});records.push({key,scene:state});
 }
 const performance=await page.evaluate(()=>new Promise(resolve=>{
  const times=[];let last=0,start=0;function frame(t){if(!start)start=t;if(last)times.push(t-last);last=t;if(t-start<3000)requestAnimationFrame(frame);else{times.sort((a,b)=>a-b);resolve({medianFrameMs:times[Math.floor(times.length*.5)],p95FrameMs:times[Math.floor(times.length*.95)],frames:times.length,durationMs:t-start,userAgent:navigator.userAgent});}}requestAnimationFrame(frame);
 }));
 if(stage==='updated'){
  await page.getByRole('button',{name:'步行视角',exact:true}).click();await page.waitForTimeout(700);
  await page.getByRole('button',{name:'环境展示',exact:true}).click();await page.waitForTimeout(1000);
  assert.equal(await page.locator('.real-sidebar').isVisible(),false);
  await page.screenshot({path:`${root}/presentation.png`});
  await page.getByRole('button',{name:'返回探索',exact:true}).click();await page.waitForTimeout(400);
  assert.equal(await page.locator('.real-sidebar').isVisible(),true);
  await page.getByRole('button',{name:'画质：标准',exact:true}).click();
  await page.waitForFunction(()=>window.__localCampus?.quality==='low'&&!window.__localCampus.ambientOcclusion);
  await page.getByRole('button',{name:'画质：省电',exact:true}).click();
  await page.waitForFunction(()=>window.__localCampus?.quality==='standard'&&window.__localCampus.ambientOcclusion);
 }
 assert.deepEqual(errors,[]);await writeFile(`${root}/report.json`,JSON.stringify({stage,records,performance,errors},null,2));
 console.log(stage,performance);
 if(stage==='updated'){
  await page.goto(pathToFileURL(resolve('docs/mit-realism-review.html')).href);
  await page.waitForFunction(()=>['before','after'].every(id=>document.getElementById(id).naturalWidth>0));
  await page.locator('#split').fill('25');await page.locator('#split').dispatchEvent('input');
  assert.match(await page.locator('#before').getAttribute('style'),/75%/);
  await page.getByRole('button',{name:'柱廊近景',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('after').complete&&document.getElementById('after').naturalWidth>0);
  console.log('Local comparison board: images and comparison slider passed');
 }
}finally{await browser.close();}
