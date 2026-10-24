import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {authenticateContext} from './test-auth.mjs';

// Deliberately exercises the normal nickname/map/settings/control UI. No test
// scene, direct teleport, second dev server, or scene-state mutation is used.
const base=process.argv.find(arg=>/^https?:\/\//.test(arg))??'http://127.0.0.1:5186';
const mobile=process.argv.includes('--mobile'),mode=mobile?'mobile':'desktop';
const directory=`output/cds-full-20261019/playable/${mode}`;
const fullAsset=/\/assets\/bu-cds\/cds-full\.glb(?:\?|$)/;
const desktopOnly=/\/(?:assets\/bu-cds\/cds-full|assets\/bu-quality(?:-pass2)?\/[^/]+|data\/killian\/detail|data\/campuses\/mit\/campus|assets\/characters\/(?:pixiv|sakurada))\.glb(?:\.gz)?(?:\?|$)/;
const saveKey='pulsetact.world.solo.v1';
const report={mode,base,startedAt:new Date().toISOString(),status:'running',checks:[],errors:[],networkFailures:[],requests:[],responses:[],checkpoints:[],screenshots:[]};
await mkdir(directory,{recursive:true});
let browser,context,page;
const check=(name,details={})=>{report.checks.push({name,...details});console.log(`PASS ${mode}: ${name}`);};
const saved=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),saveKey);
const scene=()=>page.evaluate(()=>window.__worldScene??null);
async function activate(locator){await(mobile?locator.tap():locator.click());}
async function ready(quality){
  await expect(page.getByRole('navigation',{name:'世界菜单',exact:true})).toBeVisible({timeout:180000});
  await expect(page.getByRole('button',{name:'拍照下载',exact:true})).toBeEnabled({timeout:180000});
  await expect(page.locator('.pw-loading')).toHaveCount(0,{timeout:180000});
  await expect(page.locator('.pw-scene-error')).toHaveCount(0);
  await page.waitForFunction(({quality,mobile})=>window.__worldScene?.campusId==='boston'&&window.__worldScene?.quality===quality&&window.__worldScene?.mobile===mobile&&window.__worldScene?.characterReady,{quality,mobile},{timeout:180000});
  await expect(page.locator('.pw-scene canvas')).toHaveCount(1);
}
async function shot(name){
  await page.waitForTimeout(1200);
  await page.screenshot({path:`${directory}/${name}.png`});
  report.screenshots.push(`${name}.png`);
  report.checkpoints.push({name,scene:await scene(),save:await saved()});
}
async function setQuality(quality){
  await activate(page.getByRole('navigation',{name:'场景工具',exact:true}).getByRole('button',{name:'设置',exact:true}));
  const label=mobile?(quality==='standard'?'切换高清材质':'切回省电'):(quality==='standard'?'省电':'标准');
  await activate(page.getByRole('button',{name:label,exact:true}));
  await ready(quality);
  await expect.poll(async()=>(await saved()).quality,{timeout:15000}).toBe(quality);
  await expect(page.locator('.pw-scene canvas')).toHaveAttribute('data-cds-smoke-canvas','stable');
  check(`quality switch reaches ${quality} with the same canvas`);
}
try{
  if(mobile){
    const model=JSON.parse(await readFile('public/data/mobile/boston.json','utf8'));
    // Manifest is archived in the report for bake provenance; the parent waits
    // for the new Boston pack before invoking --mobile.
    report.mobileBakeManifest=model;
  }
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
  context=await browser.newContext(mobile?{viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true}:{viewport:{width:1500,height:960},deviceScaleFactor:1});
  await authenticateContext(context,base);
  check('local account authentication established');
  page=await context.newPage();page.setDefaultTimeout(30000);
  page.on('pageerror',error=>report.errors.push(error.message));
  page.on('crash',()=>report.errors.push('Browser page crashed'));
  page.on('console',message=>{if(message.type()==='error'&&/WebGLProgram|VALIDATE_STATUS|shader error|GL_INVALID|Context Lost|WebGL context/i.test(message.text()))report.errors.push(message.text());});
  page.on('request',request=>report.requests.push(request.url()));
  page.on('response',response=>{
    if(/\.glb(?:\.gz)?(?:\?|$)/.test(response.url()))report.responses.push({url:response.url(),status:response.status()});
    if(response.status()>=400&&/\/assets\/|\/data\//.test(response.url()))report.networkFailures.push({url:response.url(),status:response.status()});
  });
  page.on('requestfailed',request=>{const error=request.failure()?.errorText??'Unknown';if(!/ERR_ABORTED|cancelled|canceled/i.test(error)&&/\/assets\/|\/data\//.test(request.url()))report.networkFailures.push({url:request.url(),error});});
  await page.goto(base,{waitUntil:'domcontentloaded'});
  const nickname=page.getByLabel('旅途中，怎么称呼你？',{exact:true});
  await expect(nickname).toBeVisible({timeout:30000});
  if(mobile){await expect(page.locator('.pw-scene canvas')).toHaveCount(0);check('phone entry has no WebGL canvas before submitting a name');}
  await nickname.fill(mobile?'CDS 手机检查':'CDS 整楼检查');
  const enter=page.getByRole('button',{name:/开始校园漫游|继续校园漫游/});
  await expect(enter).toBeEnabled();await activate(enter);
  const initialQuality=mobile?'low':'standard';await ready(initialQuality);
  await page.locator('.pw-scene canvas').evaluate(canvas=>{canvas.dataset.cdsSmokeCanvas='stable';});
  check('nickname submission enters the playable Boston world');
  await activate(page.getByRole('navigation',{name:'世界菜单',exact:true}).getByRole('button',{name:'地图',exact:true}));
  await activate(page.getByRole('button',{name:'河岸与 BU',exact:true}));
  await activate(page.getByRole('button',{name:'快速前往Duan 数据科学中心',exact:true}));
  await ready(initialQuality);
  await expect(page.locator('.pw-location')).toContainText('BOSTON UNIVERSITY');
  await expect.poll(async()=>(await saved()).trackedId,{timeout:15000}).toBe('bu-cds');
  const arrival=await scene();
  expect(arrival.position[0]).toBeGreaterThan(-1000);expect(arrival.position[0]).toBeLessThan(-800);
  expect(arrival.position[2]).toBeGreaterThan(980);expect(arrival.position[2]).toBeLessThan(1150);
  check('normal map quick travel arrives at Duan CDS',{position:arrival.position});
  if(mobile){
    expect(report.requests.filter(url=>desktopOnly.test(url))).toEqual([]);
    expect(report.responses.some(r=>/\/data\/mobile\/boston\.glb/.test(r.url)&&r.status===200)).toBe(true);
    await shot('01-cds-phone-low');check('phone uses the baked Boston pack without downloading desktop building assets');
  }else{
    await expect.poll(()=>report.responses.filter(r=>fullAsset.test(r.url)&&r.status===200).length,{timeout:30000}).toBeGreaterThan(0);
    check('the complete refined CDS GLB was actually fetched with HTTP 200');
  }
  const before=arrival.position;
  if(mobile){
    const back=page.getByRole('navigation',{name:'移动方向',exact:true}).getByRole('button',{name:'向后',exact:true});
    const box=await back.boundingBox();expect(box).not.toBeNull();
    const cdp=await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2,id:1}]});
    await page.waitForTimeout(2500);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
  }else{
    await page.keyboard.down('s');await page.waitForTimeout(2500);await page.keyboard.up('s');
  }
  await expect.poll(async()=>{const p=(await scene()).position;return Math.hypot(p[0]-before[0],p[2]-before[2]);},{timeout:10000}).toBeGreaterThan(1);
  const moved=await scene();check(`${mobile?'touch direction pad':'keyboard'} walks several steps at CDS`,{before,after:moved.position,distance:Math.hypot(moved.position[0]-before[0],moved.position[2]-before[2])});
  if(mobile){
    await setQuality('standard');await shot('02-cds-phone-hd');
    expect(report.requests.filter(url=>desktopOnly.test(url))).toEqual([]);check('phone HD remains on the mobile pack with zero desktop GLB requests');
    await setQuality('low');
  }else{
    await setQuality('low');await setQuality('standard');await shot('01-cds-player-street');
  }
  expect(report.errors).toEqual([]);expect(report.networkFailures).toEqual([]);
  check('no page errors, WebGL errors, crashed page or asset request failures');
  report.status='passed';
}catch(error){
  report.status='failed';report.failure=String(error);process.exitCode=1;
  await page?.screenshot({path:`${directory}/failure.png`}).catch(()=>{});
}finally{
  report.finishedAt=new Date().toISOString();
  await writeFile(`${directory}/report.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify({mode,status:report.status,checks:report.checks,failure:report.failure,errors:report.errors,networkFailures:report.networkFailures}));
  await browser?.close();
}
