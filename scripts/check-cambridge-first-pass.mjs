import {chromium} from '@playwright/test';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const output='docs/screenshots/cambridge-first-pass';
const base=process.env.CAMBRIDGE_BASE_URL||'http://127.0.0.1:5173';
const captureOnly=process.argv.includes('--capture-only');
const recordVideo=!process.argv.includes('--no-video')&&!captureOnly;
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1});
const page=await context.newPage(),errors=[],requests=[],records=[],route=[];
let performance,lowPerformance,failure;
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
page.on('requestfinished',request=>requests.push(request.url()));
const state=()=>page.evaluate(()=>window.__localCampus);
async function settle(){await page.waitForTimeout(350);await page.evaluate(()=>new Promise(resolve=>{let frames=0;const tick=()=>++frames===20?resolve():requestAnimationFrame(tick);requestAnimationFrame(tick);}));}
async function metrics(){return page.evaluate(()=>new Promise(resolve=>{
 const canvas=document.querySelector('canvas'),gl=canvas.getContext('webgl2'),ext=gl?.getExtension('WEBGL_debug_renderer_info'),gpu=ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl?.getParameter(gl.RENDERER);
 const frames=[];let start=0,last=0;
 function tick(t){if(!start)start=t;if(last)frames.push(t-last);last=t;if(t-start<5000)requestAnimationFrame(tick);else{frames.sort((a,b)=>a-b);resolve({medianMs:frames[Math.floor(frames.length*.5)],p95Ms:frames[Math.floor(frames.length*.95)],fps:frames.length*1000/(t-start),frames:frames.length,durationMs:t-start,gpu,userAgent:navigator.userAgent,viewport:[innerWidth,innerHeight],dpr:devicePixelRatio,quality:window.__localCampus?.quality});}}
 requestAnimationFrame(tick);
}));}
async function capture(key,label){
 await settle();const scene=await state();assert.ok(Math.abs(scene.cameraPosition[1]-scene.cameraGroundHeight-1.65)<.06,`${label}: camera remains at human eye height`);assert.equal(scene.fov,48);
 const clean=await page.addStyleTag({content:'.real-toolbar,.real-status,.courtyard-caption,.local-credit,.scene-popover{visibility:hidden!important}'});
 try{await page.locator('canvas').screenshot({path:`${output}/${key}.png`});}finally{await clean.evaluate(el=>el.remove());}
 records.push({key,label,scene});console.log('Captured',label);
}
async function walk(target,label){
 // Turn through actual pointer drags so the recorded loop also checks looking
 // around while walking, including the return from the portico.
 const before=await state(),dx=target[0]-before.position[0],dz=target[1]-before.position[2];
 if(Math.hypot(dx,dz)>.55){
  const yaw=Math.atan2(-before.cameraForward[0],-before.cameraForward[2]),aim=Math.atan2(-dx,-dz);
  const turn=Math.atan2(Math.sin(aim-yaw),Math.cos(aim-yaw));
  const bounds=await page.locator('canvas').boundingBox();assert.ok(bounds);
  let pixels=-turn/.003;
  while(Math.abs(pixels)>.1){const step=Math.sign(pixels)*Math.min(280,Math.abs(pixels));
   const x=bounds.x+bounds.width/2,y=bounds.y+bounds.height*.62;
   await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+step,y,{steps:12});await page.mouse.up();pixels-=step;
  }
  await page.waitForTimeout(350);
 }
 let held=[],last,still=0;
 try{for(let i=0;i<400;i++){
  const current=await state(),dx=target[0]-current.position[0],dz=target[1]-current.position[2],distance=Math.hypot(dx,dz);
  assert.ok(Math.abs(current.cameraPosition[1]-current.cameraGroundHeight-1.65)<.08,`${label}: grounded eye height`);assert.equal(current.fov,48);
  if(distance<.55){route.push({label,target,scene:current});console.log('Reached',label,current.position.map(n=>+n.toFixed(2)));return;}
  if(last&&Math.hypot(current.position[0]-last[0],current.position[2]-last[2])<.006)still++;else still=0;
  if(still>24)throw new Error(`${label}: movement blocked ${distance.toFixed(2)} m before target, at ${JSON.stringify(current.position)}`);
  last=current.position;
  const [fx,,fz]=current.cameraForward,length=Math.hypot(fx,fz),forward=(dx*fx+dz*fz)/length,right=(-dx*fz+dz*fx)/length,next=distance>4?['Shift']:[];
  if(Math.abs(forward)>distance*.3)next.push(forward>0?'w':'s');
  if(Math.abs(right)>distance*.3)next.push(right>0?'d':'a');
  for(const key of held)if(!next.includes(key))await page.keyboard.up(key);
  for(const key of next)if(!held.includes(key))await page.keyboard.down(key);
  held=next;await page.waitForTimeout(140);
 }throw new Error(`${label}: route timeout toward ${JSON.stringify(target)}`);}finally{for(const key of held)await page.keyboard.up(key);}
}
try{
 await page.goto(`${base}/real/mit`);await page.getByRole('button',{name:'拍照',exact:true}).waitFor({timeout:60000});
 await page.waitForFunction(()=>window.__localCampus?.mode==='stroll'&&window.__localCampus?.vegetationStatus==='ready',null,{timeout:90000});
 await capture('hero-south-edge','南缘看主楼');performance=await metrics();console.log('Standard frame sample',performance);
 for(const [label,key] of [['主楼门窗','hero-door'],['柱廊侧视','hero-portico'],['3 号楼庭院面','hero-building3'],['4 号楼庭院面','hero-building4'],['西侧树荫','hero-westshade']]){
  await page.getByRole('button',{name:'机位',exact:true}).click();await page.getByRole('button',{name:label,exact:true}).click();await capture(key,label);
 }
 await page.getByRole('button',{name:'环境漫步',exact:true}).click();await page.waitForFunction(()=>window.__localCampus?.mode==='stroll');
 await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'画质：标准',exact:true}).click();await page.keyboard.press('Escape');await page.waitForFunction(()=>window.__localCampus?.quality==='low');await settle();lowPerformance=await metrics();await capture('hero-low-quality','低画质南缘');console.log('Low frame sample',lowPerformance);
 await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'画质：省电',exact:true}).click();await page.getByRole('button',{name:'回到入口',exact:true}).click();await page.waitForFunction(()=>window.__localCampus?.quality==='standard');await settle();
 if(!captureOnly){
  if(recordVideo)await page.evaluate(()=>{
   const stream=document.querySelector('canvas').captureStream(24),chunks=[],recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8',videoBitsPerSecond:2200000});
   recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
   window.__stopCambridgeRecording=()=>new Promise(resolve=>{recorder.onstop=()=>{stream.getTracks().forEach(t=>t.stop());const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(new Blob(chunks,{type:'video/webm'}));};recorder.stop();});recorder.start(500);
  });
  const manifest=JSON.parse(await readFile('public/data/killian/detail-manifest.json','utf8')),o=manifest.porticoOpening;
  const at=(u,s)=>[o.center[0]+o.normal[2]*u+o.normal[0]*s,o.center[2]-o.normal[0]*u+o.normal[2]*s];
  const routePoints=[[0,110,'南缘入口'],[0,7,'主楼台阶前'],[0,1,'柱廊平台'],[0,7,'退回台阶前'],[-20,7,'柱廊西侧'],[-28,66,'西侧树荫步道'],[-28,80,'草坪西侧'],[0,110,'返回南缘入口']];
  for(const [u,s,label] of routePoints)await walk(at(u,s),label);
  await page.screenshot({path:`${output}/courtyard-return.png`});console.log('Courtyard closed walking loop passed',route.length,'waypoints');
 }
 assert.deepEqual(errors,[],'no browser runtime errors');assert.ok(requests.every(url=>!/^https?:/.test(url)||url.startsWith(base)),'all scene resources are local');
 assert.ok(!requests.some(url=>/\/data\/killian\/vegetation\.glb/.test(url)),'instanced trees must not fetch legacy foliage');
}catch(error){failure={message:error.message,stack:error.stack,scene:await state().catch(()=>null)};console.error(error.message);await page.screenshot({path:`${output}/route-or-capture-failure.png`}).catch(()=>{});process.exitCode=1;}
finally{
 if(recordVideo){try{const video=await page.evaluate(()=>window.__stopCambridgeRecording?.());if(video)await writeFile(`${output}/courtyard-walk.webm`,Buffer.from(video,'base64'));}catch(error){errors.push(`Video: ${error.message}`);}}
 await writeFile(`${output}/walk-report.json`,JSON.stringify({checkedAt:new Date().toISOString(),base,captureOnly,records,route,performance,lowPerformance,errors,failure,note:'Five-second headless development-browser samples, not the ten-minute target-device performance acceptance.'},null,2));
 await context.close();await browser.close();
}
