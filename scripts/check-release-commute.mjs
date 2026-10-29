// Release-only commute smoke: ordinary UI/input and read-only saved progress.
// Usage: WORLD_BASE_URL=https://world.pulsetact.ai node scripts/check-release-commute.mjs
// Also accepts a positional URL, --desktop / --mobile, --out-dir DIRECTORY,
// --expected-version VERSION, WORLD_VERIFY_PROXY, WORLD_EXPECTED_VERSION,
// and WORLD_COMMUTE_REVIEW_DIR. HTTP is allowed only on the local loopback host.
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {setDefaultResultOrder} from 'node:dns';
import {chromium,expect} from '@playwright/test';
import {FIXED_ACCOUNT} from '../server/auth-credentials.mjs';

setDefaultResultOrder('ipv4first');
const args=process.argv.slice(2);
function option(name){
  const index=args.indexOf(name);
  if(index<0)return undefined;
  if(!args[index+1]||args[index+1].startsWith('--'))throw Error(`Missing value for ${name}`);
  return args[index+1];
}
const base=new URL(process.env.WORLD_BASE_URL||option('--base-url')||args.find(value=>/^https?:\/\//.test(value))||'http://127.0.0.1:4173');
const local=['localhost','127.0.0.1','[::1]'].includes(base.hostname);
if(base.username||base.password)throw Error('Do not embed credentials in the target URL.');
if(base.protocol!=='https:'&&!(local&&base.protocol==='http:'))throw Error('Remote release verification requires HTTPS with certificate verification.');
if(args.includes('--desktop')&&args.includes('--mobile'))throw Error('Select one profile flag, or omit both to check both profiles.');
const modes=args.includes('--desktop')?['desktop']:args.includes('--mobile')?['mobile']:['desktop','mobile'];
const directory=resolve(option('--out-dir')||process.env.WORLD_COMMUTE_REVIEW_DIR||`output/deployment/commute-release-${new Date().toISOString().replace(/[:.]/g,'-')}`);
const expectedVersion=option('--expected-version')||process.env.WORLD_EXPECTED_VERSION;
const url=path=>new URL(path,base.origin).href;
const saveKey='pulsetact.world.solo.v1';
const holdMs=1400,saveWaitMs=3300;
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const redact=value=>{
  let text=String(value);
  // Playwright may include action arguments in an exception. Never publish
  // credentials, auth response bodies, request headers, or cookie values.
  for(const secret of Object.values(FIXED_ACCOUNT))if(typeof secret==='string'&&secret)text=text.split(secret).join('[redacted]');
  return text.replace(/(pulsetact_session\s*[=:]\s*)[^\s;,"']+/gi,'$1[redacted]');
};
const report={
  status:'running',base:base.origin,startedAt:new Date().toISOString(),profiles:[],
  scope:'Built app commute UI, saved movement, boost, stow, map travel and reload; MIT Killian Court only.',
  evidence:'Actual game screenshots. Pixel checks detect a blank scene; vehicle shape, materials and rider pose still require visual review. Phone emulation is not a physical-device test.',
};
await mkdir(directory,{recursive:true});
let browser;

async function runProfile(mode){
  const mobile=mode==='mobile';
  const entry={mode,status:'running',checks:[],movement:[],views:[],errors:[],resourceErrors:[]};
  report.profiles.push(entry);
  const context=await browser.newContext({
    ...(mobile?{viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true}:{viewport:{width:1440,height:900},deviceScaleFactor:1}),
    ...(process.env.WORLD_VERIFY_PROXY?{proxy:{server:process.env.WORLD_VERIFY_PROXY}}:{}),
  });
  const page=await context.newPage();
  page.setDefaultTimeout(30000);
  const cdp=mobile?await context.newCDPSession(page):undefined;
  const activate=locator=>mobile?locator.tap():locator.click();
  const menu=name=>page.getByRole('navigation',{name:'世界菜单',exact:true}).getByRole('button',{name,exact:true});
  const world=page.getByTestId('world-page');
  const saved=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)||'null'),saveKey);
  const passed=name=>{entry.checks.push(name);console.log(`PASS ${mode}: ${name}`);};
  const assetPath=value=>{try{const parsed=new URL(value);return parsed.origin===base.origin&&/^\/(assets|data)\//.test(parsed.pathname)?parsed.pathname:null;}catch{return null;}};
  page.on('pageerror',error=>entry.errors.push(redact(error.message)));
  page.on('crash',()=>entry.errors.push('Browser page crashed'));
  page.on('console',message=>{
    if(['error','warning'].includes(message.type())&&/WebGLProgram|VALIDATE_STATUS|shader error|GL_INVALID|context (?:lost|loss)|WebGL context/i.test(message.text()))entry.errors.push(redact(message.text()));
  });
  page.on('response',response=>{const path=assetPath(response.url());if(path&&response.status()>=400)entry.resourceErrors.push({path,status:response.status()});});
  page.on('requestfailed',request=>{
    const path=assetPath(request.url()),error=request.failure()?.errorText||'Unknown failure';
    if(path&&!/ERR_ABORTED|cancelled|canceled/i.test(error))entry.resourceErrors.push({path,error:redact(error)});
  });

  async function ready(){
    await expect(page.getByRole('navigation',{name:'世界菜单',exact:true})).toBeVisible({timeout:180000});
    await expect(page.getByRole('button',{name:'拍照下载',exact:true})).toBeEnabled({timeout:180000});
    await expect(page.locator('.pw-loading')).toHaveCount(0,{timeout:180000});
    await expect(page.locator('.pw-scene-error')).toHaveCount(0);
    await expect(page.locator('.pw-scene canvas')).toHaveCount(1);
    await expect.poll(async()=>(await saved())?.campus,{timeout:15000}).toBe('boston');
  }
  async function position(){
    const progress=await saved(),point=progress?.position;
    expect(Array.isArray(point)&&point.length===2&&point.every(Number.isFinite),'Finite automatically saved position').toBe(true);
    expect(progress.campus).toBe('boston');
    return [...point];
  }
  async function noOverflow(){
    const size=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));
    expect(size.scrollWidth,'No horizontal viewport overflow').toBeLessThanOrEqual(size.width+2);
    const dialog=page.getByRole('dialog');
    if(await dialog.isVisible())expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+2),'No horizontal panel overflow').toBe(true);
  }
  async function assertWalk(){
    await expect(world).toHaveAttribute('data-commute-mode','walk');
    await expect(page.locator('.solo-ride-controls')).toHaveCount(0);
  }
  let anchor;
  async function returnToKillian(){
    await activate(menu('地图'));
    await activate(page.getByRole('button',{name:'地球总览',exact:true}));
    await activate(page.getByRole('button',{name:'查看 MIT 的地理位置',exact:true}));
    await activate(page.getByRole('button',{name:'进入 MIT 校园',exact:true}));
    await ready();await assertWalk();
    await expect(page.locator('.pw-location')).toContainText('MIT');
    await expect.poll(async()=>(await saved())?.trackedId,{timeout:15000}).toBe('axis');
    // The app writes its normal checkpoint every three seconds. Do not seed
    // storage or read an intermediate save while the scene restores arrival.
    await page.waitForTimeout(saveWaitMs);
    const current=await position();
    if(anchor)expect(distance(current,anchor),'Repeatable ordinary map arrival').toBeLessThan(.4);
    else anchor=current;
    await noOverflow();
  }
  async function summon(vehicle){
    await activate(menu('通勤'));
    const dialog=page.getByRole('dialog',{name:'选择你的通勤方式',exact:true});
    await expect(dialog).toBeVisible();await noOverflow();
    for(const name of ['收起工具，步行','召唤摩托车','召唤魔法扫帚'])await expect(dialog.getByRole('button',{name,exact:true})).toBeVisible();
    if(!entry.menuScreenshot){
      entry.menuScreenshot=`${mode}-commute-menu.png`;
      await page.screenshot({path:resolve(directory,entry.menuScreenshot)});
    }
    await activate(dialog.getByRole('button',{name:vehicle==='motorcycle'?'召唤摩托车':'召唤魔法扫帚',exact:true}));
    await expect(dialog).toHaveCount(0);
    await expect(world).toHaveAttribute('data-commute-mode',vehicle);
    await expect(page.getByRole('button',{name:'收起通勤工具',exact:true})).toBeVisible();
    await expect(page.locator('.solo-ride-status')).toContainText(vehicle==='motorcycle'?'城市摩托':'魔法扫帚');
    if(mobile)await expect(page.getByRole('button',{name:'加速通勤',exact:true})).toBeVisible();
    await page.waitForTimeout(400);
    // A narrow-space rejection may arrive after the UI first selects a mode.
    await expect(world).toHaveAttribute('data-commute-mode',vehicle);await noOverflow();
  }
  async function controlBoxes(){
    const boxes={};
    for(const selector of ['.pw-interaction','.solo-ride-controls','.pw-mobile-pad','.pw-bottom']){
      const locator=page.locator(selector);
      if(await locator.isVisible())boxes[selector]=await locator.boundingBox();
    }
    if(mobile){
      const entries=Object.entries(boxes);
      for(let i=0;i<entries.length;i++)for(let j=i+1;j<entries.length;j++){
        const [a,aa]=entries[i],[b,bb]=entries[j];
        const w=Math.min(aa.x+aa.width,bb.x+bb.width)-Math.max(aa.x,bb.x);
        const h=Math.min(aa.y+aa.height,bb.y+bb.height)-Math.max(aa.y,bb.y);
        expect(w>1&&h>1,`${a} does not overlap ${b}`).toBe(false);
      }
    }
    return boxes;
  }
  async function capture(name){
    await page.waitForTimeout(650);await noOverflow();
    const pixels=await page.locator('.pw-scene canvas').evaluate(async source=>{
      await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));
      const canvas=document.createElement('canvas');canvas.width=64;canvas.height=48;
      const ctx=canvas.getContext('2d');ctx.drawImage(source,0,0,64,48);
      const bytes=ctx.getImageData(0,0,64,48).data,colors=new Set();let visible=0,opaque=0,lo=255,hi=0;
      for(let i=0;i<bytes.length;i+=4){
        if(bytes[i+3]>16)visible++;if(bytes[i+3]>240)opaque++;
        colors.add(`${bytes[i]>>4},${bytes[i+1]>>4},${bytes[i+2]>>4}`);
        const light=(bytes[i]+bytes[i+1]+bytes[i+2])/3;lo=Math.min(lo,light);hi=Math.max(hi,light);
      }
      return{width:source.width,height:source.height,visibleCoverageRatio:visible/(64*48),opaqueRatio:opaque/(64*48),colors:colors.size,range:hi-lo};
    });
    expect(pixels.width).toBeGreaterThan(100);expect(pixels.height).toBeGreaterThan(100);
    expect(pixels.visibleCoverageRatio,'Scene is not blank/transparent').toBeGreaterThan(.9);
    expect(pixels.colors).toBeGreaterThan(12);expect(pixels.range).toBeGreaterThan(30);
    // Opaque coverage is diagnostic only: realistic glass may be translucent.
    const screenshot=`${mode}-${name}.png`;
    await page.screenshot({path:resolve(directory,screenshot)});
    entry.views.push({name,screenshot,pixels,position:await position(),controls:await controlBoxes()});
  }
  async function orbitByDrag(radians){
    const box=await page.locator('.pw-scene canvas').boundingBox();expect(box).not.toBeNull();
    // The normal canvas sensitivity is .004 radians per CSS pixel. Split
    // drags to stay on screen on a phone; never assign a camera or scene state.
    let remaining=radians/.004;
    while(Math.abs(remaining)>.01){
      const delta=Math.sign(remaining)*Math.min(Math.abs(remaining),box.width*.55);
      const from={x:box.x+box.width*(delta>0?.2:.8),y:box.y+box.height*.51};
      if(mobile){
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...from,id:1}]});
        try{for(let i=1;i<=12;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:from.x+delta*i/12,y:from.y,id:1}]});}
        finally{await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
      }else{
        await page.mouse.move(from.x,from.y);await page.mouse.down();
        try{await page.mouse.move(from.x+delta,from.y,{steps:12});}finally{await page.mouse.up();}
      }
      remaining-=delta;
    }
  }
  async function frontAndSide(vehicle){
    await orbitByDrag(Math.PI);await capture(`${vehicle}-front`);
    await orbitByDrag(-Math.PI/2);await capture(`${vehicle}-side`);
    await orbitByDrag(-Math.PI/2);await page.waitForTimeout(300);
  }
  async function move(mode,boosted=false){
    const before=await position();
    let touched=false,keyDown=false,shiftDown=false;
    const started=Date.now();
    try{
      if(mobile){
        const direction=await page.getByRole('navigation',{name:'移动方向',exact:true}).getByRole('button',{name:'向前',exact:true}).boundingBox();
        expect(direction).not.toBeNull();
        const touches=[{x:direction.x+direction.width/2,y:direction.y+direction.height/2,id:1}];
        if(boosted){
          const boost=await page.getByRole('button',{name:'加速通勤',exact:true}).boundingBox();expect(boost).not.toBeNull();
          touches.push({x:boost.x+boost.width/2,y:boost.y+boost.height/2,id:2});
        }
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:touches});touched=true;
        if(boosted)await expect(page.getByRole('button',{name:'加速通勤',exact:true})).toHaveAttribute('aria-pressed','true');
      }else{
        if(boosted){await page.keyboard.down('Shift');shiftDown=true;}
        await page.keyboard.down('w');keyDown=true;
      }
      await page.waitForTimeout(holdMs);
    }finally{
      if(touched)await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      if(keyDown)await page.keyboard.up('w');if(shiftDown)await page.keyboard.up('Shift');
    }
    const inputDurationMs=Date.now()-started;
    if(mobile&&boosted)await expect(page.getByRole('button',{name:'加速通勤',exact:true})).toHaveAttribute('aria-pressed','false');
    await page.waitForTimeout(saveWaitMs);
    const after=await position(),metres=distance(before,after);
    expect(metres,`${mode}${boosted?' boosted':''} actually moved and saved progress`).toBeGreaterThan(.65);
    await expect(world).toHaveAttribute('data-commute-mode',mode);
    const result={mode,boosted,before,after,distanceMetres:metres,inputDurationMs,saveWaitMs,input:mobile?(boosted?'simultaneous direction and boost touch contacts':'direction touch contact'):(boosted?'W + Shift':'W')};
    entry.movement.push(result);await capture(`${mode}${boosted?'-boost':'-cruise'}-moved`);
    return result;
  }

  try{
    const health=await context.request.get(url('/api/health'));
    if(health.ok()&&health.headers()['content-type']?.includes('application/json')){
      const body=await health.json();entry.version=body.version??null;
      if(!local)expect(body.ok).toBe(true);
    }else if(!local||expectedVersion)throw Error(`Release health unavailable (${health.status()}).`);
    await health.dispose();
    if(expectedVersion)expect(entry.version,'Expected deployed release version').toBe(expectedVersion);
    if(!local)expect(entry.version,'Remote server identifies a release').toBeTruthy();
    const document=await page.goto(base.href,{waitUntil:'domcontentloaded'});
    expect(document?.status(),'Application document loads').toBe(200);
    const html=await document.text();
    expect(html,'Built application, not the Vite development server').not.toContain('/@vite/client');
    expect(html,'Built application entry chunk').toMatch(/src=["'][^"']*\/assets\/[^"']+\.js/);
    await expect(page.getByRole('button',{name:'登录',exact:true})).toBeVisible();
    // Keep credentials only in Node and the normal password form; no browser
    // init script, storage seed, auth response dump, or network trace is used.
    try{
      await page.getByLabel('账号',{exact:true}).fill(FIXED_ACCOUNT.username);
      await page.getByLabel('密码',{exact:true}).fill(FIXED_ACCOUNT.password);
      await activate(page.getByRole('button',{name:'登录',exact:true}));
      await expect(page.getByLabel('旅途中，怎么称呼你？',{exact:true})).toBeVisible({timeout:30000});
    }catch{throw Error('Normal login form did not reach nickname entry. Credential details withheld.');}
    await page.getByLabel('旅途中，怎么称呼你？',{exact:true}).fill(mobile?'通勤手机验收':'通勤发布验收');
    await activate(page.getByRole('button',{name:/开始校园漫游|继续校园漫游/}));
    await ready();await assertWalk();await returnToKillian();
    passed('Built application, normal login/nickname and MIT map arrival');
    const walking=await move('walk');
    for(const vehicle of ['motorcycle','broom']){
      await returnToKillian();await summon(vehicle);await frontAndSide(vehicle);
      const cruise=await move(vehicle);
      cruise.walkDistanceRatio=cruise.distanceMetres/walking.distanceMetres;
      expect(cruise.walkDistanceRatio,`${vehicle} advances farther than walking on the same route`).toBeGreaterThan(1.3);
      await activate(page.getByRole('button',{name:'收起通勤工具',exact:true}));await assertWalk();
      passed(`${vehicle}: visible menu, front/side game views, cruise and direct stow`);
      await returnToKillian();await summon(vehicle);
      const boost=await move(vehicle,true);
      boost.cruiseDistanceRatio=boost.distanceMetres/cruise.distanceMetres;
      expect(boost.cruiseDistanceRatio,`${vehicle} boost increases saved displacement on the same route`).toBeGreaterThan(1.08);
      await returnToKillian();await assertWalk();
      passed(`${vehicle}: held boost increases movement; normal map travel stows vehicle`);
    }
    await summon('broom');const checkpoint=await position();
    await page.reload({waitUntil:'domcontentloaded'});
    const enter=page.getByRole('button',{name:/开始校园漫游|继续校园漫游/});
    if(mobile){await expect(enter).toBeVisible();await activate(enter);}
    await ready();await assertWalk();await page.waitForTimeout(saveWaitMs);
    expect(distance(await position(),checkpoint),'Reload retains normally saved checkpoint').toBeLessThan(.6);
    await capture('reload-stowed');passed('Reload retains saved position and restores walking');
    expect(entry.errors,'No page, WebGL or crash errors').toEqual([]);
    expect(entry.resourceErrors,'No failed application assets').toEqual([]);
    passed('No horizontal overflow, page errors, GL errors or failed assets');entry.status='passed';
  }catch(error){
    entry.status='failed';entry.failure=redact(error?.message??error);
    await page.screenshot({path:resolve(directory,`${mode}-failure.png`),mask:[page.locator('#auth-username'),page.locator('#auth-password')]}).catch(()=>{});
    throw Error(`${mode}: ${entry.failure}`);
  }finally{
    await cdp?.detach().catch(()=>{});
    // Revoke only this isolated test session, never an existing browser login.
    await context.request.post(url('/api/auth/logout')).then(response=>response.dispose()).catch(()=>{});
    await context.close();
  }
}

try{
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
  for(const mode of modes)await runProfile(mode);
  const versions=report.profiles.map(profile=>profile.version).filter(Boolean);
  expect(new Set(versions).size,'Profiles observe the same deployment version').toBeLessThanOrEqual(1);
  report.status='passed';
}catch(error){report.status='failed';report.failure=redact(error?.message??error);process.exitCode=1;}
finally{
  report.finishedAt=new Date().toISOString();
  await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({status:report.status,profiles:report.profiles.map(({mode,status,version})=>({mode,status,version})),failure:report.failure,report:resolve(directory,'report.json')}));
  await browser?.close();
}
