import {mkdir,writeFile} from 'node:fs/promises';
import {setDefaultResultOrder} from 'node:dns';
import {chromium,expect} from '@playwright/test';
import {authenticateContext} from './test-auth.mjs';
import {createServer} from 'vite';

setDefaultResultOrder('ipv4first');
const base=process.argv[2]??'http://127.0.0.1:5186';
const production=new URL(base).hostname==='world.pulsetact.ai';
const directory=`output/maryland-full-campus/${production?'production':'local'}`;
const vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',logLevel:'error'});
const {REMOTE_LAYOUTS}=await vite.ssrLoadModule('/src/features/world/campus-regions.ts');
const places=REMOTE_LAYOUTS.umd.points,total=places.length;
await vite.close();
await mkdir(directory,{recursive:true});
const report={checks:[],errors:[],views:[],networkFailures:[]};
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
const context=await browser.newContext({viewport:{width:1600,height:1000},ignoreHTTPSErrors:['127.0.0.1','localhost'].includes(new URL(base).hostname)});
await authenticateContext(context,base);
await context.addInitScript(()=>{
  if(localStorage.getItem('pulsetact.world.solo.v1'))return;
  // Restore an old Maryland save, including unrelated original progress.
  localStorage.setItem('pulsetact.world.solo.v1',JSON.stringify({version:1,campus:'umd',position:[-108,14],campusPositions:{boston:[-632,1098]},campusVisits:['umd-library','umd-mall','umd-administration'],visited:['axis'],visitedPlaces:['bu-questrom'],photos:3,quality:'standard',trackedId:'umd-library'}));
});
const page=await context.newPage();page.setDefaultTimeout(30000);
page.on('pageerror',error=>{report.errors.push(error.message);console.error(`PAGE ERROR ${error.message}`);});
page.on('console',message=>{if(message.type()==='error'&&/WebGLProgram|VALIDATE_STATUS|shader error|GL_INVALID|Context Lost/i.test(message.text()))report.errors.push(message.text());});
page.on('response',response=>{if(response.status()>=400&&new URL(response.url()).pathname!=='/api/auth/session')report.networkFailures.push({url:response.url(),status:response.status()});});
page.on('requestfailed',request=>{const error=request.failure()?.errorText??'Unknown failure';if(!error.includes('ERR_ABORTED'))report.networkFailures.push({url:request.url(),error});});
const save=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('pulsetact.world.solo.v1')));
const check=name=>{report.checks.push(name);console.log(`PASS ${name}`);};
const map=()=>page.getByRole('navigation',{name:'世界菜单'}).getByRole('button',{name:'地图',exact:true}).click();
const close=()=>page.getByRole('button',{name:'关闭面板',exact:true}).click();
async function ready(){
  await expect(page.locator('.pw-loading')).toHaveCount(0,{timeout:120000});
  await expect(page.getByRole('button',{name:'拍照下载',exact:true})).toBeEnabled({timeout:120000});
  await expect(page.locator('.pw-location')).toContainText('UNIVERSITY OF MARYLAND');
  await expect(page.locator('.pw-scene-error')).toHaveCount(0);
}
async function capture(name){
  await page.waitForTimeout(700);await page.screenshot({path:`${directory}/${name}.png`});
  const {canvas,colors,range}=await page.locator('.pw-scene canvas').evaluate(source=>{
    const sample=document.createElement('canvas');sample.width=64;sample.height=48;
    const drawing=sample.getContext('2d');drawing.drawImage(source,0,0,64,48);
    const pixels=drawing.getImageData(0,0,64,48).data,colors=new Set();let darkest=255,lightest=0;
    for(let i=0;i<pixels.length;i+=4){colors.add(`${pixels[i]>>4},${pixels[i+1]>>4},${pixels[i+2]>>4}`);const light=(pixels[i]+pixels[i+1]+pixels[i+2])/3;darkest=Math.min(darkest,light);lightest=Math.max(lightest,light);}
    return {canvas:source.toDataURL('image/png'),colors:colors.size,range:lightest-darkest};
  });
  expect(colors,'scene contains varied rendered colors').toBeGreaterThan(12);expect(range,'scene has visible lighting and geometry').toBeGreaterThan(30);
  await writeFile(`${directory}/${name}-scene.png`,Buffer.from(canvas.split(',')[1],'base64'));
  const scene=await page.evaluate(()=>window.__worldScene);
  report.views.push({name,scene,colors,range});console.log(`Captured ${name}`);
}
async function travel(title){await map();await page.getByRole('button',{name:`快速前往${title}`,exact:true}).click();await expect(page.locator('.pw-interaction')).toContainText(title);await page.waitForTimeout(450);}
try {
  console.log(`Opening Maryland at ${base}`);
  await page.goto(base,{waitUntil:'domcontentloaded'});
  console.log('Page loaded; waiting for campus and character');
  const enter=page.getByRole('button',{name:/开始校园漫游|继续校园漫游/});await expect(enter).toBeEnabled({timeout:120000});await page.getByLabel('旅途中，怎么称呼你？').fill('Maryland 漫游');await enter.click();await ready();
  await expect(page.locator('.solo-progress')).toContainText(`3 / ${total}`);
  expect((await save()).campusVisits).toHaveLength(3);expect((await save()).visited).toEqual(['axis']);
  await capture('01-mckeldin-refined');check(`old three-place Maryland save opens with ${total} destinations`);
  await map();await expect(page.locator('.pw-river-destinations article')).toHaveCount(total);
  const titles=await page.locator('.pw-river-destinations h4').allTextContents();
  await page.screenshot({path:`${directory}/02-expanded-map.png`,animations:'disabled'});
  const district=page.getByLabel('选择校园分区');
  const options=await district.locator('option').allTextContents();expect(options.length).toBeGreaterThan(5);
  await district.selectOption({index:1});
  await expect(page.locator('.pw-river-destinations article').first()).toBeVisible();
  await page.screenshot({path:`${directory}/02-district-map.png`,animations:'disabled'});
  await page.getByRole('button',{name:'全校总览',exact:true}).click();
  const search=page.getByLabel('搜索校园地点');await search.fill('Iribe');
  await expect(page.getByRole('button',{name:/查看建筑.*Iribe/i})).toBeVisible();
  await page.getByRole('button',{name:/查看建筑.*Iribe/i}).click();
  await page.screenshot({path:`${directory}/02-building-search.png`,animations:'disabled'});
  await page.getByRole('button',{name:'全校总览',exact:true}).click();
  await search.fill('no-building-with-this-name');await expect(page.getByText(/没有找到/).first()).toBeVisible();
  await search.fill('');await close();check('campus districts, building search and overview controls work');
  for(let i=1;i<titles.length;i++){
    await travel(titles[i]);await capture(`${String(i+2).padStart(2,'0')}-${places[i].id}`);
    if(i>=3){await page.keyboard.press('e');await page.getByRole('button',{name:'记录这次到访',exact:true}).click();}
    await expect.poll(async()=>{const point=(await save()).position;return Math.hypot(point[0]-places[i].position[0],point[1]-places[i].position[1]);},{timeout:15000}).toBeLessThan(1);
  }
  await expect.poll(async()=>(await save()).campusVisits.length,{timeout:15000}).toBe(total);
  await expect(page.locator('.solo-progress')).toContainText(`${total} / ${total}`);check(`all ${total} arrivals render at correct positions and visits can be recorded`);
  const before=(await save()).position;await page.keyboard.down('s');await page.waitForTimeout(1700);await page.keyboard.up('s');await page.waitForTimeout(3300);
  const after=(await save()).position;expect(Math.hypot(after[0]-before[0],after[1]-before[1])).toBeGreaterThan(2);
  check('actual keyboard movement works at expanded campus arrival');
  await page.reload({waitUntil:'domcontentloaded'});await ready();
  expect((await save()).campusVisits).toHaveLength(total);expect((await save()).visitedPlaces).toEqual(['bu-questrom']);expect((await save()).campusPositions.boston).toEqual([-632,1098]);
  expect(Math.hypot((await save()).position[0]-after[0],(await save()).position[1]-after[1])).toBeLessThan(.6);
  check('expanded visits and position persist without changing Boston progress');
  // A checkpoint saved beside the former undersized Clark building now falls
  // inside its corrected north wing. Restore it to the safe nearby arrival.
  await page.evaluate(()=>{const key='pulsetact.world.solo.v1',saved=JSON.parse(localStorage.getItem(key));saved.position=[476,-832];saved.campusPositions.umd=[476,-832];localStorage.setItem(key,JSON.stringify(saved));});
  await page.reload({waitUntil:'domcontentloaded'});await ready();
  const clark=places.find(p=>p.id==='umd-clark');
  await expect.poll(async()=>{const p=(await save()).position;return Math.hypot(p[0]-clark.position[0],p[1]-clark.position[1]);},{timeout:15000}).toBeLessThan(1);
  expect((await save()).campusVisits).toHaveLength(total);expect((await save()).visitedPlaces).toEqual(['bu-questrom']);
  check('a checkpoint inside the corrected engineering footprint recovers without losing discoveries');
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'标准',exact:true}).click();await close();
  await travel(titles.at(-1));await capture('90-full-campus-low');expect((await save()).quality).toBe('low');check('expanded architecture renders in low quality');
  await page.setViewportSize({width:390,height:844});await map();await page.screenshot({path:`${directory}/91-mobile-map.png`,animations:'disabled'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)).toBe(true);await expect(page.getByRole('button',{name:'关闭面板',exact:true})).toBeInViewport();
  await page.getByRole('button',{name:`快速前往${titles.at(-1)}`,exact:true}).click();await expect(page.locator('.pw-interaction')).toContainText(titles.at(-1));await capture('92-mobile-campus');
  check('mobile map fits viewport and expanded destination travel works');
  expect(report.errors).toEqual([]);expect(report.networkFailures).toEqual([]);report.status='passed';
}catch(error){report.status='failed';report.error=String(error);console.error(error);await page.screenshot({path:`${directory}/failure.png`}).catch(()=>{});process.exitCode=1;}
finally{await writeFile(`${directory}/browser-report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,checks:report.checks,errors:report.errors,networkFailures:report.networkFailures,error:report.error}));await browser.close();}
