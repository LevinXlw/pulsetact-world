import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {authenticateContext} from './test-auth.mjs';

const base=process.env.WORLD_BASE_URL||'http://127.0.0.1:5186';
const output='output/water-green-line/legacy-mit';
const report={base,startedAt:new Date().toISOString(),errors:[],checks:[],states:[]};
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
let page,fiberURL;
try{
  const context=await browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:1});
  await authenticateContext(context,base);page=await context.newPage();page.setDefaultTimeout(180000);
  page.on('request',request=>{if(/\/\.vite\/deps\/@react-three_fiber\.js/.test(request.url()))fiberURL=request.url();});
  page.on('pageerror',error=>report.errors.push({type:'pageerror',message:error.message}));
  page.on('console',message=>{if(message.type()==='error')report.errors.push({type:'console',message:message.text()});});
  await page.goto(`${base}/real/mit`,{waitUntil:'domcontentloaded'});
  await expect(page.getByRole('button',{name:'拍照',exact:true})).toBeEnabled({timeout:180000});
  await page.waitForFunction(()=>window.__localCampus?.vegetationStatus==='ready');
  assert.ok(fiberURL,'actual page loads the R3F module');
  await page.evaluate(async url=>{
    const {_roots}=await import(url),canvas=document.querySelector('canvas');
    const store=_roots.get(canvas)?.store;if(!store)throw Error('Live R3F scene not found');
    window.legacyWaterQA={store};
  },fiberURL);
  await page.getByRole('button',{name:'机位',exact:true}).click();
  await page.getByRole('button',{name:'河岸环境',exact:true}).click();
  await expect(page.getByRole('button',{name:'拍照',exact:true})).toBeEnabled({timeout:180000});

  const state=()=>page.evaluate(()=>{
    const {gl,scene}=window.legacyWaterQA.store.getState(),water=[];
    scene.traverse(object=>{if(!object.isMesh)return;for(const material of Array.isArray(object.material)?object.material:[object.material]){
      if(material.name==='water'||material.userData.campusWater)water.push({
        mesh:object.name,visible:object.visible,uuid:material.uuid,geometry:object.geometry.uuid,
        triangles:(object.geometry.index?.count??object.geometry.attributes.position.count)/3,
        name:material.name,shared:material.userData.campusWater===true,quality:material.userData.campusWaterQuality,
        key:material.customProgramCacheKey(),time:material.waterUniforms?.uCampusWaterTime.value,
      });
    }});
    const context=gl.getContext(),programs=(gl.info.programs??[]).map(program=>({
      sharedWater:(context.getShaderSource(program.fragmentShader)||'').includes('cwWaterSlope'),
      runnable:program.diagnostics?.runnable??null,log:program.diagnostics?.programLog??'',
    }));
    return {page:window.__localCampus,water,glError:context.getError(),programs};
  });
  let original;
  for(const tier of [{label:'standard',quality:'desktop'},{label:'low',quality:'mobile-hd'},{label:'standard-again',quality:'desktop'}]){
    if(tier.label!=='standard'){
      await page.getByRole('button',{name:'设置',exact:true}).click();
      await page.getByRole('button',{name:tier.label==='low'?'画质：标准':'画质：省电',exact:true}).click();
      await page.keyboard.press('Escape');
      await page.waitForFunction(quality=>window.__localCampus?.quality===quality,tier.label==='low'?'low':'standard');
    }
    await page.waitForTimeout(650);
    const before=await state();await page.waitForTimeout(1100);const after=await state();
    assert.ok(after.water.length>0,'actual legacy page exposes its water meshes');
    assert.ok(after.water.every(w=>w.shared&&w.quality===tier.quality&&w.key.startsWith('campus-water-')),'quality keeps new water shader installed');
    assert.ok(after.water.every((w,i)=>w.time>before.water[i].time+.05),'water clock advances in every quality');
    assert.equal(after.glError,0,'no WebGL error');
    assert.ok(after.programs.some(p=>p.sharedWater),'new water shader compiled on the actual GPU');
    assert.ok(after.programs.every(p=>p.runnable!==false),'all actual page shaders compile');
    const identities=after.water.map(({uuid,geometry})=>({uuid,geometry}));
    if(original)assert.deepEqual(identities,original,'quality toggles retain original water material and geometry');else original=identities;
    report.states.push({tier:tier.label,before:before.water,after});
    report.checks.push(`${tier.label}: shared shader compiled, water clock advances, geometry and material retained`);
    if(tier.label==='standard')await page.locator('canvas').screenshot({path:`${output}/river-standard.png`});
    console.log(JSON.stringify({tier:tier.label,water:after.water,compiledWaterPrograms:after.programs.filter(p=>p.sharedWater).length,glError:after.glError}));
  }
  assert.deepEqual(report.errors,[],'no browser or shader errors');
  report.status='passed';
}catch(error){report.status='failed';report.failure=error.stack??String(error);process.exitCode=1;if(page)await page.screenshot({path:`${output}/failure.png`}).catch(()=>{});}
finally{report.completedAt=new Date().toISOString();await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify({status:report.status,checks:report.checks,errors:report.errors,failure:report.failure}));}
