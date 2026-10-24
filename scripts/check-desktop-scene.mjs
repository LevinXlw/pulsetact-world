import {mkdir,writeFile} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {authenticateContext} from './test-auth.mjs';

const base=process.argv.find(arg=>/^https?:\/\//.test(arg))??'http://127.0.0.1:5186';
const local=['localhost','127.0.0.1'].includes(new URL(base).hostname);
const directory=`output/desktop-scene/${local?'local':'production'}`;
const report={base,requests:[],errors:[],checks:[]};
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
try{
  const context=await browser.newContext({viewport:{width:1365,height:900}});
  await authenticateContext(context,base);
  const page=await context.newPage();
  page.on('request',request=>{if(/\.glb(?:\.gz)?(?:\?|$)/.test(request.url()))report.requests.push(request.url());});
  page.on('pageerror',error=>report.errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'&&/WebGLProgram|shader error|GL_INVALID/i.test(message.text()))report.errors.push(message.text());});
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.getByLabel('旅途中，怎么称呼你？',{exact:true}).fill('桌面场景回归');
  await page.getByRole('button',{name:/开始校园漫游|继续校园漫游/}).click();
  await expect(page.getByRole('navigation',{name:'世界菜单',exact:true})).toBeVisible({timeout:180000});
  await expect(page.getByRole('button',{name:'拍照下载',exact:true})).toBeEnabled();
  await expect(page.locator('.pw-scene-error')).toHaveCount(0);
  expect(report.requests.some(url=>url.includes('/data/campuses/mit/campus.glb'))).toBe(true);
  expect(report.requests.some(url=>url.includes('/data/killian/detail.glb'))).toBe(true);
  expect(report.requests.some(url=>url.includes('/data/mobile/'))).toBe(false);
  const position=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('pulsetact.world.solo.v1')).position);
  await page.waitForTimeout(3300);
  const before=await position();
  await page.keyboard.down('s');await page.waitForTimeout(900);await page.keyboard.up('s');
  await page.waitForTimeout(3300);
  const after=await position();
  report.distance=Math.hypot(after[0]-before[0],after[1]-before[1]);expect(report.distance).toBeGreaterThan(.5);
  report.scene=await page.evaluate(()=>({debug:window.__worldScene??null,attributes:document.querySelector('.pw-scene canvas').getContext('webgl2').getContextAttributes()}));
  expect(report.scene.attributes.preserveDrawingBuffer).toBe(true);
  expect(report.errors).toEqual([]);
  await page.screenshot({path:`${directory}/ready.png`});
  report.checks.push('desktop retains complete MIT/detail assets and drawing-buffer configuration','keyboard walking changes and saves position without page or shader errors');
  report.status='passed';
}catch(error){report.status='failed';report.error=error.stack??String(error);process.exitCode=1;}
finally{await browser.close();await writeFile(`${directory}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
