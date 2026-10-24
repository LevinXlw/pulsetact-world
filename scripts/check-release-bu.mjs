import {createHash} from 'node:crypto';
import {setDefaultResultOrder} from 'node:dns';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {authenticateContext} from './test-auth.mjs';

// Release-only smoke: actual UI, pixels, authenticated requests and deployed
// bytes. No source-module imports, dev inspector, injected player pose, failed
// password attempts or production mutations other than short-lived sessions.
setDefaultResultOrder('ipv4first');
const base=new URL(process.env.WORLD_VERIFY_URL||process.argv.find(arg=>/^https?:\/\//.test(arg))||'https://world.pulsetact.ai');
if(base.username||base.password)throw Error('Do not embed credentials in the release URL.');
if(base.protocol!=='https:')throw Error('This release smoke requires HTTPS with valid certificate verification.');
const root=resolve(process.env.BU_RELEASE_DIST||'dist-cloud');
const directory=process.env.BU_RELEASE_DIRECTORY||'output/deployment/bu-release-20261024';
const modes=process.argv.includes('--mobile')?['mobile']:process.argv.includes('--desktop')?['desktop']:['desktop','mobile'];
const expectedVersion=process.env.WORLD_EXPECTED_VERSION;
const hash=buffer=>createHash('sha256').update(buffer).digest('hex');
const url=path=>new URL(path,base).href;
const redact=value=>String(value).replace(/(pulsetact_session\s*[=:]\s*)[^\s;,"']+/gi,'$1[redacted]');
const report={base:base.origin,startedAt:new Date().toISOString(),status:'running',checks:[],integrity:[],modes:[]};
await mkdir(directory,{recursive:true});
const local=path=>{
 const file=resolve(root,'.'+path);
 if(!file.startsWith(root+sep))throw Error('Asset path escaped the release directory.');
 return readFile(file);
};
const check=(name,details={})=>{report.checks.push({name,...details});console.log(`PASS ${name}`);};
async function verifyBytes(path,bytes,status){
 const expected=await local(path),actualSha256=hash(bytes),expectedSha256=hash(expected);
 expect(status,`Successful ${path}`).toBe(200);expect(actualSha256,`Exact release bytes: ${path}`).toBe(expectedSha256);
 report.integrity.push({path,bytes:bytes.length,sha256:actualSha256});
}
let browser;
async function runMode(mode){
 const mobile=mode==='mobile',result={mode,checks:[],errors:[],networkFailures:[],views:[],requests:[]};report.modes.push(result);
 const context=await browser.newContext(mobile?{viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true}:{viewport:{width:1500,height:960},deviceScaleFactor:1});
 const page=await context.newPage(),responses=new Map();page.setDefaultTimeout(30000);
 const activate=locator=>mobile?locator.tap():locator.click();
 const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('pulsetact.world.solo.v1')||'null'));
 const passed=name=>{result.checks.push(name);check(`${mode}: ${name}`);};
 const assetPath=value=>{const parsed=new URL(value);return parsed.origin===base.origin?parsed.pathname:null;};
 page.on('pageerror',error=>result.errors.push(redact(error.message)));
 page.on('crash',()=>result.errors.push('Browser page crashed'));
 page.on('console',message=>{if(message.type()==='error'&&/WebGLProgram|VALIDATE_STATUS|shader error|GL_INVALID|Context Lost|WebGL context/i.test(message.text()))result.errors.push(redact(message.text()));});
 page.on('request',request=>{const path=assetPath(request.url());if(path?.startsWith('/assets/')||path?.startsWith('/data/'))result.requests.push(path);});
 page.on('response',response=>{
  const path=assetPath(response.url());if(!path)return;
  if(path.startsWith('/assets/')||path.startsWith('/data/')){responses.set(path,response);if(response.status()>=400)result.networkFailures.push({path,status:response.status()});}
 });
 page.on('requestfailed',request=>{const path=assetPath(request.url()),failure=request.failure()?.errorText||'Unknown failure';if(path&&/^(\/assets\/|\/data\/)/.test(path)&&!/ERR_ABORTED|cancelled|canceled/i.test(failure))result.networkFailures.push({path,error:redact(failure)});});
 async function ready(){
  await expect(page.getByRole('navigation',{name:'世界菜单',exact:true})).toBeVisible({timeout:180000});
  await expect(page.getByRole('button',{name:'拍照下载',exact:true})).toBeEnabled({timeout:180000});
  await expect(page.locator('.pw-loading')).toHaveCount(0,{timeout:180000});
  await expect(page.locator('.pw-scene-error')).toHaveCount(0);await expect(page.locator('.pw-scene canvas')).toHaveCount(1);
  await expect.poll(async()=>(await saved())?.campus,{timeout:15000}).toBe('boston');
 }
 async function capture(name){
  await page.waitForTimeout(900);
  const pixels=await page.locator('.pw-scene canvas').evaluate(async source=>{
   await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));
   const canvas=document.createElement('canvas');canvas.width=64;canvas.height=48;
   const ctx=canvas.getContext('2d');ctx.drawImage(source,0,0,64,48);const bytes=ctx.getImageData(0,0,64,48).data,colors=new Set();let opaque=0,lo=255,hi=0;
   for(let i=0;i<bytes.length;i+=4){if(bytes[i+3]>240)opaque++;colors.add(`${bytes[i]>>4},${bytes[i+1]>>4},${bytes[i+2]>>4}`);const light=(bytes[i]+bytes[i+1]+bytes[i+2])/3;lo=Math.min(lo,light);hi=Math.max(hi,light);}
   return{width:source.width,height:source.height,opaqueRatio:opaque/(64*48),colors:colors.size,range:hi-lo};
  });
  expect(pixels.width).toBeGreaterThan(100);expect(pixels.height).toBeGreaterThan(100);expect(pixels.opaqueRatio).toBeGreaterThan(.9);expect(pixels.colors).toBeGreaterThan(12);expect(pixels.range).toBeGreaterThan(30);
  await page.screenshot({path:`${directory}/${mode}-${name}.png`});result.views.push({name,pixels,position:(await saved()).position,trackedId:(await saved()).trackedId});
 }
 async function travel(id,title){
  await activate(page.getByRole('navigation',{name:'世界菜单',exact:true}).getByRole('button',{name:'地图',exact:true}));
  const bu=page.getByRole('button',{name:'河岸与 BU',exact:true});if(await bu.isVisible())await activate(bu);
  await page.getByLabel('选择 BU 校园分区',{exact:true}).selectOption('all');
  await page.getByLabel('搜索 BU 建筑或地点',{exact:true}).fill(title);
  await activate(page.getByRole('button',{name:`快速前往${title}`,exact:true}));await ready();
  await expect(page.locator('.pw-location')).toContainText('BOSTON UNIVERSITY');
  await expect.poll(async()=>(await saved())?.trackedId,{timeout:15000}).toBe(id);
  await expect.poll(async()=>{const p=(await saved())?.position;return Array.isArray(p)&&p.length===2&&p.every(Number.isFinite);}).toBe(true);
 }
 try{
  // Only known protected routes are required to reject unauthenticated access;
  // architectural public GLBs are intentionally outside that Worker prefix.
  for(const path of ['/api/auth/session','/data/mobile/boston.json','/assets/bu-cds-interior/manifest.json']){
   const response=await context.request.get(url(path));expect(response.status(),`Anonymous ${path}`).toBe(401);await response.dispose();
  }
  const health=await context.request.get(url('/api/health'));expect(health.status()).toBe(200);const state=await health.json();await health.dispose();
  expect(state.ok).toBe(true);expect(state.version).not.toBe('local');if(expectedVersion)expect(state.version).toBe(expectedVersion);
  result.version=state.version;
  const document=await page.goto(url('/'),{waitUntil:'domcontentloaded'});expect(new URL(page.url()).protocol).toBe('https:');
  expect(document.headers()['cache-control']).toContain('no-store');await verifyBytes('/index.html',await document.body(),document.status());
  await expect(page.getByRole('button',{name:'登录',exact:true})).toBeVisible();await expect(page.locator('canvas')).toHaveCount(0);
  // test-auth owns all credential access; no passwords/cookies enter logs or
  // page scripts. One valid POST establishes the same HttpOnly session as UI.
  await authenticateContext(context,base.origin);
  const cookies=await context.cookies(),session=cookies.find(c=>c.name==='pulsetact_session');expect(Boolean(session)).toBe(true);expect(session.httpOnly).toBe(true);expect(session.secure).toBe(true);expect(session.sameSite).toBe('Lax');
  const auth=await context.request.get(url('/api/auth/session'));expect(auth.status()).toBe(200);expect((await auth.json()).authenticated).toBe(true);await auth.dispose();
  await page.reload({waitUntil:'domcontentloaded'});await expect(page.getByLabel('旅途中，怎么称呼你？',{exact:true})).toBeVisible();
  await page.getByLabel('旅途中，怎么称呼你？',{exact:true}).fill(mobile?'BU 手机发布验收':'BU 发布验收');
  await activate(page.getByRole('button',{name:/开始校园漫游|继续校园漫游/}));await ready();
  passed('HTTPS, release version, protected resources, valid authentication and nickname entry');
  for(const [id,title] of [['bu-mugar','Mugar Memorial Library'],['bu-gsu','George Sherman Union'],['bu-warren','Warren Towers']]){
   await travel(id,title);await capture(id);passed(`real map travel and rendered view: ${title}`);
  }
  if(mobile){
   await activate(page.getByRole('button',{name:'设置',exact:true}));await activate(page.getByRole('button',{name:'切换高清材质',exact:true}));
   const close=page.getByRole('button',{name:'关闭面板',exact:true});if(await close.isVisible())await activate(close);
   await ready();await expect.poll(async()=>(await saved())?.quality).toBe('standard');await capture('warren-hd');
   await travel('bu-mugar','Mugar Memorial Library');await capture('link-hd');
   expect(result.requests.some(path=>['/assets/bu-cds/cds-full.glb','/assets/bu-questrom/questrom-full.glb'].includes(path))).toBe(false);
   passed('phone HD remains in mobile models at both Warren and the shared Link');
  }
  // Integrity is checked against the exact staged release, including hashed
  // lazy JS chunks that generate new desktop facade/court geometry. Read the
  // already-fetched response body so this does not re-download every bundle.
  const paths=[...responses.keys()].filter(path=>/\.(?:js|css)$/.test(path));
  expect(paths.length).toBeGreaterThan(2);
  if(mobile){
   const basePath='/assets/mit-residences/boston-without-residences.glb';
   expect(responses.has(basePath),'Phone loaded the current replacement campus, not a fallback').toBe(true);
   paths.push(basePath,'/data/mobile/boston.json');
  }
  for(const path of paths){const response=responses.get(path);expect(response,`Runtime request ${path}`).toBeDefined();await verifyBytes(path,await response.body(),response.status());}
  if(mobile){
   // The protected fallback must also be from this release if a later model
   // request fails. Its download is separate from the live render checks.
   const path='/data/mobile/boston.glb',response=await context.request.get(url(path),{headers:{'cache-control':'no-cache'},timeout:120000});
   expect(response.headers()['cache-control']).toContain('private');await verifyBytes(path,await response.body(),response.status());await response.dispose();
  }
  passed('HTML, actual runtime bundles and mobile campus bytes match staged SHA-256');
  expect(result.errors).toEqual([]);expect(result.networkFailures).toEqual([]);passed('no page, WebGL, crash or resource errors');result.status='passed';
 }catch(error){result.status='failed';result.failure=redact(error?.message??error);await page.screenshot({path:`${directory}/${mode}-failure.png`}).catch(()=>{});throw Error(`${mode}: ${result.failure}`);}
 finally{
  // Revoke only this new test session; never invalidate another browser's.
  await context.request.post(url('/api/auth/logout')).then(r=>r.dispose()).catch(()=>{});await context.close();
 }
}
try{
 await local('/index.html'); // Refuse to guess at release identity before build.
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 for(const mode of modes)await runMode(mode);
 if(report.modes.length>1)expect(new Set(report.modes.map(mode=>mode.version)).size,'Both modes observed one deployment version').toBe(1);
 report.status='passed';
}catch(error){report.status='failed';report.failure=redact(error?.message??error);process.exitCode=1;}
finally{
 report.finishedAt=new Date().toISOString();await writeFile(`${directory}/report.json`,JSON.stringify(report,null,2));
 console.log(JSON.stringify({status:report.status,checks:report.checks.length,failure:report.failure,versions:report.modes.map(m=>m.version),report:`${directory}/report.json`}));await browser?.close();
}
