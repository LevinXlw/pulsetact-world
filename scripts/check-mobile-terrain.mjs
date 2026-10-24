import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createServer} from 'vite';

// Test the actual baked mesh surfaces, not merely the separately baked physical
// height grid. Mobile paving is bounded approximation, not exact lattice parity.
const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>typeof url==='string'&&url.startsWith('/data/mobile/')?new Response(await readFile('public'+url)):originalFetch(url,options);
const vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',logLevel:'error'});
const report={command:'node scripts/check-mobile-terrain.mjs',generatedAt:new Date().toISOString(),samplesPerCampus:6000,toleranceMeters:.1,note:'Rendered terrain and adaptive paving versus the runtime physical height grid; source lattice parity alone does not test visual alignment.',campuses:[],failures:[]};
try{
  const [{loadMobileCampus},{createCampusGroundSampler},{REMOTE_LAYOUTS}]=await Promise.all([
    vite.ssrLoadModule('/src/features/world/mobile-campus.ts'),
    vite.ssrLoadModule('/src/features/world/campus-ground-sampler.ts'),
    vite.ssrLoadModule('/src/features/world/campus-regions.ts'),
  ]);
  for(const campus of ['umd','arizona']){
    const asset=await loadMobileCampus(new AbortController().signal,campus),ground=[],paving=[],terrain=[];
    asset.model.traverse(mesh=>{if(!mesh.userData.mobileGround)return;ground.push(mesh);if(mesh.name.replaceAll(' ','_')==='Mobile_terrain')terrain.push(mesh);else paving.push(mesh);});
    const rendered=createCampusGroundSampler(ground),road=createCampusGroundSampler(paving),soil=createCampusGroundSampler(terrain),layout=REMOTE_LAYOUTS[campus],samples=[],pavingSamples=[],terrainSamples=[];
    let seed=811;
    for(let i=0;i<report.samplesPerCampus;i++){
      seed=(Math.imul(seed,1664525)+1013904223)>>>0;const x=layout.bounds.minX+seed/4294967296*(layout.bounds.maxX-layout.bounds.minX);
      seed=(Math.imul(seed,1664525)+1013904223)>>>0;const z=layout.bounds.minZ+seed/4294967296*(layout.bounds.maxZ-layout.bounds.minZ);
      const physical=asset.collision.groundHeight(x,z),visible=rendered(x,z),roadHeight=road(x,z),terrainHeight=soil(x,z);
      if(visible===undefined||physical===undefined){report.failures.push({campus,x,z,issue:'missing-ground'});continue;}
      const sample={x,z,difference:visible-physical};samples.push(sample);
      if(Math.abs(sample.difference)>report.toleranceMeters)report.failures.push({campus,...sample,issue:'visible-height-mismatch'});
      if(roadHeight!==undefined){const item={x,z,difference:roadHeight-physical};pavingSamples.push(item);if(Math.abs(item.difference)>report.toleranceMeters)report.failures.push({campus,...item,issue:'paving-height-mismatch'});}
      if(terrainHeight!==undefined)terrainSamples.push({x,z,difference:terrainHeight-physical});
    }
    const stats=list=>{list.sort((a,b)=>Math.abs(b.difference)-Math.abs(a.difference));return{count:list.length,maxAbsoluteMeters:Math.abs(list[0]?.difference??0),p95AbsoluteMeters:Math.abs(list[Math.floor(list.length*.05)]?.difference??0),meanAbsoluteMeters:list.reduce((sum,p)=>sum+Math.abs(p.difference),0)/list.length,worst:list.slice(0,5)};};
    const bytes=await readFile(`public/data/mobile/${campus}.glb`),metadata=JSON.parse(await readFile(`public/data/mobile/${campus}.json`,'utf8'));
    report.campuses.push({campus,assetSha256:createHash('sha256').update(bytes).digest('hex'),metadata,surface:stats(samples),paving:stats(pavingSamples),terrain:stats(terrainSamples)});
    asset.dispose();
  }
  await mkdir('output/mobile-terrain',{recursive:true});await writeFile('output/mobile-terrain/report.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({campuses:report.campuses.map(c=>({campus:c.campus,bytes:c.metadata.bytes,samples:c.surface.count,maxSurfaceMeters:c.surface.maxAbsoluteMeters,maxPavingMeters:c.paving.maxAbsoluteMeters,maxTerrainMeters:c.terrain.maxAbsoluteMeters})),failures:report.failures.length}));
  if(report.failures.length)process.exitCode=1;
}finally{await vite.close();globalThis.fetch=originalFetch;}
