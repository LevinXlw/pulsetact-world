import {mkdir,writeFile} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {createServer} from 'vite';
import {authenticateContext} from './test-auth.mjs';

const base=process.argv[2]??'http://127.0.0.1:5186';
const local=['localhost','127.0.0.1'].includes(new URL(base).hostname);
const directory=`output/arizona-campus/${local?'local':'production'}`;
const vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',logLevel:'error'});
const {REMOTE_LAYOUTS}=await vite.ssrLoadModule('/src/features/world/campus-regions.ts');
const places=REMOTE_LAYOUTS.arizona.points;
await vite.close();await mkdir(directory,{recursive:true});
const report={base,checks:[],errors:[],networkFailures:[],views:[]};
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
const context=await browser.newContext({viewport:{width:1600,height:1000}});
await authenticateContext(context,base);
await context.addInitScript(()=>{
  if(localStorage.getItem('pulsetact.world.solo.v1'))return;
  localStorage.setItem('pulsetact.world.solo.v1',JSON.stringify({version:1,campus:'upenn',campusPositions:{boston:[-632,1098],umd:[0,14]},visited:['axis'],visitedPlaces:['bu-questrom'],campusVisits:['umd-library','penn-college'],photos:3,quality:'standard',trackedId:'penn-college',lesson:{stage:1,mirrorA:-45,mirrorB:0,prediction:null}}));
});
const page=await context.newPage();page.setDefaultTimeout(45000);
page.on('pageerror',error=>report.errors.push(error.stack??error.message));
page.on('console',message=>{if(message.type()==='error'&&/WebGLProgram|VALIDATE_STATUS|shader error|GL_INVALID|Context Lost/i.test(message.text()))report.errors.push(message.text());});
page.on('response',response=>{if(response.status()>=400&&new URL(response.url()).pathname!=='/api/auth/session')report.networkFailures.push({url:response.url(),status:response.status()});});
page.on('requestfailed',request=>{const error=request.failure()?.errorText??'Unknown';if(!error.includes('ERR_ABORTED'))report.networkFailures.push({url:request.url(),error});});
const save=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('pulsetact.world.solo.v1')));
const check=name=>{report.checks.push(name);console.log(`PASS ${name}`);};
const map=()=>page.getByRole('navigation',{name:'世界菜单'}).getByRole('button',{name:'地图',exact:true}).click();
const close=()=>page.getByRole('button',{name:'关闭面板',exact:true}).click();
async function ready(campus='arizona'){
  await expect(page.locator('.pw-loading')).toHaveCount(0,{timeout:180000});
  await expect(page.getByRole('button',{name:'拍照下载',exact:true})).toBeEnabled({timeout:180000});
  await expect(page.locator('.pw-scene-error')).toHaveCount(0);
  await expect.poll(async()=>(await save()).campus,{timeout:15000}).toBe(campus);
}
async function capture(name){
  await page.waitForTimeout(650);await page.screenshot({path:`${directory}/${name}.png`});
  const sample=await page.locator('.pw-scene canvas').evaluate(source=>{
    const c=document.createElement('canvas');c.width=80;c.height=50;const ctx=c.getContext('2d');ctx.drawImage(source,0,0,80,50);
    const pixels=ctx.getImageData(0,0,80,50).data,colors=new Set();let min=255,max=0;
    for(let i=0;i<pixels.length;i+=4){colors.add(`${pixels[i]>>4},${pixels[i+1]>>4},${pixels[i+2]>>4}`);const light=(pixels[i]+pixels[i+1]+pixels[i+2])/3;min=Math.min(min,light);max=Math.max(max,light);}
    return{colors:colors.size,range:max-min,canvas:source.toDataURL('image/png')};
  });
  expect(sample.colors).toBeGreaterThan(15);expect(sample.range).toBeGreaterThan(35);
  await writeFile(`${directory}/${name}-scene.png`,Buffer.from(sample.canvas.split(',')[1],'base64'));
  report.views.push({name,colors:sample.colors,range:sample.range,scene:await page.evaluate(()=>window.__worldScene)});console.log(`Captured ${name}`);
}
async function travel(point){
  await map();await page.getByRole('button',{name:'校园漫游',exact:true}).click();
  await page.getByRole('button',{name:`快速前往${point.title}`,exact:true}).click();await ready();
  await expect(page.locator('.pw-interaction')).toContainText(point.title);
  await expect.poll(async()=>{const p=(await save()).position;return p?Math.hypot(p[0]-point.position[0],p[1]-point.position[1]):Infinity;},{timeout:15000}).toBeLessThan(1);
}
async function globe(){
  await map();await page.getByRole('button',{name:'地球总览',exact:true}).click();
  await expect(page.getByTestId('campus-globe-stage')).toHaveAttribute('data-ready','true',{timeout:60000});
}
async function enter(short,campus){await globe();await page.getByRole('button',{name:`查看 ${short} 的地理位置`,exact:true}).click();await page.getByRole('button',{name:`进入 ${short} 校园`,exact:true}).click();await ready(campus);}
try{
  await page.goto(base,{waitUntil:'domcontentloaded'});
  const begin=page.getByRole('button',{name:/开始校园漫游|继续校园漫游/});await expect(begin).toBeEnabled({timeout:180000});
  await page.getByLabel('旅途中，怎么称呼你？').fill('Arizona 漫游');await begin.click();await ready('upenn');
  await globe();await expect(page.locator('.pw-earth-heading')).toContainText('6 所学校');
  await expect(page.getByRole('button',{name:'在地球上选择 Arizona',exact:true})).toBeVisible();
  await page.screenshot({path:`${directory}/00-global.png`});
  await page.getByRole('button',{name:'查看 Arizona 的地理位置',exact:true}).click();
  await expect(page.getByTestId('campus-globe-stage')).toHaveAttribute('data-view','southwest');
  await expect.poll(async()=>Number(await page.getByTestId('campus-globe-stage').getAttribute('data-zoom'))).toBe(9);
  await expect(page.locator('.pw-earth-address')).toContainText('Tucson');
  await page.screenshot({path:`${directory}/01-southwest.png`});
  await page.getByRole('button',{name:'进入 Arizona 校园',exact:true}).click();await ready();
  await expect(page.locator('.pw-location')).toContainText('UNIVERSITY OF ARIZONA');check('six-school globe locates Tucson in the Southwest and enters Arizona');
  await map();await page.getByRole('button',{name:'校园漫游',exact:true}).click();
  await expect(page.locator('.pw-river-destinations article')).toHaveCount(places.length);
  await page.screenshot({path:`${directory}/02-campus-map.png`});
  await page.getByLabel('选择校园分区').selectOption({index:1});await expect(page.locator('.pw-campus-district-note')).toBeVisible();
  await page.getByRole('button',{name:'全校总览',exact:true}).click();
  const search=page.getByLabel('搜索校园地点');await search.fill('McClelland');
  await expect(page.getByRole('button',{name:/查看建筑.*McClelland/}).first()).toBeVisible();
  await page.getByRole('button',{name:/查看建筑.*McClelland/}).first().click();await expect(page.locator('.pw-campus-building-label')).toContainText('McClelland');
  await page.screenshot({path:`${directory}/03-building-search.png`});await close();check('campus districts and real building footprint search work');
  for(let i=0;i<places.length;i++){
    await travel(places[i]);await capture(`${String(i+10).padStart(2,'0')}-${places[i].id}`);
    await page.keyboard.press('e');await page.getByRole('button',{name:'记录这次到访',exact:true}).click();
  }
  await expect.poll(async()=>(await save()).campusVisits.filter(id=>id.startsWith('arizona-')).length,{timeout:15000}).toBe(places.length);
  check(`all ${places.length} Arizona arrivals render and record visits`);
  await travel(places[0]);const before=(await save()).position;
  await page.keyboard.down('s');await page.waitForTimeout(1800);await page.keyboard.up('s');
  // Wait for the next autosave after movement stops, so pagehide cannot flush a newer position than this checkpoint.
  await page.waitForTimeout(3300);
  await expect.poll(async()=>{const p=(await save()).position;return Math.hypot(p[0]-before[0],p[1]-before[1]);},{timeout:15000}).toBeGreaterThan(2);
  const moved=(await save()).position;await page.reload({waitUntil:'domcontentloaded'});await ready();
  expect(Math.hypot((await save()).position[0]-moved[0],(await save()).position[1]-moved[1])).toBeLessThan(.6);
  check('keyboard walking and refreshed Arizona checkpoint work');
  await enter('UPenn','upenn');await enter('Arizona','arizona');
  const saved=await save();expect(saved.visited).toEqual(['axis']);expect(saved.visitedPlaces).toEqual(['bu-questrom']);expect(saved.campusPositions.boston).toEqual([-632,1098]);expect(saved.campusPositions.umd).toEqual([0,14]);expect(saved.photos).toBe(3);expect(saved.lesson.stage).toBe(1);
  expect(saved.campusVisits).toContain('penn-college');expect(saved.campusVisits).toContain('umd-library');
  expect(saved.campusVisits.filter(id=>id.startsWith('arizona-'))).toHaveLength(places.length);
  expect(Math.hypot(saved.position[0]-moved[0],saved.position[1]-moved[1])).toBeLessThan(.6);
  check('cross-campus roundtrip keeps independent positions, discoveries and lesson progress');
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'标准',exact:true}).click();await close();
  await travel(places.find(p=>p.id==='arizona-enr2'));await capture('90-enr2-low');expect((await save()).quality).toBe('low');check('low quality retains Arizona architecture');
  await page.setViewportSize({width:390,height:844});await globe();await page.getByRole('button',{name:'查看 Arizona 的地理位置',exact:true}).click();
  await expect.poll(async()=>Number(await page.getByTestId('campus-globe-stage').getAttribute('data-zoom'))).toBe(9);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)).toBe(true);
  await expect(page.getByRole('button',{name:'关闭面板',exact:true})).toBeInViewport();await page.screenshot({path:`${directory}/91-mobile-globe.png`});
  await close();await travel(places[0]);await capture('92-mobile-old-main');check('mobile Southwest globe and campus travel fit the viewport');
  expect(report.errors).toEqual([]);expect(report.networkFailures).toEqual([]);report.status='passed';
}catch(error){report.status='failed';report.error=String(error);console.error(error);process.exitCode=1;await page.screenshot({path:`${directory}/failure.png`}).catch(()=>{});}
finally{await writeFile(`${directory}/browser-report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,checks:report.checks,errors:report.errors,networkFailures:report.networkFailures,error:report.error}));await browser.close();}
