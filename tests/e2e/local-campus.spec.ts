import {test,expect,type Page} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
type LocalState={mode:string;quality:string;fov:number;cameraPosition:number[];cameraGroundHeight:number;position:number[];cameraForward:number[];calls:number;triangles:number};
const screenshotRoot='docs/screenshots/cambridge-first-pass';
const campusState=(page:Page)=>page.evaluate(()=>(window as unknown as {__localCampus:LocalState}).__localCampus);
const distance=(a:number[],b:number[])=>Math.hypot(a[0]-b[0],a[2]-b[2]);
async function snap(page:Page,name:string){await mkdir(screenshotRoot,{recursive:true});await page.screenshot({path:`${screenshotRoot}/${name}.png`});const state=await campusState(page);if(state)await writeFile(`${screenshotRoot}/${name}.json`,JSON.stringify(state,null,2));}
async function ready(page:Page){await expect(page.getByRole('button',{name:'拍照',exact:true})).toBeEnabled({timeout:60000});}
test('environment stroll has fixed eye height, drag look and paused input',async({page})=>{
 await page.goto('/real/mit');await ready(page);
 const state=()=>campusState(page);
 await expect.poll(async()=>(await state())?.mode).toBe('stroll');
 const entry=await state();expect(entry.cameraPosition[1]-entry.cameraGroundHeight).toBeCloseTo(1.65,2);expect(entry.fov).toBe(48);await snap(page,'01-mit-stroll');
 const canvas=await page.locator('canvas').boundingBox();if(!canvas)throw new Error('Missing campus canvas');
 await page.mouse.move(canvas.x+canvas.width*.6,canvas.y+canvas.height*.6);await page.mouse.down();await page.mouse.move(canvas.x+canvas.width*.6+60,canvas.y+canvas.height*.6,{steps:6});await page.mouse.up();
 await expect.poll(async()=>Math.abs((await state()).cameraForward[0]-entry.cameraForward[0])).toBeGreaterThan(.05);
 await page.keyboard.down('w');await expect.poll(async()=>Math.hypot((await state()).position[0]-entry.position[0],(await state()).position[2]-entry.position[2])).toBeGreaterThan(.3);await page.keyboard.up('w');
 expect((await state()).fov).toBe(48);
 await page.getByRole('button',{name:'设置',exact:true}).click();await page.waitForTimeout(400);const paused=await state();
 await page.keyboard.down('w');await page.waitForTimeout(500);await page.keyboard.up('w');expect((await state()).position).toEqual(paused.position);
 await page.getByRole('button',{name:'回到入口',exact:true}).click();await expect.poll(async()=>Math.hypot((await state()).position[0]-entry.position[0],(await state()).position[2]-entry.position[2])).toBeLessThan(.01);
 await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'画质：标准',exact:true}).click();await expect.poll(async()=>(await state()).quality).toBe('low');await page.keyboard.press('Escape');
 await page.evaluate(()=>new Promise<void>(resolve=>{let frames=0;const tick=()=>++frames===16?resolve():requestAnimationFrame(tick);requestAnimationFrame(tick);}));
 await snap(page,'02-mit-low-quality');const low=await state();expect(low.fov).toBe(48);expect(low.cameraPosition[1]-low.cameraGroundHeight).toBeCloseTo(1.65,2);
 await page.keyboard.down('w');try{await expect.poll(async()=>distance((await state()).position,low.position)).toBeGreaterThan(.5);}finally{await page.keyboard.up('w');}
 await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'画质：省电',exact:true}).click();await expect.poll(async()=>(await state()).quality).toBe('standard');await page.keyboard.press('Escape');
});
test('courtyard stays grounded and stops movement at solid scenery',async({page})=>{
 test.setTimeout(130000);await page.goto('/real/mit');await ready(page);await expect.poll(async()=>(await campusState(page))?.mode).toBe('stroll');
 const entry=await campusState(page);let last=entry,blocked=false,moved=false;
 await page.keyboard.down('Shift');await page.keyboard.down('d');
 try{
  for(let i=0;i<60;i++){
   await page.waitForTimeout(500);const current=await campusState(page);
   expect(current.cameraPosition[1]-current.cameraGroundHeight).toBeCloseTo(1.65,2);expect(current.fov).toBe(48);
   if(distance(current.position,entry.position)>3)moved=true;
   if(moved&&distance(current.position,last.position)<.01){await page.waitForTimeout(750);const confirm=await campusState(page);if(distance(confirm.position,current.position)<.01){blocked=true;last=confirm;break;}}
   last=current;
  }
 }finally{await page.keyboard.up('d');await page.keyboard.up('Shift');}
 expect(moved,'the path from the courtyard entrance should permit walking').toBe(true);
 expect(blocked,'running toward the east side must stop before passing through the campus buildings').toBe(true);
 expect(distance(last.position,entry.position)).toBeLessThan(145);await snap(page,'03-courtyard-collision');
 // Reversing from the same stop proves this was a surface collision, not lost input focus.
 await page.keyboard.down('a');try{await expect.poll(async()=>distance((await campusState(page)).position,last.position)).toBeGreaterThan(.8);}finally{await page.keyboard.up('a');}
});
test('local scenes: both campuses, walking, photographs and 2D fallback',async({page})=>{
 const errors:string[]=[],external:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith('http://127.0.0.1:5173'))external.push(r.url());});
 await page.goto('/real/mit');await ready(page);
 await expect(page.getByRole('button',{name:'环境漫步',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(page.getByRole('region',{name:'校园故事任务'})).toBeHidden();
 await expect(page.getByRole('region',{name:'固定对照机位'})).toBeHidden();
 await page.getByRole('button',{name:'机位',exact:true}).click();await expect(page.getByRole('region',{name:'固定对照机位'})).toBeVisible();await snap(page,'04-viewpoints-menu');await page.getByRole('button',{name:'庭院鸟瞰',exact:true}).click();await ready(page);await expect(page.getByRole('button',{name:'3D 鸟瞰',exact:true})).toHaveAttribute('aria-pressed','true');await snap(page,'05-courtyard-overview');
 await page.getByRole('button',{name:'角色探索',exact:true}).click();await expect(page.getByRole('button',{name:'拍照',exact:true})).toBeEnabled();
 await page.locator('canvas').click();await page.keyboard.press('e');await expect(page.getByRole('dialog')).toBeVisible();await page.locator('.choices button').first().click();await page.locator('.choices button').first().click();await expect(page.getByText('再聊一个话题',{exact:true})).toBeVisible();await snap(page,'06-story-conversation');await page.keyboard.press('Escape');
 await page.keyboard.down('s');await page.waitForTimeout(1000);await page.keyboard.up('s');
 await snap(page,'07-mit-story');
 await page.getByRole('button',{name:'拍照',exact:true}).click();await expect(page.getByRole('status')).toContainText('照片已保存');
 await page.getByRole('button',{name:'任务与地点',exact:true}).click();await page.locator('.real-poi').first().click();await expect(page.getByRole('dialog')).toBeVisible();await page.getByRole('button',{name:'收藏地点',exact:true}).click();await expect(page.getByRole('button',{name:'取消收藏',exact:true})).toBeVisible();await snap(page,'08-location');await page.keyboard.press('Escape');
 await page.getByRole('link',{name:'Harvard',exact:true}).click();await ready(page);
 await snap(page,'09-harvard');
 await page.getByRole('button',{name:'航拍地图',exact:true}).click();await expect(page.locator('.local-map img')).toBeVisible();await page.locator('.real-poi').nth(1).click();await expect(page.getByRole('dialog')).toContainText('Widener Library');await page.keyboard.press('Escape');
 await snap(page,'10-harvard-map');
 expect(errors).toEqual([]);expect(external).toEqual([]);
});
test('390px layout keeps the scene visible and menus usable',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/real/mit');await ready(page);
 const layout=await page.evaluate(()=>{const canvas=document.querySelector('canvas')!.getBoundingClientRect(),caption=document.querySelector('.courtyard-caption')!.getBoundingClientRect();return {width:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,canvas:{width:canvas.width,height:canvas.height},captionHeight:caption.height};});
 expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);expect(layout.canvas.width).toBeGreaterThan(0);expect(layout.canvas.height).toBeGreaterThan(300);expect(layout.captionHeight).toBeLessThan(200);
 await snap(page,'11-mobile-stroll');await page.getByRole('button',{name:'机位',exact:true}).click();await expect(page.getByRole('region',{name:'固定对照机位'})).toBeVisible();await page.getByRole('button',{name:'3 号楼庭院面',exact:true}).click();await ready(page);
 await page.getByRole('button',{name:'地点',exact:true}).click();await expect(page.getByRole('link',{name:'Harvard',exact:true})).toBeVisible();await snap(page,'12-mobile-places');await page.getByRole('button',{name:'关闭地点',exact:true}).click();
 await page.getByRole('button',{name:'设置',exact:true}).click();await expect(page.getByRole('region',{name:'场景设置'})).toBeVisible();await page.getByRole('button',{name:'关闭设置',exact:true}).click();
});
test('no WebGL shows actual local orthophoto without a key prompt',async({page})=>{
 await page.addInitScript(()=>{const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(this:HTMLCanvasElement,...args:Parameters<typeof get>){if(String(args[0])==='webgl2')return null;return get.apply(this,args);} as typeof get;});
 await page.goto('/real/mit');await expect(page.locator('.local-map img')).toBeVisible();await expect(page.getByRole('button',{name:'3D 鸟瞰'})).toBeDisabled();await expect(page.getByRole('status')).toContainText('WebGL2');
});
