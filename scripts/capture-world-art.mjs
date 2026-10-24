import {mkdir,writeFile} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';

const directory='output/world-art';
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1600,height:900},deviceScaleFactor:1});
page.setDefaultTimeout(30000);
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
try {
  console.log('Opening local world');
  await page.goto(process.env.WORLD_BASE_URL||'http://127.0.0.1:5186/',{waitUntil:'domcontentloaded'});
  const enter=page.getByRole('button',{name:'以 Visitor 身份进入'});
  await expect(enter).toBeEnabled({timeout:90000});
  console.log('Scene loaded');
  await page.getByLabel('旅途中，怎么称呼你？').fill('庭院漫游');
  await enter.click();
  await page.waitForFunction(()=>window.__worldScene,null,{timeout:30000});
  console.log('Entered world');
  await page.waitForTimeout(5000);
  const frames=await page.evaluate(()=>new Promise(resolve=>{
    const times=[];let last=performance.now();
    setTimeout(()=>resolve(times.length ? times : [5000]),5000);
    function frame(now){times.push(now-last);last=now;if(times.length<80)requestAnimationFrame(frame);else resolve(times.slice(5));}
    requestAnimationFrame(frame);
  }));
  const stats=await page.evaluate(()=>window.__worldScene);
  console.log('Capturing frame');
  await page.screenshot({path:`${directory}/courtyard.png`});
  await page.locator('canvas').screenshot({path:`${directory}/courtyard-canvas.png`});
  if(process.env.WORLD_ART_WALK==='1'){
    await page.keyboard.down('w');await page.waitForTimeout(2600);await page.keyboard.up('w');
    await page.screenshot({path:`${directory}/walking.png`});
    const after=await page.evaluate(()=>window.__worldScene);
    expect(Math.hypot(after.position[0]-stats.position[0],after.position[2]-stats.position[2])).toBeGreaterThan(2);
  }
  const report={errors,stats,frameMs:{median:[...frames].sort((a,b)=>a-b)[Math.floor(frames.length/2)],average:frames.reduce((a,b)=>a+b,0)/frames.length}};
  await writeFile(`${directory}/report.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
  expect(errors).toEqual([]);
}catch(error){console.error(JSON.stringify({errors,error:String(error)}));throw error;}
finally{await browser.close();}
