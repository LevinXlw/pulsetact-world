import {chromium,expect} from '@playwright/test';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {authenticateContext} from './test-auth.mjs';
const directory='output/bu-quality-20261019-pass2',base='http://127.0.0.1:5186';
await mkdir(`${directory}/screenshots`,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
const context=await browser.newContext({viewport:{width:1440,height:1200},deviceScaleFactor:1});
const page=await context.newPage(),report={errors:[],checks:[],samples:[],screenshots:[]};page.setDefaultTimeout(60000);
page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(`${m.text()} (${m.location().url})`);});
async function capture(name){await page.waitForTimeout(400);await page.locator('.stage').screenshot({path:`${directory}/screenshots/${name}.png`});report.screenshots.push(name);}
try{
 await authenticateContext(context,base);
 await page.goto(`${base}/${directory}/review.html`,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.qualityReview?.ready);
 report.samples=await page.evaluate(()=>window.qualityReview.samples);
 report.files=await Promise.all(['public/assets/bu-quality/bay-state-192.glb','public/assets/bu-quality/cds-ground.glb','public/assets/bu-quality-pass2/bay-state-192.glb','public/assets/bu-quality-pass2/cds-ground.glb',`${directory}/review.mjs`].map(async path=>{const bytes=await readFile(path);return {path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};}));
 expect(report.samples).toHaveLength(2);expect(report.samples.every(s=>s.trianglesAfter>0&&s.textures>0)).toBe(true);
 expect(report.samples.every(s=>s.trianglesAfter>s.trianglesBefore)).toBe(true);
 await expect(page.getByRole('button',{name:'本轮精修',exact:true})).toHaveAttribute('aria-pressed','true');
 for(const [id,label] of [['bay-state-192','192 Bay State 住宅'],['cds-ground','CDS 首层片段']]){
  await page.getByRole('button',{name:label,exact:true}).click();
  for(const [shot,title] of [['overall','整体'],['close','近看细节']]){
   await page.getByRole('button',{name:title,exact:true}).click();
   for(const [mode,title] of [['before','上轮样板'],['after','本轮精修'],['pair','并排对比']]){
    await page.getByRole('button',{name:title,exact:true}).click();await expect(page.getByRole('status')).toContainText(mode==='pair'?'左：上轮样板':mode==='after'?'完整显示本轮精修':'完整显示上轮样板');await capture(`${id}-${shot}-${mode}`);
   }
  }
  await page.getByRole('button',{name:'本轮精修',exact:true}).click();await page.getByLabel('光线',{exact:true}).selectOption('raking');await capture(`${id}-raking`);await page.getByLabel('光线',{exact:true}).selectOption('day');
 }
 report.checks.push('Two GLBs load with embedded textures; both samples, camera presets, before/after/pair modes and raking daylight render.');
 await page.getByRole('button',{name:'192 Bay State 住宅',exact:true}).click();await page.getByRole('button',{name:'近看细节',exact:true}).click();
 await page.screenshot({path:`${directory}/review-desktop.png`,fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(300);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`${directory}/review-mobile.png`,fullPage:true});
 report.checks.push('390px review layout has no horizontal overflow; this is not a mobile-game asset budget test.');expect(report.errors).toEqual([]);report.status='passed';
}catch(error){report.status='failed';report.error=String(error);process.exitCode=1;await page.screenshot({path:`${directory}/failure.png`}).catch(()=>{});}
finally{await writeFile(`${directory}/review-check.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));await browser.close();}
