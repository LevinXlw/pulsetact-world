import {chromium,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const stage=process.argv.includes('--before')?'before':'after';
const output=`docs/screenshots/cambridge-realism/${stage}`;
const base=process.env.CAMBRIDGE_BASE_URL||'http://127.0.0.1:5173';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1});
const page=await context.newPage(),errors=[],requests=[],captures=[];
page.on('pageerror',error=>errors.push(error.message));
page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
page.on('request',request=>requests.push(request.url()));
const state=()=>page.evaluate(()=>window.__localCampus);
async function ready(){await expect(page.getByRole('button',{name:'拍照',exact:true})).toBeEnabled({timeout:90000});await page.waitForFunction(()=>window.__localCampus?.vegetationStatus==='ready');}
async function capture(name){
 await page.waitForTimeout(700);
 const style=await page.addStyleTag({content:'.real-toolbar,.real-status,.courtyard-caption,.local-credit{visibility:hidden!important}'});
 try{await page.locator('canvas').screenshot({path:`${output}/${name}.png`});}finally{await style.evaluate(element=>element.remove());}
 captures.push({name,scene:await state()});console.log('Captured',stage,name);
}
let failure;
try{
 await page.goto(`${base}/real/mit`);await ready();await page.waitForFunction(()=>window.__localCampus?.people?.length===2);
 await capture('entry');
 for(const [name,label] of [['people','人物近景'],['facade','3 号楼庭院面'],['portico','柱廊侧视'],['trees','西侧树荫'],...(stage==='after'?[['grass','草坪步道']]:[])]){
  await page.getByRole('button',{name:'机位',exact:true}).click();await page.getByRole('button',{name:label,exact:true}).click();await ready();await capture(name);
 }
 await page.getByRole('button',{name:'环境漫步',exact:true}).click();await ready();
 const initial=await state();await page.keyboard.down('w');await page.waitForTimeout(600);await page.keyboard.up('w');
 const moved=await state();assert.ok(Math.hypot(moved.position[0]-initial.position[0],moved.position[2]-initial.position[2])>.3,'stroll remains traversable');
 assert.ok(Math.abs(moved.cameraPosition[1]-moved.cameraGroundHeight-1.65)<.06,'eye stays grounded');
 await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'画质：标准',exact:true}).click();await page.keyboard.press('Escape');
 await page.waitForFunction(()=>window.__localCampus?.quality==='low');await capture('low');
 assert.deepEqual(errors,[],'no browser or shader errors');assert.ok(requests.every(url=>!/^https?:/.test(url)||url.startsWith(base)),'all resources remain local');
}catch(error){failure={message:error.message,scene:await state().catch(()=>null)};process.exitCode=1;console.error(error);}
finally{await writeFile(`${output}/report.json`,JSON.stringify({stage,checkedAt:new Date().toISOString(),captures,errors,failure,requests:[...new Set(requests)]},null,2));await browser.close();}
