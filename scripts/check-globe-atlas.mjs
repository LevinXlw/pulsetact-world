import {mkdir,writeFile} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {createServer} from 'vite';
import {authenticateContext} from './test-auth.mjs';

const base=process.argv[2]??'http://127.0.0.1:5186';
const local=['localhost','127.0.0.1'].includes(new URL(base).hostname);
const directory=`output/globe-atlas/${local?'local':'production'}`;
await mkdir(directory,{recursive:true});
const vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',logLevel:'error'});
const {ATLAS_SCHOOLS}=await vite.ssrLoadModule('/src/features/world/campus-atlas-data.ts');
const {WORLD_DESTINATIONS}=await vite.ssrLoadModule('/src/features/world/world-destinations.ts');
const {WORLD_SPAWN}=await vite.ssrLoadModule('/src/features/world/world-locations.ts');
await vite.close();
const buArrival=WORLD_DESTINATIONS.find(point=>point.id==='bu-marsh').position;
const report={base,checks:[],errors:[],views:[],coordinates:[]};
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
const context=await browser.newContext({viewport:{width:1600,height:1000}});
await authenticateContext(context,base);
await context.addInitScript(()=>{
  if(localStorage.getItem('pulsetact.world.solo.v1'))return;
  localStorage.setItem('pulsetact.world.solo.v1',JSON.stringify({version:1,campus:'boston',position:[53.5,52.5],campusPositions:{umd:[0,14]},visited:['axis'],visitedPlaces:['bu-questrom'],campusVisits:['umd-library'],photoSpots:[],photos:2,quality:'low',trackedId:'axis',lesson:{stage:1,mirrorA:-45,mirrorB:0,prediction:null}}));
});
const page=await context.newPage();page.setDefaultTimeout(30000);
page.on('pageerror',error=>report.errors.push(error.message));
page.on('console',message=>{if(message.type()==='error'&&/WebGLProgram|VALIDATE_STATUS|shader error|GL_INVALID|Context Lost/i.test(message.text()))report.errors.push(message.text());});
const save=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('pulsetact.world.solo.v1')));
const scene=()=>page.evaluate(()=>window.__worldScene);
const check=name=>{report.checks.push(name);console.log(`PASS ${name}`);};
const schoolButton=short=>page.getByRole('button',{name:`查看 ${short} 的地理位置`,exact:true});
const globeStage=()=>page.getByTestId('campus-globe-stage');
const globeValue=async name=>Number(await globeStage().getAttribute(`data-${name}`));
async function globePreset(regional){
  await page.getByRole('button',{name:regional?'美国东北部':'全球',exact:true}).click();
  await expect.poll(()=>globeValue('zoom')).toBe(regional?19:1);
}
async function ready(campus){
  await expect(page.locator('.pw-loading')).toHaveCount(0,{timeout:180000});
  await expect(page.getByRole('button',{name:'拍照下载',exact:true})).toBeEnabled({timeout:180000});
  await expect(page.locator('.pw-scene-error')).toHaveCount(0);
  await expect.poll(async()=>(await save()).campus,{timeout:15000}).toBe(campus);
}
async function map(){
  await page.getByRole('navigation',{name:'世界菜单'}).getByRole('button',{name:'地图',exact:true}).click();
  await page.getByRole('button',{name:'地球总览',exact:true}).click();
  await expect(page.getByTestId('campus-globe-stage')).toHaveAttribute('data-ready','true',{timeout:60000});
  await expect(page.getByTestId('campus-globe')).toBeVisible();
}
async function travel(short,campus,position){
  await map();await schoolButton(short).click();
  await page.getByRole('button',{name:`进入 ${short} 校园`,exact:true}).click();
  await ready(campus);
  if(position)await expect.poll(async()=>{const point=(await save()).position;return point?Math.hypot(point[0]-position[0],point[1]-position[1]):Infinity;},{timeout:15000}).toBeLessThan(1);
}
async function capture(name){
  await page.waitForTimeout(700);await page.screenshot({path:`${directory}/${name}.png`});report.views.push(name);
}
async function noOverflow(){
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
  await expect(page.getByRole('button',{name:'关闭面板',exact:true})).toBeInViewport();
}
async function markerLabelsFit(){
  const bounds=await globeStage().boundingBox();
  for(const label of await globeStage().locator('.pw-globe-pin:not([hidden]) > span').all()){
    const box=await label.boundingBox();expect(box).not.toBeNull();
    expect(box.x).toBeGreaterThanOrEqual(bounds.x);expect(box.x+box.width).toBeLessThanOrEqual(bounds.x+bounds.width);
    expect(box.y).toBeGreaterThanOrEqual(bounds.y);expect(box.y+box.height).toBeLessThanOrEqual(bounds.y+bounds.height);
  }
}
try{
  await page.goto(base,{waitUntil:'domcontentloaded'});
  const enter=page.getByRole('button',{name:/开始校园漫游|继续校园漫游/});
  await expect(enter).toBeEnabled({timeout:180000});
  await page.getByLabel('旅途中，怎么称呼你？').fill('地球漫游检查');await enter.click();await ready('boston');
  await map();
  await expect(globeStage()).toHaveAttribute('data-view','global');
  await expect(page.getByRole('button',{name:'放大美国东北部的 5 所学校',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'查看 Boston 的 3 所学校',exact:true})).toBeHidden();
  await markerLabelsFit();await capture('00-global-initial');
  const canvasBox=await page.getByTestId('campus-globe').boundingBox();
  const dragX=canvasBox.x+canvasBox.width*.4,dragY=canvasBox.y+canvasBox.height*.6;
  const longitudeBeforeDrag=await globeValue('longitude');
  await page.mouse.move(dragX,dragY);await page.mouse.down();await page.mouse.move(dragX+70,dragY+15,{steps:10});await page.mouse.up();
  expect(Math.abs(await globeValue('longitude')-longitudeBeforeDrag)).toBeGreaterThan(1);
  const zoomBeforeWheel=await globeValue('zoom');await page.mouse.wheel(0,-120);
  await expect.poll(()=>globeValue('zoom')).toBeGreaterThan(zoomBeforeWheel);
  await globeStage().focus();const longitudeBeforeKey=await globeValue('longitude');await page.keyboard.press('ArrowRight');
  expect(await globeValue('longitude')).toBeGreaterThan(longitudeBeforeKey);
  const zoomBeforeKey=await globeValue('zoom');await page.keyboard.press('+');expect(await globeValue('zoom')).toBeGreaterThan(zoomBeforeKey);
  await page.keyboard.press('-');expect(await globeValue('zoom')).toBeCloseTo(zoomBeforeKey,1);
  await page.keyboard.press('Home');await expect.poll(()=>globeValue('zoom')).toBe(1);await expect.poll(()=>globeValue('longitude')).toBe(-96);
  await page.getByRole('button',{name:'放大地球',exact:true}).click();expect(await globeValue('zoom')).toBe(1.5);
  await page.getByRole('button',{name:'缩小地球',exact:true}).click();expect(await globeValue('zoom')).toBe(1);
  await page.getByRole('button',{name:'放大美国东北部的 5 所学校',exact:true}).click();await expect.poll(()=>globeValue('zoom')).toBe(19);
  for(const label of ['查看 Boston 的 3 所学校','在地球上选择 UMD','在地球上选择 UPenn'])await expect(page.getByRole('button',{name:label,exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'放大美国东北部的 5 所学校',exact:true})).toBeHidden();
  await markerLabelsFit();await capture('00b-northeast-presets');
  await page.getByRole('button',{name:'在地球上选择 UMD',exact:true}).click();await expect(schoolButton('UMD')).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'查看 Boston 的 3 所学校',exact:true}).click();await expect(schoolButton('MIT')).toHaveAttribute('aria-pressed','true');
  await globePreset(false);await globePreset(true);check('global and regional presets, visible markers, drag, wheel, keyboard and zoom controls work');
  for(const school of ATLAS_SCHOOLS){
    const button=schoolButton(school.short);await expect(button).toBeVisible();await button.click();
    expect(Number(await button.getAttribute('data-longitude'))).toBeCloseTo(school.location[0],5);
    expect(Number(await button.getAttribute('data-latitude'))).toBeCloseTo(school.location[1],5);
    report.coordinates.push({school:school.id,location:school.location});
    if(school.status==='open')await expect(page.getByRole('button',{name:`进入 ${school.short} 校园`,exact:true})).toBeEnabled();
    else await expect(page.getByRole('button',{name:'校园漫游尚未开放',exact:true})).toBeDisabled();
  }
  await schoolButton('BU').click();
  await expect(page.getByRole('button',{name:'查看 Massachusetts Institute of Technology 区域',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'查看 Harvard University 区域',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'查看 Massachusetts Institute of Technology 区域',exact:true}).click();
  await expect(page.getByRole('button',{name:'进入 MIT 校园',exact:true})).toBeEnabled();
  await capture('01-earth-and-boston');check('all schools expose source coordinates, separate Boston markers and honest Harvard status');
  const globePixels=await page.getByTestId('campus-globe').evaluate(canvas=>{
    const sample=document.createElement('canvas');sample.width=64;sample.height=48;const drawing=sample.getContext('2d');drawing.drawImage(canvas,0,0,64,48);
    const pixels=drawing.getImageData(0,0,64,48).data,colors=new Set();let nontransparent=0;
    for(let i=0;i<pixels.length;i+=4){if(pixels[i+3]>10)nontransparent++;colors.add(`${pixels[i]>>4},${pixels[i+1]>>4},${pixels[i+2]>>4}`);}
    return {colors:colors.size,nontransparent};
  });expect(globePixels.colors).toBeGreaterThan(8);expect(globePixels.nontransparent).toBeGreaterThan(100);
  if(local){const before=(await scene()).position;await page.keyboard.down('w');await page.waitForTimeout(600);await page.keyboard.up('w');const after=(await scene()).position;expect(Math.hypot(after[0]-before[0],after[2]-before[2])).toBeLessThan(.05);}
  await page.getByRole('button',{name:'关闭面板',exact:true}).click();
  check('globe draws visible geography and opening it pauses walking');
  await travel('BU','boston',buArrival);expect((await save()).trackedId).toBe('bu-marsh');
  await travel('MIT','boston',WORLD_SPAWN);check('MIT and BU enter distinct correct locations inside Boston');
  await travel('UMD','umd',[0,14]);
  await travel('BU','boston',buArrival);
  await travel('UMD','umd',[0,14]);
  await travel('UPenn','upenn');
  await travel('MIT','boston',WORLD_SPAWN);check('cross-campus globe travel keeps independent checkpoints and lands correctly');
  const beforeMovement=(await save()).position;
  await map();await page.getByRole('button',{name:'关闭面板',exact:true}).click();
  await page.keyboard.down('w');await page.waitForTimeout(1800);await page.keyboard.up('w');
  await expect.poll(async()=>{const point=(await save()).position;return Math.hypot(point[0]-beforeMovement[0],point[1]-beforeMovement[1]);},{timeout:15000}).toBeGreaterThan(1);
  check('closing the globe resumes rendering and keyboard movement');
  const retained=await save();expect(retained.visited).toEqual(['axis']);expect(retained.visitedPlaces).toEqual(['bu-questrom']);expect(retained.campusVisits).toEqual(['umd-library']);expect(retained.photos).toBe(2);expect(retained.lesson.stage).toBe(1);
  await page.reload({waitUntil:'domcontentloaded'});await ready('boston');expect((await save()).campusPositions.umd).toEqual([0,14]);check('legacy discoveries, lesson, photos and campus saves survive refresh');
  const unavailableGeography=route=>route.fulfill({status:503,contentType:'text/plain',body:'Temporary atlas test outage'});
  await context.route('**/assets/maps/world-land.json',unavailableGeography);
  await page.getByRole('navigation',{name:'世界菜单'}).getByRole('button',{name:'地图',exact:true}).click();await page.getByRole('button',{name:'地球总览',exact:true}).click();
  await expect(page.getByText('地球视图暂时无法加载',{exact:true})).toBeVisible();await schoolButton('BU').click();
  await expect(page.getByRole('button',{name:'进入 BU 校园',exact:true})).toBeEnabled();await expect(page.locator('.campus-region-inset')).toBeVisible();await capture('01b-geography-fallback');
  await context.unroute('**/assets/maps/world-land.json',unavailableGeography);await page.getByRole('button',{name:'重新加载地球',exact:true}).click();
  await expect(globeStage()).toHaveAttribute('data-ready','true',{timeout:60000});await expect(page.getByTestId('campus-globe')).toBeVisible();await page.getByRole('button',{name:'关闭面板',exact:true}).click();
  check('geography failure preserves school selection and retry restores the globe');
  await page.setViewportSize({width:390,height:844});await map();await schoolButton('Harvard').click();await expect.poll(()=>globeValue('zoom')).toBe(19);
  // Start on open ocean, clear of the school marker buttons which intentionally
  // treat touches as selection instead of a gesture on the globe surface.
  const touch=await context.newCDPSession(page),touchBounds=await globeStage().boundingBox(),touchX=touchBounds.x+touchBounds.width*.65,touchY=touchBounds.y+touchBounds.height*.85;
  async function pinch(from,to){
    const touches=distance=>[{x:touchX-distance,y:touchY,id:1,radiusX:4,radiusY:4},{x:touchX+distance,y:touchY,id:2,radiusX:4,radiusY:4}];
    for(const point of touches(from))expect(await page.evaluate(({x,y})=>!!document.elementFromPoint(x,y)?.closest('button'),point),'Touch begins on globe surface instead of a marker').toBe(false);
    await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:touches(from)});
    await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:touches(to)});
    await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  }
  await pinch(35,48);await expect.poll(()=>globeValue('zoom')).toBeGreaterThan(20);const expanded=await globeValue('zoom');
  await pinch(48,35);await expect.poll(()=>globeValue('zoom')).toBeLessThan(expanded);await touch.detach();await globePreset(true);check('mobile two-finger pinch zooms both directions');
  await markerLabelsFit();await noOverflow();await capture('02-mobile-harvard');
  await page.locator('.campus-region-inset').scrollIntoViewIfNeeded();await noOverflow();await capture('02b-mobile-harvard-region');
  await schoolButton('UMD').click();await noOverflow();await capture('03-mobile-maryland');
  await page.locator('.campus-region-inset').scrollIntoViewIfNeeded();await noOverflow();await capture('03b-mobile-maryland-region');
  await page.getByRole('button',{name:'进入 UMD 校园',exact:true}).click();await ready('umd');
  check('mobile globe selection and campus entry fit the viewport');
  expect(report.errors).toEqual([]);report.status='passed';
}catch(error){report.status='failed';report.error=String(error);process.exitCode=1;await page.screenshot({path:`${directory}/failure.png`}).catch(()=>{});}
finally{await writeFile(`${directory}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,checks:report.checks,errors:report.errors,error:report.error}));await browser.close();}
