import {chromium} from '@playwright/test';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const stage=process.argv.includes('--baseline')?'before':'after';
const root=`docs/screenshots/portico-v2/${stage}`;
await mkdir(root,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const context=await browser.newContext({viewport:{width:1440,height:900}});
 const page=await context.newPage(),errors=[],records=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 page.on('requestfinished',r=>requests.push(r.url()));
 await page.goto('http://127.0.0.1:5173/real/mit');
 await page.waitForFunction(()=>window.__localCampus?.vegetationStatus==='ready',null,{timeout:60000});
 await page.getByRole('button',{name:'环境展示',exact:true}).click();
 // Hide controls for matched inspection captures, without changing the camera or scene.
 const controlStyle=await page.addStyleTag({content:'.real-toolbar,.inspection-views,.real-status{visibility:hidden}'});
 for(const [label,key] of [['步行视角','front'],['柱廊近景','entrance'],['主楼门窗','door'],['柱廊侧视','side']]){
  const button=page.getByRole('button',{name:label,exact:true,includeHidden:true});
  await button.evaluate(b=>b.style.visibility='visible');
  await button.click();
  await button.evaluate(b=>b.style.visibility='hidden');
  await page.waitForTimeout(900);
  const scene=await page.evaluate(()=>window.__localCampus);
  assert.ok(Math.abs(scene.cameraPosition[1]-scene.cameraGroundHeight-1.65)<.06,`${label}: human height`);
  await page.locator('canvas').screenshot({path:`${root}/${key}.png`});
  records.push({key,scene});
 }
 const performance=await page.evaluate(()=>new Promise(resolve=>{
  const frames=[];let start=0,last=0;function frame(t){if(!start)start=t;if(last)frames.push(t-last);last=t;if(t-start<5000)requestAnimationFrame(frame);else{frames.sort((a,b)=>a-b);resolve({medianMs:frames[Math.floor(frames.length*.5)],p95Ms:frames[Math.floor(frames.length*.95)],frames:frames.length,durationMs:t-start,userAgent:navigator.userAgent});}}requestAnimationFrame(frame);
 }));
 if(stage==='after'){
  await controlStyle.evaluate(el=>el.remove());
  await page.getByRole('button',{name:'角色漫游',exact:true}).click();
  if(!process.argv.includes('--no-video'))await page.evaluate(()=>{
   const stream=document.querySelector('canvas').captureStream(30),chunks=[];
   const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8',videoBitsPerSecond:2500000});
   recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
   window.__stopPorticoRecording=()=>new Promise(resolve=>{
    recorder.onstop=()=>{stream.getTracks().forEach(t=>t.stop());const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(new Blob(chunks,{type:'video/webm'}));};
    recorder.stop();
   });recorder.start(300);
  });
  const manifest=JSON.parse(await readFile('public/data/killian/detail-manifest.json','utf8')),o=manifest.porticoOpening;
  const at=(u,s)=>[o.center[0]+o.normal[2]*u+o.normal[0]*s,o.center[2]-o.normal[0]*u+o.normal[2]*s];
  async function walk(target){
   await page.locator('canvas').click();let held=[];
   try{for(let i=0;i<180;i++){
    const state=await page.evaluate(()=>window.__localCampus),dx=target[0]-state.position[0],dz=target[1]-state.position[2];
    const distance=Math.hypot(dx,dz);if(distance<.5)return;
    const [fx,,fz]=state.cameraForward,length=Math.hypot(fx,fz),forward=(dx*fx+dz*fz)/length,right=(-dx*fz+dz*fx)/length;
    const next=distance>4?['Shift']:[];
    if(Math.abs(forward)>distance*.3)next.push(forward>0?'w':'s');
    if(Math.abs(right)>distance*.3)next.push(right>0?'d':'a');
    for(const k of held)if(!next.includes(k))await page.keyboard.up(k);
    for(const k of next)if(!held.includes(k))await page.keyboard.down(k);
    held=next;await page.waitForTimeout(120);
   }throw new Error('Portico walking route did not reach '+JSON.stringify(target));}finally{for(const k of held)await page.keyboard.up(k);}
  }
  for(const p of [at(0,12),at(0,4),at(0,1),at(0,-1.65),at(4.1,-1.65),at(4.1,1)])await walk(p);
  let state=await page.evaluate(()=>window.__localCampus);
  assert.ok(Math.abs(state.position[1]-manifest.platformHeight)<.1,'landing still supports the character');
  await page.screenshot({path:`${root}/walk.png`});
  await walk(at(4.1,9));
  records.push({key:'keyboard-route',scene:await page.evaluate(()=>window.__localCampus)});
  if(!process.argv.includes('--no-video')){
   const video=await page.evaluate(()=>window.__stopPorticoRecording());
   await writeFile(`${root}/portico-walk.webm`,Buffer.from(video,'base64'));
  }
  console.log('Keyboard: lawn, five steps, landing, door approach, lateral passage and return passed');
 }
 assert.deepEqual(errors,[]);
 assert.ok(requests.every(url=>!/^https?:/.test(url)||url.startsWith('http://127.0.0.1:5173')));
 await writeFile(`${root}/report.json`,JSON.stringify({stage,records,performance,errors},null,2));
 await context.close();
 console.log(stage,performance);
}finally{await browser.close();}
