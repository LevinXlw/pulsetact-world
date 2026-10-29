import {createHash} from 'node:crypto';
import {setDefaultResultOrder} from 'node:dns';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {GZIP_ASSET_PATHS} from './prepare-cloudflare.mjs';
import {chromium,expect} from '@playwright/test';
import {authenticateContext} from './test-auth.mjs';

// Release-only smoke: actual UI, pixels, authenticated requests and deployed
// bytes. No source-module imports, dev inspector, injected player pose, failed
// password attempts or production mutations other than short-lived sessions.
export const BU_RELEASE_DESTINATIONS = [
 ['bu-mugar','Mugar Memorial Library'],
 ['bu-gsu','George Sherman Union'],
 ['bu-questrom','Questrom 商学院'],
 ['bu-agganis','Agganis Arena'],
 ['bu-nickerson','Nickerson Field · West Campus'],
 ['bu-warren','Warren Towers'],
];
export const BOSTON_GZIP_RELEASE_PATHS = GZIP_ASSET_PATHS.filter(path=>path.includes('boston')).map(path=>'/'+path);
export async function readReleaseAsset(root,path){
 root=resolve(root);
 const file=resolve(root,'.'+path);
 if(!path.startsWith('/')||!file.startsWith(root+sep))throw Error('Asset path escaped the release directory.');
 try{return await readFile(file);}
 catch(error){
  if(error.code!=='ENOENT'||!GZIP_ASSET_PATHS.includes(path.slice(1)))throw error;
  // Browser response bodies have Content-Encoding decoded. Compare them with
  // the exact original bytes even though staging only contains the .gz file.
  return gunzipSync(await readFile(file+'.gz'));
 }
}

// Observed in the 2026-10-28 production navigation response. This is an exact
// byte allowlist, not an HTML parser or a general third-party-script filter.
const CLOUDFLARE_HTML_BEACON = Buffer.from(`<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js/vce701823e78c4301a35b7e07294d87301792088814092" integrity="sha512-UKNk8GbxkABxKcXYuLkO16EleLGUkcvJWtpSNmExE0Too3ZaFAxTscNWEc1OdAv5/BikHawapSCaiD2XCmp+Bw==" data-cf-beacon='{"version":"2024.11.0","token":"ccdc34405cf54ca8bbefd51a664ffa35","r":1,"spa":2}' crossorigin="anonymous"></script>\n`);
const releaseHash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function verifyReleaseAssetBytes(path,actual,expected){
 actual=Buffer.from(actual);expected=Buffer.from(expected);
 const rawSha256=releaseHash(actual),expectedSha256=releaseHash(expected);
 let normalized=actual,removedBytes=0,beaconSha256=null;
 if(!actual.equals(expected)&&path==='/index.html'){
  const start=actual.indexOf(CLOUDFLARE_HTML_BEACON);
  // Require exactly one full known beacon, directly before the sole closing
  // body tag. All remaining bytes, including line endings, must match staging.
  const body=actual.indexOf('</body>');
  if(start>=0&&start===actual.lastIndexOf(CLOUDFLARE_HTML_BEACON)&&
     body===start+CLOUDFLARE_HTML_BEACON.length&&body===actual.lastIndexOf('</body>')){
   normalized=Buffer.concat([actual.subarray(0,start),actual.subarray(body)]);
   removedBytes=CLOUDFLARE_HTML_BEACON.length;beaconSha256=releaseHash(CLOUDFLARE_HTML_BEACON);
  }
 }
 const normalizedSha256=releaseHash(normalized);
 if(!normalized.equals(expected))throw Error(`Exact release bytes mismatch: ${path}; expected=${expectedSha256}; raw=${rawSha256}; normalized=${normalizedSha256}`);
 return {path,bytes:actual.length,sha256:rawSha256,rawSha256,expectedSha256,normalizedSha256,removedBytes,beaconSha256};
}

// Capture only release-integrity inputs, while each runtime response is still
// available. Redirects/revalidation cannot replace the first 200 download.
export function createRuntimeIntegrityCapture(mobile=false){
 const records=new Map(),diagnostics=[];
 const wanted=path=>/^\/(?:assets|data)\/.*\.(?:js|css)$/.test(path)||
  mobile&&['/assets/mit-residences/boston-without-residences.glb','/data/mobile/boston.json'].includes(path);
 return {
  diagnostics,
  paths:()=>[...records.keys()],
  has:path=>Boolean(records.get(path)?.body),
  observe(path,response){
   if(!wanted(path))return;
   const status=response.status(),entry=records.get(path)??{body:null};records.set(path,entry);
   const diagnostic={path,status,captured:false,source:response.source??'playwright'};if(response.requestId)diagnostic.requestId=response.requestId;diagnostics.push(diagnostic);
   if(status!==200){diagnostic.reason='non-200';return;}
   if(entry.body){diagnostic.reason='first-200-already-captured';return;}
   diagnostic.captured=true;
   // Call body() now, not at the end of a long tour or after a reload. Attach
   // rejection handling now too, so failures are reported without an unhandled
   // promise or silently replacing the failed download with another response.
   const failed=error=>{diagnostic.bodyError=String(error?.message??error);return {error:diagnostic.bodyError};};
   try{
    entry.body=Promise.resolve(response.body()).then(bytes=>{
     diagnostic.bytes=bytes.length;return {bytes,status};
    },failed);
   }catch(error){entry.body=Promise.resolve(failed(error));}
  },
  async read(path){
   const entry=records.get(path);
   if(!entry?.body)throw Error(`No actual runtime 200 response captured: ${path}`);
   const result=await entry.body;
   if(result.error)throw Error(`Runtime response body unavailable: ${path}: ${result.error}`);
   return result;
  },
 };
}

export const MOBILE_RUNTIME_BASE_PATH='/assets/mit-residences/boston-without-residences.glb';
export const INTEGRITY_CDP_BUFFER={maxTotalBufferSize:256*1024*1024,maxResourceBufferSize:64*1024*1024};
// Dedicated inspector retention for this test's large actual runtime download.
// These buffers are not part of the game and are not a phone memory measurement.
export async function installLargeModelIntegrityCapture(session,origin,capture){
 const pending=new Map();let disposed=false;
 const fail=(requestId,error)=>{const request=pending.get(requestId);if(!request)return;pending.delete(requestId);request.reject(error);};
 const received=event=>{
  if(disposed)return;
  const url=new URL(event.response.url);
  if(url.origin!==origin||url.pathname!==MOBILE_RUNTIME_BASE_PATH)return;
  capture.observe(url.pathname,{
   status:()=>event.response.status,source:'cdp',requestId:event.requestId,
   // The shared collector invokes this only for the first 200, immediately.
   // It waits until loadingFinished before asking this same CDP session for bytes.
   body:()=>new Promise((resolve,reject)=>pending.set(event.requestId,{resolve,reject,reading:false})),
  });
 };
 const finished=event=>{
  const request=pending.get(event.requestId);if(!request||request.reading||disposed)return;
  request.reading=true;
  try{
   Promise.resolve(session.send('Network.getResponseBody',{requestId:event.requestId})).then(result=>{
    if(!pending.has(event.requestId))return;
    const bytes=Buffer.from(result.body,result.base64Encoded?'base64':'utf8');
    pending.delete(event.requestId);request.resolve(bytes);
   }).catch(error=>fail(event.requestId,error));
  }catch(error){fail(event.requestId,error);}
 };
 const failed=event=>fail(event.requestId,Error(`CDP runtime download failed: ${event.errorText||'Network.loadingFailed'}`));
 const dispose=(reason='Inspector capture closed before download completed')=>{
  if(disposed)return;disposed=true;
  session.off('Network.responseReceived',received);session.off('Network.loadingFinished',finished);session.off('Network.loadingFailed',failed);
  for(const requestId of pending.keys())fail(requestId,Error(reason));
 };
 session.on('Network.responseReceived',received);session.on('Network.loadingFinished',finished);session.on('Network.loadingFailed',failed);
 try{await session.send('Network.enable',INTEGRITY_CDP_BUFFER);}catch(error){dispose();throw error;}
 return {dispose,bufferSettings:{...INTEGRITY_CDP_BUFFER}};
}

async function main(){
setDefaultResultOrder('ipv4first');
const base=new URL(process.env.WORLD_VERIFY_URL||process.argv.find(arg=>/^https?:\/\//.test(arg))||'https://world.pulsetact.ai');
if(base.username||base.password)throw Error('Do not embed credentials in the release URL.');
if(base.protocol!=='https:')throw Error('This release smoke requires HTTPS with valid certificate verification.');
const root=resolve(process.env.BU_RELEASE_DIST||'dist-cloud');
const directory=process.env.BU_RELEASE_DIRECTORY||'output/deployment/bu-release-20261024';
const modes=process.argv.includes('--mobile')?['mobile']:process.argv.includes('--desktop')?['desktop']:['desktop','mobile'];
const expectedVersion=process.env.WORLD_EXPECTED_VERSION;
const url=path=>new URL(path,base).href;
const redact=value=>String(value).replace(/(pulsetact_session\s*[=:]\s*)[^\s;,"']+/gi,'$1[redacted]');
const report={base:base.origin,startedAt:new Date().toISOString(),status:'running',checks:[],integrity:[],modes:[]};
await mkdir(directory,{recursive:true});
const local=path=>readReleaseAsset(root,path);
const check=(name,details={})=>{report.checks.push({name,...details});console.log(`PASS ${name}`);};
async function verifyBytes(path,bytes,status){
 expect(status,`Successful ${path}`).toBe(200);
 report.integrity.push(verifyReleaseAssetBytes(path,bytes,await local(path)));
}
let browser;
async function runMode(mode){
 const mobile=mode==='mobile',result={mode,checks:[],errors:[],networkFailures:[],views:[],requests:[]};report.modes.push(result);
 const context=await browser.newContext({...(mobile?{viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true}:{viewport:{width:1500,height:960},deviceScaleFactor:1}),...(process.env.WORLD_VERIFY_PROXY?{proxy:{server:process.env.WORLD_VERIFY_PROXY}}:{})});
 const page=await context.newPage(),responses=createRuntimeIntegrityCapture(mobile);page.setDefaultTimeout(30000);
 result.integrityResponses=responses.diagnostics;
 let integritySession,largeModelCapture;
 if(mobile){
  integritySession=await context.newCDPSession(page);
  largeModelCapture=await installLargeModelIntegrityCapture(integritySession,base.origin,responses);
  result.integrityInspector={scope:'test-only response retention; not game runtime or phone memory',...largeModelCapture.bufferSettings};
  page.on('close',()=>largeModelCapture.dispose('Page closed before runtime download completed'));
  context.on('close',()=>largeModelCapture.dispose('Context closed before runtime download completed'));
 }
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
  if(path.startsWith('/assets/')||path.startsWith('/data/')){if(!mobile||path!==MOBILE_RUNTIME_BASE_PATH)responses.observe(path,response);if(response.status()>=400)result.networkFailures.push({path,status:response.status()});}
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
  // Detect a mostly blank/transparent canvas, while allowing legitimate translucent
  // glass. Keep near-opaque coverage as a diagnostic, not a visibility requirement.
  const pixels=await page.locator('.pw-scene canvas').evaluate(async source=>{
   await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));
   const canvas=document.createElement('canvas');canvas.width=64;canvas.height=48;
   const ctx=canvas.getContext('2d');ctx.drawImage(source,0,0,64,48);const bytes=ctx.getImageData(0,0,64,48).data,colors=new Set();let opaque=0,visible=0,lo=255,hi=0;
   for(let i=0;i<bytes.length;i+=4){if(bytes[i+3]>240)opaque++;if(bytes[i+3]>16)visible++;colors.add(`${bytes[i]>>4},${bytes[i+1]>>4},${bytes[i+2]>>4}`);const light=(bytes[i]+bytes[i+1]+bytes[i+2])/3;lo=Math.min(lo,light);hi=Math.max(hi,light);}
   return{width:source.width,height:source.height,opaqueRatio:opaque/(64*48),visibleCoverageRatio:visible/(64*48),colors:colors.size,range:hi-lo};
  });
  expect(pixels.width).toBeGreaterThan(100);expect(pixels.height).toBeGreaterThan(100);expect(pixels.visibleCoverageRatio).toBeGreaterThan(.95);expect(pixels.colors).toBeGreaterThan(12);expect(pixels.range).toBeGreaterThan(30);
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
  for(const [id,title] of BU_RELEASE_DESTINATIONS){
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
  // The normal globe UI provides a public route back to the MIT Killian
  // Court arrival. This default view does not verify the main-building facade.
  await activate(page.getByRole('navigation',{name:'世界菜单',exact:true}).getByRole('button',{name:'地图',exact:true}));
  await activate(page.getByRole('button',{name:'地球总览',exact:true}));
  await activate(page.getByRole('button',{name:'查看 MIT 的地理位置',exact:true}));
  await activate(page.getByRole('button',{name:'进入 MIT 校园',exact:true}));await ready();
  await expect.poll(async()=>(await saved())?.trackedId,{timeout:15000}).toBe('axis');
  await expect(page.locator('.pw-location')).toContainText('MIT');
  await capture('mit-killian-arrival');passed('normal globe travel back to MIT Killian Court arrival');
  // Integrity is checked against the exact staged release, including hashed
  // lazy JS chunks that generate new desktop facade/court geometry. Read the
  // already-fetched response body so this does not re-download every bundle.
  const paths=responses.paths().filter(path=>/\.(?:js|css)$/.test(path));
  expect(paths.length).toBeGreaterThan(2);
  if(mobile){
   const basePath=MOBILE_RUNTIME_BASE_PATH;
   expect(responses.has(basePath),'Phone loaded the current replacement campus, not a fallback').toBe(true);
   paths.push(basePath,'/data/mobile/boston.json');
  }
  for(const path of paths){const response=await responses.read(path);await verifyBytes(path,response.bytes,response.status);}
  if(mobile){
   // Check both replacement stages and the protected fallback, including exact
   // decompressed bytes and conditional cache metadata on the stable URLs.
   for(const path of BOSTON_GZIP_RELEASE_PATHS){
    const response=await context.request.get(url(path),{headers:{'cache-control':'no-cache','accept-encoding':'gzip'},timeout:120000});
    const headers=response.headers(),etag=headers.etag;
    expect(headers['content-encoding'],`gzip ${path}`).toBe('gzip');
    expect(headers['content-type']).toContain('model/gltf-binary');expect(etag).toBeTruthy();
    if(path.startsWith('/data/'))expect(headers['cache-control']).toContain('private');
    await verifyBytes(path,await response.body(),response.status());await response.dispose();
    const head=await context.request.head(url(path),{headers:{'accept-encoding':'gzip'},timeout:120000});
    expect(head.status()).toBe(200);expect((await head.body()).length).toBe(0);
    const headHeaders=head.headers();
    for(const name of ['etag','cache-control','content-encoding','content-type'])expect(headHeaders[name],`HEAD ${name}: ${path}`).toBe(headers[name]);
    await head.dispose();
    const conditional=await context.request.get(url(path),{headers:{'if-none-match':etag,'accept-encoding':'gzip'},timeout:120000});
    expect(conditional.status(),`Conditional request ${path}`).toBe(304);expect((await conditional.body()).length).toBe(0);
    for(const name of ['etag','cache-control','content-encoding'])expect(conditional.headers()[name],`304 ${name}: ${path}`).toBe(headers[name]);
    await conditional.dispose();
    check(`gzip GET, HEAD and conditional 304: ${path}`,{etag,cacheControl:headers['cache-control'],compressedBytes:Number(headers['content-length'])||null});
   }
  }
  passed('HTML, actual runtime bundles and mobile campus bytes match staged SHA-256');
  expect(result.errors).toEqual([]);expect(result.networkFailures).toEqual([]);passed('no page, WebGL, crash or resource errors');result.status='passed';
 }catch(error){result.status='failed';result.failure=redact(error?.message??error);await page.screenshot({path:`${directory}/${mode}-failure.png`}).catch(()=>{});throw Error(`${mode}: ${result.failure}`);}
 finally{
  // Revoke only this new test session; never invalidate another browser's.
  largeModelCapture?.dispose();await integritySession?.detach().catch(()=>{});
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

}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)await main();
