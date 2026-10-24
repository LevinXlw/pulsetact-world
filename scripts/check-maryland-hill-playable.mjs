import {mkdir,writeFile} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {authenticateContext} from './test-auth.mjs';

const base='http://127.0.0.1:5186',directory='output/maryland-fidelity/hill-walk';
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
const context=await browser.newContext({viewport:{width:1440,height:900}});
await authenticateContext(context,base);
await context.addInitScript(()=>localStorage.setItem('pulsetact.world.solo.v1',JSON.stringify({version:1,campus:'umd',position:[80,-155],campusVisits:[],visited:[],visitedPlaces:[],photos:0,quality:'standard',trackedId:'umd-stamp'})));
const page=await context.newPage(),report={errors:[],samples:[]};
page.on('pageerror',error=>report.errors.push(error.message));
const scene=()=>page.evaluate(()=>window.__worldScene);
try{
  await page.goto(base,{waitUntil:'domcontentloaded'});
  const enter=page.getByRole('button',{name:/开始校园漫游|继续校园漫游/});await expect(enter).toBeEnabled({timeout:120000});
  await page.getByLabel('旅途中，怎么称呼你？').fill('坡路检查');await enter.click();console.log('Entered Maryland; waiting for character');
  await expect(page.getByRole('button',{name:'拍照下载',exact:true})).toBeEnabled({timeout:120000});
  await expect.poll(async()=>(await scene())?.characterReady,{timeout:120000}).toBe(true);
  await page.waitForTimeout(1000);
  const initial=await scene();report.initial=initial.position;
  console.log(`Starting uphill at ${initial.position.join(', ')}`);
  const yaw=Math.atan2(initial.cameraPosition[0]-initial.position[0],initial.cameraPosition[2]-initial.position[2]);
  await page.mouse.move(850,450);await page.mouse.down();await page.mouse.move(850-(Math.PI/2-yaw)/.004,450,{steps:4});await page.mouse.up();
  await page.screenshot({path:`${directory}/01-before-uphill.png`});
  await page.keyboard.down('Shift');await page.keyboard.down('w');
  const deadline=Date.now()+90000;
  while(Date.now()<deadline){
    await page.waitForTimeout(1000);const current=await scene();report.samples.push(current.position);
    if(current.position[0]<-180)break;
  }
  await page.keyboard.up('w');await page.keyboard.up('Shift');
  const end=await scene();report.final=end.position;report.heightGain=end.position[1]-initial.position[1];
  expect(end.position[0]).toBeLessThan(-180);expect(end.position[0]).toBeGreaterThan(-192);
  expect(Math.abs(end.position[2]+155)).toBeLessThan(2);
  expect(report.heightGain).toBeGreaterThan(8);
  await page.screenshot({path:`${directory}/02-after-uphill.png`});
  expect(report.errors).toEqual([]);report.status='passed';
}catch(error){report.status='failed';report.error=String(error);await page.screenshot({path:`${directory}/failure.png`}).catch(()=>{});process.exitCode=1;}
finally{await writeFile(`${directory}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));await browser.close();}
