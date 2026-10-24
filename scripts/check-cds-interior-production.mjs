import {createHash} from 'node:crypto';
import {setDefaultResultOrder} from 'node:dns';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {FIXED_ACCOUNT} from '../server/auth-credentials.mjs';

// Production has no development scene inspector. Exercise the real login and
// player UI; observe rendered pixels, doorway interaction, and saved progress.
setDefaultResultOrder('ipv4first');
const base=new URL(process.env.WORLD_VERIFY_URL||process.argv.find(arg=>/^https?:\/\//.test(arg))||'https://world.pulsetact.ai');
if(base.username||base.password)throw new Error('The verification URL must not contain credentials.');
const mobile=process.argv.includes('--mobile'),mode=mobile?'mobile':'desktop';
const directory=`output/deployment/cds-interior-20261020/${mode}`;
const saveKey='pulsetact.world.solo.v1',assetRoot='/assets/bu-cds-interior/';
const selectedAsset=`interior-${mode}.glb`;
const assetNames=['manifest.json',selectedAsset,'physics.glb'];
const url=path=>new URL(path,base).href;
const pathname=value=>{try{return new URL(value).pathname;}catch{return '[invalid URL]';}};
const redact=value=>String(value).replaceAll(FIXED_ACCOUNT.password,'[redacted]').replace(/(pulsetact_session\s*[=:]\s*)[^\s;,"']+/gi,'$1[redacted]');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const report={mode,base:base.origin,status:'running',startedAt:new Date().toISOString(),checks:[],errors:[],networkFailures:[],assets:[],requests:[],responses:[],screenshots:[],checkpoints:[]};
await mkdir(directory,{recursive:true});
let browser,context,page,cdp,stage='login';
const check=(name,details={})=>{report.checks.push({name,...details});console.log(`PASS ${mode}: ${name}`);};
const activate=locator=>mobile?locator.tap():locator.click();
const save=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)||'null'),saveKey);
const pause=ms=>page.waitForTimeout(ms);
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);

async function exteriorReady(){
 await expect(page.getByRole('navigation',{name:'世界菜单',exact:true})).toBeVisible({timeout:180000});
 await expect(page.getByRole('button',{name:'拍照下载',exact:true})).toBeEnabled({timeout:180000});
 await expect(page.locator('.pw-loading')).toHaveCount(0,{timeout:180000});
 await expect(page.locator('.pw-scene-error')).toHaveCount(0);
 await expect(page.locator('.pw-scene canvas')).toBeVisible();
 await expect(page.locator('canvas')).toHaveCount(1);
 await expect.poll(async()=>(await save())?.campus,{timeout:15000}).toBe('boston');
}

async function interiorReady(){
 await expect(page.getByTestId('cds-interior-visit')).toBeVisible({timeout:180000});
 await expect(page.locator('.cds-visit-loading')).toHaveCount(0,{timeout:180000});
 await expect(page.locator('.cds-visit-error')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'回到入口',exact:true})).toBeEnabled({timeout:180000});
 await expect(page.locator('.cds-visit-scene canvas')).toBeVisible();
 await expect(page.locator('.pw-scene canvas')).toHaveCount(0);
 await expect(page.locator('canvas')).toHaveCount(1);
}

async function pixels(canvas){
 return canvas.evaluate(async source=>{
  await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));
  const sample=document.createElement('canvas');sample.width=64;sample.height=48;
  const drawing=sample.getContext('2d');drawing.drawImage(source,0,0,64,48);
  const data=drawing.getImageData(0,0,64,48).data,colors=new Set();
  let opaque=0,darkest=255,lightest=0;
  for(let i=0;i<data.length;i+=4){
   if(data[i+3]>240)opaque++;
   colors.add(`${data[i]>>4},${data[i+1]>>4},${data[i+2]>>4}`);
   const light=(data[i]+data[i+1]+data[i+2])/3;darkest=Math.min(darkest,light);lightest=Math.max(lightest,light);
  }
  return{width:source.width,height:source.height,opaqueRatio:opaque/(64*48),colors:colors.size,range:lightest-darkest,sample:Array.from(data)};
 });
}

async function capture(name,inside=true){
 await pause(900);
 const canvas=page.locator(inside?'.cds-visit-scene canvas':'.pw-scene canvas'),render=await pixels(canvas);
 // Phone low mode deliberately renders below its CSS resolution.
 expect(render.width,'Canvas has a nonzero render width').toBeGreaterThan(100);
 expect(render.height,'Canvas has a nonzero render height').toBeGreaterThan(100);
 expect(render.opaqueRatio,'Rendered scene is not transparent').toBeGreaterThan(.9);
 expect(render.colors,'Rendered scene is not a single-color background').toBeGreaterThan(12);
 expect(render.range,'Visible geometry has lighting variation').toBeGreaterThan(30);
 const {sample,...summary}=render;
 await page.screenshot({path:`${directory}/${name}.png`});
 await canvas.screenshot({path:`${directory}/${name}-scene.png`});
 report.screenshots.push(`${name}.png`,`${name}-scene.png`);
 report.checkpoints.push({name,render:summary,save:await save()});
 console.log(`SCREENSHOT ${directory}/${name}.png`);
 return render;
}

async function captureOpening(name,inside){
 const button=inside?page.locator('.cds-visit-interact'):page.getByTestId('enter-cds-interior');
 await expect(button).toHaveAttribute('data-phase','opening');
 await expect(button).toHaveAttribute('data-door','east');
 // Observe the public UI state, with no development inspector or injected pose.
 // Take this frame before the usual 900 ms scene-settling screenshot delay.
 await pause(220);await expect(button).toHaveAttribute('data-phase','opening');
 await expect(page.locator(inside?'.cds-visit-scene canvas':'.pw-scene canvas')).toBeVisible();
 await page.screenshot({path:`${directory}/${name}.png`,animations:'allow'});
 report.screenshots.push(`${name}.png`);report.checkpoints.push({name,door:'east',phase:'opening',inside,save:await save()});
 check(`${inside?'interior':'exterior'} east door animates before the scene is replaced`);
}

async function verifyDeployedAssets(){
 const localManifest=JSON.parse(await readFile(resolve('public',assetRoot.slice(1),'manifest.json'),'utf8'));
 for(const name of assetNames){
  const path=assetRoot+name,local=await readFile(resolve('public',path.slice(1)));
  // This authenticated request context shares the browser's HttpOnly cookie.
  // Neither its cookie jar nor response headers are serialized into reports.
  const response=await context.request.get(url(path),{headers:{'cache-control':'no-cache'},timeout:120000});
  expect(response.status(),`Authenticated asset response: ${name}`).toBe(200);
  const remote=await response.body(),localSha=hash(local),remoteSha=hash(remote);
  expect(remoteSha,`Deployment bytes match the local build: ${name}`).toBe(localSha);
  expect(remote.length).toBe(local.length);
  if(name.endsWith('.glb')){
   expect(remote.subarray(0,4).toString()).toBe('glTF');
   const metadata=localManifest.assets[name==='physics.glb'?'physics':mode];
   expect(metadata.sha256).toBe(localSha);expect(metadata.bytes).toBe(local.length);
  }
  report.assets.push({path,bytes:remote.length,localSha256:localSha,deployedSha256:remoteSha,status:response.status()});
  await response.dispose();
 }
 check('deployed manifest, device model and physics match the local SHA-256 values');
 const exteriorPath=mobile?'/data/mobile/boston.glb':'/assets/bu-cds/cds-full.glb';
 const response=await context.request.get(url(exteriorPath),{timeout:120000});
 expect(response.status()).toBe(200);
 const remote=await response.body(),local=await readFile(resolve('public',exteriorPath.slice(1)));
 expect(hash(remote)).toBe(hash(local));await response.dispose();
 report.assets.push({path:exteriorPath,bytes:remote.length,localSha256:hash(local),deployedSha256:hash(remote),status:200});
 check('the deployed exterior has the new real door apertures and matches the local model');
}

async function walkForward(){
 if(mobile){
  const button=page.getByRole('navigation',{name:'室内移动方向',exact:true}).getByRole('button',{name:'向前',exact:true});
  const box=await button.boundingBox();expect(box).not.toBeNull();
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2,id:1}]});
  try{await pause(1400);}finally{await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
 }else{
  await page.keyboard.down('w');try{await pause(1400);}finally{await page.keyboard.up('w');}
 }
 await pause(250);
}

try{
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 context=await browser.newContext(mobile?{viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true}:{viewport:{width:1500,height:960},deviceScaleFactor:1});
 // Verify the new URLs before any authentication has been established.
 for(const name of assetNames){const response=await context.request.get(url(assetRoot+name),{timeout:60000});expect(response.status(),`Unauthenticated ${name}`).toBe(401);await response.dispose();}
 check('unauthenticated access to the new interior assets returns HTTP 401');
 page=await context.newPage();page.setDefaultTimeout(30000);if(mobile)cdp=await context.newCDPSession(page);
 page.on('pageerror',error=>report.errors.push(redact(error.message)));
 page.on('crash',()=>report.errors.push('Browser page crashed'));
 page.on('console',message=>{if(message.type()==='error'&&/WebGLProgram|VALIDATE_STATUS|shader error|GL_INVALID|Context Lost|WebGL context/i.test(message.text()))report.errors.push(redact(message.text()));});
 page.on('request',request=>{const path=pathname(request.url());if(path.startsWith('/assets/')||path.startsWith('/data/'))report.requests.push({path,stage});});
 page.on('response',response=>{
  const path=pathname(response.url()),status=response.status();
  if(path.startsWith('/assets/')||path.startsWith('/data/')){report.responses.push({path,status,stage});if(status>=400)report.networkFailures.push({path,status});}
 });
 page.on('requestfailed',request=>{const path=pathname(request.url()),error=request.failure()?.errorText||'Unknown';if((path.startsWith('/assets/')||path.startsWith('/data/'))&&!/ERR_ABORTED|cancelled|canceled/i.test(error))report.networkFailures.push({path,error:redact(error)});});
 await page.goto(url('/'),{waitUntil:'domcontentloaded'});
 const login=page.getByRole('button',{name:'登录',exact:true});await expect(login).toBeVisible();
 await expect(page.locator('canvas')).toHaveCount(0);
 await page.getByLabel('账号',{exact:true}).fill(FIXED_ACCOUNT.username);
 await page.getByLabel('密码',{exact:true}).fill(FIXED_ACCOUNT.password);
 const loginResponse=page.waitForResponse(response=>pathname(response.url())==='/api/auth/login'&&response.request().method()==='POST',{timeout:60000});
 await activate(login);
 expect((await loginResponse).status(),'The login request completes successfully').toBe(200);
 await expect(page.getByLabel('旅途中，怎么称呼你？',{exact:true})).toBeVisible({timeout:60000});
 const session=await context.request.get(url('/api/auth/session'));
 expect(session.status()).toBe(200);expect((await session.json()).user.username).toBe(FIXED_ACCOUNT.username);await session.dispose();
 check('real login form establishes an authenticated browser session');
 stage='campus';await page.getByLabel('旅途中，怎么称呼你？',{exact:true}).fill(mobile?'CDS 线上手机验收':'CDS 线上验收');
 await activate(page.getByRole('button',{name:/开始校园漫游|继续校园漫游/}));await exteriorReady();
 expect(report.requests.filter(item=>item.path.startsWith(assetRoot))).toEqual([]);
 await activate(page.getByRole('navigation',{name:'世界菜单',exact:true}).getByRole('button',{name:'地图',exact:true}));
 await activate(page.getByRole('button',{name:'河岸与 BU',exact:true}));
 await activate(page.getByRole('button',{name:'快速前往Duan 数据科学中心',exact:true}));await exteriorReady();
 await expect.poll(async()=>(await save())?.trackedId,{timeout:15000}).toBe('bu-cds');
 await expect(page.getByTestId('enter-cds-interior')).toContainText('开门进入');
 const outside=await save();report.outsideCheckpoint={position:outside.position,trackedId:outside.trackedId,visitedPlaces:outside.visitedPlaces};
 await expect(page.getByTestId('enter-cds-interior')).toBeEnabled();
 expect(report.requests.filter(item=>item.path.startsWith(assetRoot))).toEqual([]);
 check('nickname and map travel reach the east CDS door without preloading its interior');
 stage='interior';await activate(page.getByTestId('enter-cds-interior'));await captureOpening('00-opening-door',false);await interiorReady();
 await expect(page.locator('.cds-visit-interact')).toContainText('开门离开');
 await expect(page.locator('.cds-visit-header').getByRole('button',{name:'返回校园',exact:true})).toHaveCount(0);
 const expectedVisits=[...new Set([...outside.visitedPlaces,'bu-cds'])];
 await expect.poll(async()=>(await save())?.visitedPlaces,{timeout:15000}).toEqual(expectedVisits);
 const initialPixels=await capture('01-entry');
 await expect.poll(()=>report.responses.some(item=>item.path===assetRoot+selectedAsset&&item.status===200),{timeout:30000}).toBe(true);
 expect(report.responses.some(item=>item.path===assetRoot+'physics.glb'&&item.status===200)).toBe(true);
 const otherModel=assetRoot+`interior-${mobile?'desktop':'mobile'}.glb`;
 expect(report.requests.some(item=>item.path===otherModel)).toBe(false);
 expect(distance((await save()).position,outside.position)).toBeLessThan(.1);
 check('the correct device interior renders in one canvas while the outdoor canvas is unmounted');
 await walkForward();
 await expect(page.locator('.cds-visit-interact')).toHaveCount(0,{timeout:10000});
 const movedPixels=await capture('02-walking');
 let pixelDifference=0;for(let i=0;i<initialPixels.sample.length;i+=4)pixelDifference+=Math.abs(initialPixels.sample[i]-movedPixels.sample[i])+Math.abs(initialPixels.sample[i+1]-movedPixels.sample[i+1])+Math.abs(initialPixels.sample[i+2]-movedPixels.sample[i+2]);
 const meanPixelDifference=pixelDifference/(64*48*3);expect(meanPixelDifference).toBeGreaterThan(1);
 check(`${mobile?'touch direction pad':'WASD'} leaves the doorway and visibly moves through the room`,{meanPixelDifference});
 if(mobile){
  await activate(page.getByRole('button',{name:'切换清晰画面',exact:true}));await interiorReady();
  await expect.poll(async()=>(await save())?.quality,{timeout:15000}).toBe('standard');
  await expect(page.getByRole('button',{name:'切回省电画面',exact:true})).toBeEnabled();await capture('03-clear-picture');
  expect(report.requests.some(item=>item.path==='/assets/bu-cds/cds-full.glb'||item.path===assetRoot+'interior-desktop.glb')).toBe(false);
  check('phone clear-picture mode still uses the mobile interior and never requests the desktop CDS model');
  await activate(page.getByRole('button',{name:'切回省电画面',exact:true}));await interiorReady();
 }
 const indoorSave=await save();expect(distance(indoorSave.position,outside.position)).toBeLessThan(.1);
 expect(indoorSave.visitedPlaces).toEqual(expectedVisits);expect(indoorSave.trackedId).toBe(outside.trackedId);
 await activate(page.getByRole('button',{name:'回到入口',exact:true}));
 await expect(page.locator('.cds-visit-interact')).toContainText('开门离开');await capture('04-returned-to-entrance');
 if(mobile)await activate(page.locator('.cds-visit-interact'));else await page.keyboard.press('e');
 await captureOpening('04-opening-exit',true);
 stage='returned';await exteriorReady();await expect(page.getByTestId('cds-interior-visit')).toHaveCount(0);
 await expect.poll(async()=>distance((await save()).position,outside.position),{timeout:15000}).toBeLessThan(.1);
 const returned=await save();expect(returned.visitedPlaces).toEqual(expectedVisits);expect(returned.trackedId).toBe(outside.trackedId);
 await expect(page.getByTestId('enter-cds-interior')).toContainText('开门进入');await capture('05-returned-campus',false);
 check('return to entrance and leave restore the CDS outdoor position, tracked destination and visit record');
 // Keep the independent, large-file integrity download after the live input
 // checks; it should not compete with the phone's render/interaction exercise.
 await verifyDeployedAssets();
 expect(report.errors).toEqual([]);expect(report.networkFailures).toEqual([]);
 check('no page, WebGL, crash or asset-loading errors');report.status='passed';
}catch(error){report.status='failed';report.failure=redact(error?.message??error);process.exitCode=1;await page?.screenshot({path:`${directory}/failure.png`}).catch(()=>{});}
finally{
 report.finishedAt=new Date().toISOString();await writeFile(`${directory}/report.json`,JSON.stringify(report,null,2));
 console.log(JSON.stringify({mode,status:report.status,checks:report.checks.length,failure:report.failure,errors:report.errors,networkFailures:report.networkFailures,report:`${directory}/report.json`}));
 await browser?.close();
}
