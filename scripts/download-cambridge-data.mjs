import {readFile,writeFile,mkdir,stat,rename,open} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=new URL('../assets-source/cambridge-gis/',import.meta.url);
const index=JSON.parse(await readFile(new URL('metadata/download-map.json',root),'utf8'));
const grid=JSON.parse(await readFile(new URL('metadata/tile-grid.geojson',root),'utf8'));
const selected=[{tile:'E3',campus:'harvard'},{tile:'F4',campus:'mit'},{tile:'G4',campus:'mit'}];
const html=index.operationalLayers[0].popupInfo.description;
const templates=[...html.matchAll(/href='([^']+\.zip)'/g)].map(x=>x[1]);
const types=[['buildings','Bulding_Models_OBJ'],['terrain','TerrainMesh_OBJ'],['orthophoto','OrthoPhoto_JPG'],['groundplan','GISGroundplan_JPG']];
const jobs=selected.flatMap(s=>{
 const feature=grid.features.find(f=>f.properties.tile_id===s.tile);if(!feature)throw new Error(`Missing grid ${s.tile}`);
 return types.map(([kind,pattern])=>{const template=templates.find(t=>t.includes(pattern));if(!template)throw new Error(`Missing official link ${pattern}`);const url=template.replaceAll('{grid_col}',feature.properties.grid_col).replaceAll('{grid_row}',feature.properties.grid_row);const filename=new URL(url).pathname.split('/').pop();return {...s,kind,url,path:`${s.campus}/${s.tile}/${filename}`};});
});
await writeFile(new URL('metadata/download-plan.json',root),JSON.stringify({source:'https://www.cambridgema.gov/gis/3d/3ddata/3ddatadownloadmap',selectedTiles:selected,files:jobs},null,2));
const manifest=[];
async function rangedDownload(job,target,expected){
 const temporary=new URL(`${job.path}.part`,root),file=await open(temporary,'w');
 const block=256*1024;let offset=0,received=0;
 try{const results=await Promise.allSettled(Array.from({length:6},async()=>{while(offset<expected){const start=offset;offset+=block;const end=Math.min(start+block,expected)-1;let last;
  for(let attempt=0;attempt<4;attempt++){try{const response=await fetch(job.url,{headers:{Range:`bytes=${start}-${end}`,Connection:'close'},signal:AbortSignal.timeout(45000)});if(response.status!==206)throw new Error(`Expected HTTP 206; got ${response.status}`);const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length!==end-start+1)throw new Error('Incomplete range');let written=0;while(written<bytes.length){const r=await file.write(bytes,written,bytes.length-written,start+written);written+=r.bytesWritten;}received+=bytes.length;if(received%(5*1024*1024)===0)console.log(`PROGRESS ${job.tile} ${job.kind}: ${(received/1048576).toFixed(0)} MiB`);last=null;break;}catch(e){last=e;console.log(`RANGE RETRY ${job.tile} ${start} attempt ${attempt+1}`);}}
  if(last)throw last;
 }}));const failure=results.find(r=>r.status==='rejected');if(failure)throw failure.reason;if(received!==expected)throw new Error('Incomplete file');}
 finally{await file.close();}
 await rename(temporary,target);
}
async function hash(file){const h=createHash('sha256');for await(const chunk of createReadStream(file))h.update(chunk);return h.digest('hex');}
async function work(job){
 const target=new URL(job.path,root);await mkdir(new URL('./',target),{recursive:true});
 if(process.argv.includes('--head')){const response=await fetch(job.url,{method:'HEAD',signal:AbortSignal.timeout(60000)});console.log(JSON.stringify({...job,status:response.status,bytes:response.headers.get('content-length')}));return;}
 const head=await fetch(job.url,{method:'HEAD',signal:AbortSignal.timeout(60000)});if(!head.ok)throw new Error(`HTTP ${head.status}`);const expected=Number(head.headers.get('content-length'));if(!expected)throw new Error('Missing file size');
 const old=await stat(target).catch(()=>null);if(old?.size===expected){console.log(`EXISTS ${job.path}`);}else await rangedDownload(job,target,expected);
 const record={...job,bytes:(await stat(target)).size,sha256:await hash(target),downloadedAt:new Date().toISOString()};manifest.push(record);await writeFile(new URL('metadata/download-manifest.json',root),JSON.stringify({source:'City of Cambridge GIS official download map',files:manifest},null,2));console.log(`OK ${job.path} ${(record.bytes/1024/1024).toFixed(1)} MiB`);
}
let cursor=0;const errors=[];await Promise.all(Array.from({length:3},async()=>{while(cursor<jobs.length){const job=jobs[cursor++];try{await work(job);}catch(e){errors.push({file:job.path,error:e.message});console.log(`FAILED ${job.path}: ${e.message}`);}}}));
if(errors.length){await writeFile(new URL('metadata/download-errors.json',root),JSON.stringify(errors,null,2));process.exitCode=1;}
if(!process.argv.includes('--head'))await writeFile(new URL('metadata/download-manifest.json',root),JSON.stringify({source:'City of Cambridge GIS official download map',files:manifest.sort((a,b)=>a.path.localeCompare(b.path))},null,2));
console.log(`Directory: ${fileURLToPath(root)}; completed ${manifest.length}/${jobs.length}`);
