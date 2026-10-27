import {mkdir,writeFile} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {FIXED_ACCOUNT} from '../server/auth-credentials.mjs';

const base=process.env.WORLD_BASE_URL||'http://127.0.0.1:5186';
const phase=process.argv[2]||'after';
const mobile=process.argv.includes('--mobile');
const out=`output/mit-poetic/playable-${phase}`;await mkdir(out,{recursive:true});
const report={base,checks:[],errors:[],screens:[],note:'Real local application, real login, normal game controls. Browser mobile emulation is not a physical device.'};
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
try{
  const page=await browser.newPage({viewport:mobile?{width:430,height:932}:{width:1600,height:1000},deviceScaleFactor:1,isMobile:mobile,hasTouch:mobile});
  page.setDefaultTimeout(90000);
  page.on('pageerror',e=>report.errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'&&!/status of 401/.test(m.text()))report.errors.push(m.text().slice(0,3000));});
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.getByLabel('账号',{exact:true}).fill(FIXED_ACCOUNT.username);
  await page.getByLabel('密码',{exact:true}).fill(FIXED_ACCOUNT.password);
  await page.getByRole('button',{name:'登录',exact:true}).click();
  if(!mobile){await page.waitForFunction(()=>window.__worldScene?.characterReady);await page.screenshot({path:`${out}/00-arrival.png`});}
  await page.getByLabel('旅途中，怎么称呼你？').fill('主楼漫游');
  await page.getByRole('button',{name:'开始校园漫游',exact:true}).click();
  await page.waitForFunction(()=>window.__worldScene?.characterReady);
  report.initial=await page.evaluate(()=>window.__worldScene);
  expect(report.initial.mobile).toBe(mobile);
  if(!mobile){
    await page.waitForFunction(()=>window.__worldScene?.rendering?.occlusionFrames>0);
    report.contactInitial=await page.evaluate(()=>window.__worldScene.rendering);
    expect(report.contactInitial).toMatchObject({enabled:true,allocated:true,error:null});
    report.captureEvent=await page.evaluate(()=>{
      const before=window.__worldScene.rendering.occlusionFrames;
      document.querySelector('canvas').dispatchEvent(new Event('world-capture'));
      return{before,after:window.__worldScene.rendering.occlusionFrames};
    });
    expect(report.captureEvent.after).toBe(report.captureEvent.before+1);
    await page.setViewportSize({width:1280,height:800});
    await page.waitForFunction(()=>window.__worldScene.rendering.width===832&&window.__worldScene.rendering.height===520);
    report.contactResized=await page.evaluate(()=>window.__worldScene.rendering);
    await page.setViewportSize({width:1600,height:1000});
    await page.waitForFunction(()=>window.__worldScene.rendering.width===1040&&window.__worldScene.rendering.height===650);
    report.checks.push('Actual GTAO frames, synchronous game photo event, and drawing-buffer resize');
  }else expect(report.initial.rendering).toEqual({mode:'direct'});
  await page.waitForTimeout(1200);
  await page.screenshot({path:`${out}/01-courtyard.png`});
  report.screens.push('01-courtyard.png');
  await page.keyboard.down('w');await page.keyboard.down('Shift');
  try{await page.waitForFunction(()=>window.__worldScene.position[2]<-4,null,{timeout:30000});}
  finally{await page.keyboard.up('w');await page.keyboard.up('Shift');}
  await page.waitForTimeout(800);
  report.approach=await page.evaluate(()=>window.__worldScene);
  expect(report.approach.position[2]).toBeLessThan(-4);
  expect(report.approach.position[1]).toBeGreaterThan(2);
  report.checks.push('Login, enter, run across the actual courtyard toward Building 10 using WASD');
  await page.screenshot({path:`${out}/02-main-building.png`});report.screens.push('02-main-building.png');
  // Raise the camera through its normal drag control to include the dome.
  const canvas=page.locator('canvas'),box=await canvas.boundingBox();
  await page.mouse.move(box.x+box.width*.6,box.y+box.height*.6);await page.mouse.down();
  await page.mouse.move(box.x+box.width*.6,box.y+box.height*.6-85,{steps:12});await page.mouse.up();
  await page.waitForTimeout(400);
  await page.screenshot({path:`${out}/03-dome-look.png`});report.screens.push('03-dome-look.png');
  await page.keyboard.down('w');
  try{await page.waitForFunction(()=>window.__worldScene.position[2]<-30,null,{timeout:20000});}
  finally{await page.keyboard.up('w');}
  await page.waitForTimeout(500);
  report.portico=await page.evaluate(()=>window.__worldScene);
  await page.screenshot({path:`${out}/04-portico.png`});report.screens.push('04-portico.png');
  report.checks.push('Walk to the actual portico steps and inspect at player height');
  await page.keyboard.down('w');
  try{await page.waitForFunction(()=>window.__worldScene.position[2]<-35.5,null,{timeout:9000});}
  finally{await page.keyboard.up('w');}
  await page.waitForTimeout(400);
  report.platform=await page.evaluate(()=>window.__worldScene);
  expect(report.platform.position[1]).toBeGreaterThan(4.7);
  expect(report.platform.position[1]).toBeLessThan(5.2);
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.getByRole('button',{name:mobile?'切换高清材质':'标准',exact:true}).click();
  await page.waitForFunction(quality=>window.__worldScene.quality===quality,mobile?'standard':'low');
  await expect(page.locator('.pw-loading')).toHaveCount(0);
  const qualityShot=mobile?'05-mobile-hd.png':'05-low-quality.png';
  await page.screenshot({path:`${out}/${qualityShot}`});report.screens.push(qualityShot);
  report.low=await page.evaluate(()=>window.__worldScene);
  if(!mobile){
    await page.waitForFunction(()=>window.__worldScene.rendering.allocated===false);
    report.contactDisabled=await page.evaluate(()=>window.__worldScene.rendering);
    expect(report.contactDisabled).toMatchObject({enabled:false,allocated:false,width:0,height:0,error:null});
  }
  expect(Math.abs(report.low.position[1]-report.platform.position[1])).toBeLessThan(.01);
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.getByRole('button',{name:mobile?'切回省电':'省电',exact:true}).click();
  await page.waitForFunction(quality=>window.__worldScene.quality===quality,mobile?'low':'standard');
  await expect(page.locator('.pw-loading')).toHaveCount(0);
  if(!mobile){
    await page.waitForFunction(()=>window.__worldScene.rendering.enabled&&window.__worldScene.rendering.allocated);
    report.contactReenabled=await page.evaluate(()=>window.__worldScene.rendering);
    expect(report.contactReenabled.error).toBeNull();
    expect(report.contactReenabled.occlusionFrames).toBeGreaterThan(report.contactDisabled.occlusionFrames);
    report.checks.push('Low quality releases GTAO resources; standard quality rebuilds them without errors');
  }
  report.checks.push('Climb the same five steps to the platform; standard/low toggle preserves ground position');
  report.frameSample=await page.evaluate(async()=>{
    const frames=[];let previous=performance.now();
    for(let i=0;i<120;i++)await new Promise(resolve=>requestAnimationFrame(t=>{if(i>9)frames.push(t-previous);previous=t;resolve();}));
    frames.sort((a,b)=>a-b);
    const gl=document.querySelector('canvas').getContext('webgl2'),ext=gl?.getExtension('WEBGL_debug_renderer_info');
    return{medianMs:frames[Math.floor(frames.length*.5)],p95Ms:frames[Math.floor(frames.length*.95)],samples:frames.length,gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unavailable',viewport:[innerWidth,innerHeight],dpr:devicePixelRatio,environment:'Chrome headless, development server, idle at portico; desktop GPU also renders mobile emulation; not a target-device FPS guarantee'};
  });
  expect(report.errors).toEqual([]);
  console.log(JSON.stringify({phase,checks:report.checks,position:report.portico.position,errors:report.errors}));
}catch(error){report.errors.push(String(error));process.exitCode=1;}
finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
