import {constants} from 'node:fs';
import {copyFile,mkdir,stat,writeFile} from 'node:fs/promises';
import {createServer} from 'vite';

// Stable reference viewpoints, not a random tour. Heights are above the final
// terrain/walkable surface, so replacing the DEM does not bury the camera.
// Prepare without opening a browser:
//   node scripts/capture-bu-core.mjs --prepare-only
// Capture only after terrain, buildings and street assets are stable:
//   node scripts/capture-bu-core.mjs
// Optional: --views=01-marsh-front,04-mugar-oblique
const directory=process.env.BU_CAPTURE_DIRECTORY||'output/bu-core-20261017',base=process.env.WORLD_BASE_URL||'http://127.0.0.1:5186';
const prepareOnly=process.argv.includes('--prepare-only');
const selected=process.argv.find(arg=>arg.startsWith('--views='))?.slice(8).split(',');
const chapelReference='https://www.bu.edu/articles/2025/photo-gallery-marsh-chapels-history/';
const sertReference='https://www.bu.edu/community/files/2012/06/FinalPNF-EENF6-15-12Small.pdf';
const riverReference='https://www.bumc.bu.edu/citylab/files/2023/06/BU-Charles-River-Campus-Map.pdf';
const frames=[
  {id:'01-marsh-front',eye:[-1188.56,1.75,1005.23],target:[-1182.63,11.5,964.66],fov:52,reference:chapelReference,inspect:'Paired portals, complete stair, west-side memorial, low links and plaza enclosure.'},
  {id:'02-marsh-plaza-side',eye:[-1158.76,1.75,1002.64],target:[-1190.48,8.5,968.56],fov:58,reference:chapelReference,inspect:'Actual wing returns, plaza edge, west monument offset and terrain-to-entry transition.'},
  {id:'03-marsh-rear-links',eye:[-1142,15,916],target:[-1191,7,961],fov:60,reference:chapelReference,inspect:'Narrow chapel projection, both connecting wings, north foundations and lawn level.'},
  {id:'04-mugar-oblique',eye:[-1455,110,1020],target:[-1290,12,900],fov:54,reference:sertReference,inspect:'GSU/Mugar stepped roofs, Redstone/tower relationship and retained open passages.'},
  {id:'05-mugar-roof-plan',eye:[-1306,145,902],target:[-1306,0,903],fov:59,reference:sertReference,inspect:'Plan gaps and attached volumes; this is an aerial inspection, not a pedestrian camera.'},
  {id:'06-gsu-walk',eye:[-1438,1.75,986],target:[-1388,8.5,931],fov:57,reference:sertReference,inspect:'GSU pedestrian frontage, raised hall volume and street edge at human scale.'},
  {id:'07-law-forecourt',eye:[-1236.963,1.75,954.013],target:[-1231.160,8.5,917.471],fov:65,reference:sertReference,inspect:'From the actual Sert-local (100.4,72) forecourt passage toward Pappas/tower link, with Redstone at left; avoids the STH courtyard wall that blocked the former view.'},
  {id:'08-storrow-corridor',eye:[-970,60,1010],target:[-1070,3,855],fov:60,reference:riverReference,inspect:'Campus/road/river ordering, divided Storrow corridor, real terrain fall and riverbank strip.'},
  {id:'09-bay-state-footbridge',eye:[-1243,18,832],target:[-1152,.75,866],targetBridge:'bay-state',fov:55,reference:riverReference,inspect:'Bay State crossing profile, raised span, north/south landings and guardrail continuity.'},
  {id:'10-bay-state-approach',eye:[-1160,1.75,909],target:[-1152,.2,866],targetBridge:'bay-state',fov:58,reference:riverReference,inspect:'Lawn-to-bridge approach at walking height; check ramp joins and no floating threshold.'},
  {id:'11-silber-footbridge',eye:[-725,15,870],target:[-663,.75,910],targetBridge:'silber-way',fov:58,reference:riverReference,inspect:'Silber crossing over Storrow, switchbacks and connection to Silber/Back Street.'},
  {id:'12-silber-approach',eye:[-671.6,1.75,946],target:[-663,.2,910],targetBridge:'silber-way',fov:58,reference:riverReference,inspect:'South landing from street height; inspect walls, sidewalks and ramp access.'},
  {id:'13-mugar-forecourt',eye:[-1332.879,1.75,975.231],target:[-1329.318,4,952.812],fov:60,reference:sertReference,inspect:'Mugar forecourt, southern facade and connection towards the actual GSU Link entrance.'},
  {id:'14-gsu-frontage',eye:[-1395.633,1.75,981.465],target:[-1391.586,6,955.984],fov:64,reference:sertReference,inspect:'Commonwealth frontage of the union; distinguish its facade from the shared Link main entrance.'},
  {id:'15-gsu-library-link',eye:[-1351.894,1.75,961.105],target:[-1348.365,2.7,938.883],fov:58,reference:'https://www.bu.edu/reservations/gsu/',inspect:'The shared Link entrance: GSU left, Mugar right, entrance canopy and ground junction.'},
  {id:'16-bay-state-street',eye:[-510,1.75,1010],target:[-770,9,980],fov:55,reference:'https://www.bu.edu/housing/residence/bay-state-road/',inspect:'Residential street context: bowed facades, entry axes and retained planted setbacks.'},
  {id:'17-bay-state-bow',eye:[-824,1.75,965],target:[-833.1,6.8,978.4],fov:62,reference:'https://www.bu.edu/housing/residence/bay-state-road/',inspect:'192 Bay State curved facade: window openings must span the short GIS arc edges, without adding a new projecting volume.'},
  {id:'18-bay-state-stoop',eye:[-742.5,1.75,980.5],target:[-747.3,1.1,989],fov:62,reference:'https://www.bu.edu/housing/residence/bay-state-road/',inspect:'168 Bay State entrance: inspect the actual model door/stoop axis and its paving connection to the sidewalk.'},
  {id:'19-cds-west-entry',eye:[-920.426,1.75,1041.726],target:[-911.108,2.9,1022.895],fov:62,reference:'https://www.bu.edu/cpo/files/2019/12/19.12.03_Student-Town-Hall-Slide-Deck-_v1.pdf',inspect:'CDS west ground floor: street-level glazing and the plaza connection at the existing footprint.'},
  {id:'20-cds-podium-entry',eye:[-879.156,1.75,1049.773],target:[-878.688,2.9,1032.730],fov:65,reference:'https://www.bu.edu/cpo/files/2019/12/19.12.03_Student-Town-Hall-Slide-Deck-_v1.pdf',inspect:'CDS east podium: door-scale glazing, sill and terrain approach; no new interior access.'},
  {id:'21-cds-street-context',eye:[-865,33,1096],target:[-899,16,1020],fov:62,reference:'https://www.bu.edu/cpo/files/2019/12/19.12.03_Student-Town-Hall-Slide-Deck-_v1.pdf',inspect:'CDS ground plaza in Commonwealth context; retain tower offsets and avoid paving over the street.'},
];

function inside([x,z],ring){
  let result=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[i],b=ring[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])result=!result;
  }return result;
}
function edgeDistance([x,z],ring){
  return Math.min(...ring.map((a,i)=>{const b=ring[(i+1)%ring.length],dx=b[0]-a[0],dz=b[1]-a[1],l2=dx*dx+dz*dz,t=l2?Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/l2)):0;return Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t);}));
}

async function preserveBefore(){
  await mkdir(`${directory}/before`,{recursive:true});
  const previous=[
    'output/bu-full-campus/art/02-central-campus.png',
    'output/bu-full-campus/art/12-marsh-plaza.png',
    'output/bu-full-campus/art/visual-report.json',
    'output/bu-full-campus/production/bu-marsh.png',
    'output/bu-full-campus/production/bu-mugar.png',
    'output/bu-full-campus/production/bu-gsu.png',
    'output/bu-full-campus/production/bu-bridge.png',
  ],preserved=[];
  for(const source of previous){
    const destination=`${directory}/before/${source.includes('/production/')?'production':'art'}-${source.split('/').at(-1)}`;
    try{
      const metadata=await stat(source);
      try{await copyFile(source,destination,constants.COPYFILE_EXCL);}catch(error){if(error.code!=='EEXIST')throw error;}
      preserved.push({source,destination,sourceModifiedAt:metadata.mtime.toISOString()});
    }catch(error){if(error.code!=='ENOENT')throw error;}
  }
  // Preserve the first provenance record too. Old images may use different
  // camera poses; do not present these as pixel-aligned before/after captures.
  try{await writeFile(`${directory}/before/manifest.json`,JSON.stringify({createdAt:new Date().toISOString(),note:'Existing screenshots retained without overwriting. Legacy views are not camera-aligned with this new fixed suite.',preserved},null,2),{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}
  return preserved;
}

async function preflight(views){
  const vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',logLevel:'error'});
  try{
    const [{BU_FULL_BUILDINGS},{BU_MARSH_ASSEMBLY},{BU_SERT_PARTS,BU_SERT_FOUNDATION_ANCHOR},{buElevation},{BU_RIVER_FOOTBRIDGES,buFootbridgeHeights}]=await Promise.all([
      vite.ssrLoadModule('/src/features/world/bu-full-layout.ts'),vite.ssrLoadModule('/src/features/world/bu-landmark-layout.ts'),
      vite.ssrLoadModule('/src/features/world/bu-sert-layout.ts'),vite.ssrLoadModule('/src/features/world/bu-terrain.ts'),vite.ssrLoadModule('/src/features/world/bu-river-core-layout.ts'),
    ]);
    const marshBase=buElevation(...BU_MARSH_ASSEMBLY.foundationAnchor),sertBase=buElevation(...BU_SERT_FOUNDATION_ANCHOR);
    const volumes=[
      ...BU_FULL_BUILDINGS.filter(b=>!b.custom&&b.id!=='gsu-mugar').map(b=>({id:b.id,footprint:b.footprint,holes:b.holes,base:b.id==='cas-east'?marshBase:b.id==='law-tower'?sertBase:buElevation(b.x,b.z),bottom:0,top:b.height})),
      ...BU_SERT_PARTS.map(p=>({...p,base:sertBase})),
      {id:'marsh-chapel',footprint:BU_MARSH_ASSEMBLY.chapelFootprint,base:marshBase,bottom:0,top:28},
      ...BU_MARSH_ASSEMBLY.wings.map(p=>({...p,base:marshBase,bottom:0,top:p.height})),
    ];
    const report=views.map(frame=>{
      const [x,height,z]=frame.eye,terrain=buElevation(x,z),y=terrain+height,obstacles=[],near=[];
      for(const volume of volumes){
        // Ground-level foundations extend down to local terrain where needed.
        const low=volume.bottom>0?volume.base+volume.bottom:Math.min(terrain,volume.base);
        if(y<low||y>volume.base+volume.top+.2)continue;
        const inHole=volume.holes?.some(ring=>inside([x,z],ring));
        if(inside([x,z],volume.footprint)&&!inHole)obstacles.push(volume.id);
        else if(edgeDistance([x,z],volume.footprint)<1)near.push(volume.id);
      }
      const [tx,th,tz]=frame.target,bridge=BU_RIVER_FOOTBRIDGES.find(b=>b.id===frame.targetBridge);
      const targetY=(bridge?buFootbridgeHeights(bridge.points,buElevation)[1]:buElevation(tx,tz))+th;
      return {...frame,resolvedEye:[x,y,z],resolvedTarget:[tx,targetY,tz],terrain,obstacles,withinOneMetreOf:near};
    });
    await writeFile(`${directory}/camera-preflight.json`,JSON.stringify({generatedAt:new Date().toISOString(),method:'Read-only Node/Vite SSR check against GIS and authored structural footprints; no browser and no screenshots.',views:report},null,2));
    const blocked=report.filter(view=>view.obstacles.length);
    if(blocked.length)throw Error(`Camera inside building volume: ${blocked.map(view=>`${view.id}: ${view.obstacles.join(', ')}`).join('; ')}`);
    return report;
  }finally{await vite.close();}
}

async function capture(views){
  const {chromium}=await import('@playwright/test');
  const {authenticateContext}=await import('./test-auth.mjs');
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
  const context=await browser.newContext({viewport:{width:1600,height:1000}});
  const errors=[],report=[],geometryIssues=[];
  try{
    await authenticateContext(context,base);
    const page=await context.newPage();page.setDefaultTimeout(120000);
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
    await page.route('**/bu-core-review',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><title>BU core fixed viewpoints</title></head><body style="margin:0"></body></html>'}));
    await page.goto(`${base}/bu-core-review`);
    await page.evaluate(async()=>{
      const THREE=await import('/node_modules/three/build/three.module.js');
      const {loadWorldAssets}=await import('/src/features/world/scene-assets.ts');
      const {buElevation}=await import('/src/features/world/bu-terrain.ts');
      const {BU_RIVER_FOOTBRIDGES,buFootbridgeHeights}=await import('/src/features/world/bu-river-core-layout.ts');
      const {BOSTON_DAYLIGHT:light}=await import('/src/features/world/campus-daylight.ts');
      const assets=await loadWorldAssets(new AbortController().signal,'boston');
      const invalidGeometry=[];
      assets.model.traverse(object=>{
        if(!object.isMesh)return;const positions=object.geometry.getAttribute('position');if(!positions)return;
        for(let i=0;i<positions.count;i++)if(!Number.isFinite(positions.getX(i))||!Number.isFinite(positions.getY(i))||!Number.isFinite(positions.getZ(i))){
          invalidGeometry.push({mesh:object.name,parent:object.parent?.name,vertex:i,position:[positions.getX(i),positions.getY(i),positions.getZ(i)]});break;
        }
      });
      const scene=new THREE.Scene();scene.background=new THREE.Color('#c5d9d5');scene.fog=new THREE.Fog('#c5d9d5',180,2600);
      scene.add(assets.model,new THREE.HemisphereLight(light.sky,light.ground,light.ambient));
      const sun=new THREE.DirectionalLight(light.sun,light.intensity);sun.castShadow=true;sun.shadow.mapSize.set(4096,4096);
      Object.assign(sun.shadow.camera,{left:-110,right:110,top:110,bottom:-110,near:1,far:420});sun.shadow.bias=-.00008;sun.shadow.normalBias=.035;sun.shadow.radius=3;scene.add(sun,sun.target);
      const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(1600,1000);renderer.setPixelRatio(1);renderer.toneMapping=THREE.ACESFilmicToneMapping;
      renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;document.body.appendChild(renderer.domElement);
      const camera=new THREE.PerspectiveCamera(55,1.6,.12,4200);
      window.review={THREE,assets,scene,renderer,camera,sun,buElevation,light,invalidGeometry,BU_RIVER_FOOTBRIDGES,buFootbridgeHeights};
    });
    geometryIssues.push(...await page.evaluate(()=>window.review.invalidGeometry));
    await mkdir(`${directory}/after`,{recursive:true});
    for(const frame of views){
      const result=await page.evaluate(async frame=>{
        const {THREE,assets,scene,renderer,camera,sun,buElevation,light,BU_RIVER_FOOTBRIDGES,buFootbridgeHeights}=window.review;
        const [x,h,z]=frame.eye,[tx,th,tz]=frame.target;
        const ground=h<4?(assets.collision.groundHeight(x,z)??buElevation(x,z)):buElevation(x,z);
        const bridge=BU_RIVER_FOOTBRIDGES.find(b=>b.id===frame.targetBridge);
        const targetY=(bridge?buFootbridgeHeights(bridge.points,buElevation)[1]:buElevation(tx,tz))+th;
        camera.fov=frame.fov;camera.updateProjectionMatrix();camera.position.set(x,ground+h,z);camera.lookAt(tx,targetY,tz);camera.updateMatrixWorld();
        sun.target.position.set(tx,buElevation(tx,tz),tz);sun.position.copy(sun.target.position).add(new THREE.Vector3(...light.offset));sun.target.updateMatrixWorld();
        assets.update(camera.position);
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        renderer.render(scene,camera);
        const direction=new THREE.Vector3();camera.getWorldDirection(direction);
        const nearHit=assets.collision.distance(camera.position,direction,1);
        return {png:renderer.domElement.toDataURL('image/png'),calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,camera:camera.position.toArray(),target:[tx,targetY,tz],nearObstacleMetres:nearHit??null};
      },frame);
      await writeFile(`${directory}/after/${frame.id}.png`,Buffer.from(result.png.split(',')[1],'base64'));
      const {png,...stats}=result;report.push({...frame,...stats});console.log(`Captured ${frame.id}`);
    }
    await writeFile(`${directory}/visual-report.json`,JSON.stringify({capturedAt:new Date().toISOString(),base,views:report,errors,geometryIssues},null,2));
    if(errors.length)throw Error(errors.join('\n'));
    if(report.some(view=>view.nearObstacleMetres!==null))throw Error('A fixed camera is within one metre of an obstacle; inspect visual-report.json.');
  }finally{await browser.close();}
}

await preserveBefore();
if(selected?.some(id=>!frames.some(frame=>frame.id===id)))throw Error(`Unknown --views selection: ${selected.join(',')}`);
const views=frames.filter(frame=>!selected||selected.includes(frame.id));
const checked=await preflight(views);
console.log(JSON.stringify({views:checked.length,camerasInsideBuildings:0,mode:prepareOnly?'prepare-only':'capture',directory}));
if(!prepareOnly)await capture(views);
