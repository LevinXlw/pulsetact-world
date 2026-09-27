import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 const ready=()=>page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='拍照'&&!b.disabled),null,{timeout:45000});
 await page.goto('http://127.0.0.1:5173/real/mit');await ready();await page.waitForFunction(()=>window.__localCampus?.vegetationStatus==='ready');await page.screenshot({path:'docs/screenshots/killian-enhanced-orbit.png'});
 await page.getByRole('button',{name:'对比原始模型'}).click();await ready();await page.screenshot({path:'docs/screenshots/killian-original-orbit.png'});
 await page.getByRole('button',{name:'查看精细样板'}).click();await ready();await page.getByRole('button',{name:'角色漫游',exact:true}).click();await ready();await page.screenshot({path:'docs/screenshots/killian-enhanced-walk.png'});
 await page.waitForFunction(()=>window.__localCampus?.openingTrianglesRemoved===2);
 for(const [label,file] of [['庭院鸟瞰','aerial'],['步行视角','eye'],['柱廊近景','entrance']]){await page.getByRole('button',{name:label,exact:true}).click();await page.waitForTimeout(400);await page.screenshot({path:`docs/screenshots/killian-v2-${file}.png`});}
 await page.getByText('10 个已部分细化 · 215 个基础材质模型',{exact:true}).waitFor();
 for(const number of [7,5,2,1,6,8,11]){await page.getByRole('button',{name:`${number} 号楼`,exact:true}).click();await page.waitForTimeout(600);await page.screenshot({path:`docs/screenshots/mit-building-${number}.png`});}
 for(const [label,file] of [['全图总览','overview'],['河岸环境','river'],['桥面近景','bridge'],['树木近景','trees']]){await page.getByRole('button',{name:label,exact:true}).click();await page.waitForTimeout(600);await page.screenshot({path:`docs/screenshots/mit-overhaul-${file}.png`});}
 const originalWidth=Number(await page.locator('canvas').getAttribute('width'));
 await page.getByRole('button',{name:'画质：标准',exact:true}).click();await page.waitForTimeout(400);
 assert.ok(Number(await page.locator('canvas').getAttribute('width'))<originalWidth,'low-power mode reduces render resolution');
 await page.getByRole('button',{name:'画质：省电',exact:true}).click();await page.waitForTimeout(400);
 console.log('Scene metrics:',await page.evaluate(()=>window.__localCampus));
 assert.deepEqual(errors,[]);console.log('Killian: enhanced / original toggle and walking view passed');
}finally{await browser.close();}
