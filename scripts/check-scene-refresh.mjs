import {mkdir,stat,utimes,writeFile} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {authenticateContext} from './test-auth.mjs';

// Local Fast Refresh regression. Touches only the source mtime, without changing
// file contents, to exercise effect cleanup/replay while React retains state.
const base=process.argv.find(arg=>/^https?:\/\//.test(arg))??'http://127.0.0.1:5186';
if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw new Error('Fast Refresh check is local only');
const output='output/scene-refresh',source='src/features/world/WorldScene.tsx';
const report={base,checks:[],errors:[],refreshRequests:0};
await mkdir(output,{recursive:true});
let browser,context,page;
try{
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
  context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  await authenticateContext(context,base);
  await context.addInitScript(()=>{
    localStorage.setItem('pulsetact:world:profile:v1',JSON.stringify({nickname:'场景恢复检查',color:'#778a64',characterId:'sakurada'}));
    localStorage.setItem('pulsetact.world.solo.v1',JSON.stringify({version:1,campus:'umd',position:[-108,14],campusPositions:{umd:[-108,14]},visited:['axis'],visitedPlaces:[],campusVisits:['umd-library'],photoSpots:[],photos:3,quality:'low',trackedId:null,lesson:{stage:1,mirrorA:-45,mirrorB:0,prediction:null}}));
  });
  page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
  page.on('request',request=>{if(/\/WorldScene\.tsx\?t=/.test(request.url()))report.refreshRequests++;});
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:/开始校园漫游|继续校园漫游/}).tap();
  const ready=async quality=>{
    await page.waitForFunction(quality=>window.__worldScene?.campusId==='umd'&&window.__worldScene?.quality===quality&&window.__worldScene?.characterReady,quality,{timeout:90000});
    await expect(page.locator('.pw-scene-error')).toHaveCount(0);await expect(page.locator('.pw-loading')).toHaveCount(0);
    await expect(page.getByRole('button',{name:'拍照下载',exact:true})).toBeEnabled();
  };
  await ready('low');report.checks.push('Fresh UMD mobile scene has a valid ground arrival');
  await page.getByRole('button',{name:'设置',exact:true}).tap();
  await page.getByRole('button',{name:'切换高清材质',exact:true}).tap();
  await ready('standard');report.checks.push('Sakurada HD loads on UMD before refresh');
  await page.locator('.pw-scene canvas').evaluate(canvas=>{canvas.dataset.refreshCanvas='retained';});
  const before=report.refreshRequests,{atime}=await stat(source);
  await utimes(source,atime,new Date());
  await expect.poll(()=>report.refreshRequests,{timeout:15000}).toBeGreaterThan(before);
  await page.waitForTimeout(5000);
  await ready('standard');
  await expect(page.locator('.pw-scene canvas')).toHaveAttribute('data-refresh-canvas','retained');
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('pulsetact.world.solo.v1')));
  expect(saved.campus).toBe('umd');expect(saved.quality).toBe('standard');expect(saved.photos).toBe(3);expect(saved.lesson.stage).toBe(1);
  report.checks.push('Fast Refresh releases old collision and loads new assets without false arrival errors or renderer remount');
  await page.screenshot({path:`${output}/after-refresh.png`});
  expect(report.errors).toEqual([]);report.status='passed';
}catch(error){report.status='failed';report.error=error.stack??String(error);process.exitCode=1;if(page)await page.screenshot({path:`${output}/failure.png`}).catch(()=>{});}
finally{await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));await context?.close();await browser?.close();console.log(JSON.stringify(report,null,2));}
