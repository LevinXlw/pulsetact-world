import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
 let release;const delay=new Promise(resolve=>{release=resolve;});
 await page.route('**/vegetation.glb.gz',async route=>{await delay;await route.continue();});
 await page.goto('http://127.0.0.1:5173/real/mit');
 await page.waitForFunction(()=>window.__localCampus?.vegetationStatus==='loading',null,{timeout:45000});
 assert.equal(await page.getByRole('button',{name:'拍照',exact:true}).isEnabled(),true,'core is interactive before foliage finishes');
 release();await page.waitForFunction(()=>window.__localCampus?.vegetationStatus==='ready',null,{timeout:45000});
 assert.ok(requests.some(u=>u.endsWith('/detail.glb.gz')));assert.ok(requests.some(u=>u.endsWith('/vegetation.glb.gz')));
 assert.ok(!requests.some(u=>u.endsWith('/killian/detail.glb')),'compressed core is used');
 assert.ok(!requests.some(u=>/^https?:/.test(u)&&!u.startsWith('http://127.0.0.1:5173')),'no external runtime assets');
 await page.context().setOffline(true);
 await page.getByRole('button',{name:'东侧庭院',exact:true}).click();await page.waitForTimeout(800);
 const state=await page.evaluate(()=>window.__localCampus);assert.ok(Math.abs(state.cameraPosition[1]-state.cameraGroundHeight-1.65)<.06);
 await page.screenshot({path:'docs/screenshots/realism-updated/offline-court.png'});assert.deepEqual(errors,[]);
 const failed=await browser.newPage();await failed.route('**/vegetation.glb.gz',route=>route.abort());
 await failed.goto('http://127.0.0.1:5173/real/mit');await failed.getByText('树冠载入失败，请刷新重试',{exact:false}).waitFor({timeout:45000});
 assert.equal(await failed.getByRole('button',{name:'拍照',exact:true}).isEnabled(),true);assert.equal(await failed.locator('canvas').isVisible(),true);
 console.log('Progressive core readiness, gzip delivery, no external assets, offline views and foliage failure recovery passed');
}finally{await browser.close();}
