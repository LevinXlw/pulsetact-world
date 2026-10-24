/** Actual final-buffer checks for the narrowly prepared CDS entrances.
 * No browser, textures, application code changes, or new collision policy. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {Matrix4,Raycaster,Vector3} from 'three';

const here=dirname(fileURLToPath(import.meta.url));
const repo=resolve(here,'../../../..');
const sha=buffer=>createHash('sha256').update(buffer).digest('hex');
const load=async path=>{
 const bytes=await readFile(path),jsonLength=bytes.readUInt32LE(12);
 const doc=JSON.parse(bytes.subarray(20,20+jsonLength));
 return{bytes,doc,binary:bytes.subarray(28+jsonLength)};
};
function rawAccessor(file,index){
 const a=file.doc.accessors[index],v=file.doc.bufferViews[a.bufferView];
 const widths={SCALAR:1,VEC2:2,VEC3:3,VEC4:4};
 const sizes={5120:1,5121:1,5122:2,5123:2,5125:4,5126:4};
 const width=widths[a.type]*sizes[a.componentType],stride=v.byteStride??width;
 const start=(v.byteOffset??0)+(a.byteOffset??0);
 const result=Buffer.alloc(width*a.count);
 for(let i=0;i<a.count;i++)file.binary.copy(result,i*width,start+i*stride,start+i*stride+width);
 return result;
}
function nodeHashes(file){
 return file.doc.nodes.filter(n=>n.mesh!==undefined).map(n=>{
  const hash=createHash('sha256');
  for(const p of file.doc.meshes[n.mesh].primitives){
   for(const [name,a] of Object.entries(p.attributes).sort()){
    hash.update(name);hash.update(rawAccessor(file,a));
   }
   hash.update(rawAccessor(file,p.indices));
  }
  return{name:n.name,extras:n.extras,geometry:hash.digest('hex')};
 });
}
const snapshotPath=resolve(here,'door-campus-before.json');
if(process.argv.includes('--snapshot-campus')){
 const boston=await load(resolve(repo,'public/data/mobile/boston.glb'));
 const other={};
 for(const campus of ['umd','upenn','arizona'])
  for(const extension of ['glb','json']){
   const path=`public/data/mobile/${campus}.${extension}`;
   other[path]=sha(await readFile(resolve(repo,path)));
  }
 await writeFile(snapshotPath,JSON.stringify({bostonSHA256:sha(boston.bytes),nodes:nodeHashes(boston),other},null,2));
 console.log(JSON.stringify({snapshot:snapshotPath,nodes:boston.doc.nodes.length}));
 process.exit(0);
}
const checks=[],check=(condition,label)=>{assert.ok(condition,label);checks.push(label);};
const source=await load(resolve(here,'cds-mobile-source.glb'));
const manifest=JSON.parse(await readFile(resolve(here,'manifest.json'),'utf8'));
check(!source.doc.images&&!source.doc.textures,'Offline source contains no textures');
check(sha(source.bytes)===manifest.mobileOfflineSource.sha256,'Offline source hash matches manifest');
const parse=async file=>(await new GLTFLoader().parseAsync(file.bytes.buffer.slice(file.bytes.byteOffset,file.bytes.byteOffset+file.bytes.length),'')).scene;
const scene=await parse(source);
scene.updateMatrixWorld(true);
const meshList=[];
scene.traverse(o=>{if(o.isMesh)meshList.push(o);});
function inspectOpenings(meshes,transform,label){
 const origin=new Vector3(),direction=new Vector3(),ray=new Raycaster();
 const hits=(x,y,z,dx,dy,dz,distance)=>{
  origin.set(x,y,z).applyMatrix4(transform);
  direction.set(dx,dy,dz).transformDirection(transform);
  ray.set(origin,direction);ray.near=0;ray.far=distance;
  return ray.intersectObjects(meshes,false);
 };
 for(const center of [30.2,44.2]){
  for(const y of [.32,1.4,2.55])for(const dx of [-.95,0,.95]){
   const found=hits(center+dx,y,20,0,0,-1,2);
   check(!found.length,`${label}: ${center}+${dx}, y${y} passes through both leaf and backing planes`);
  }
  for(const dx of [-1.8,1.8]){
   const found=hits(center+dx,1.4,20,0,0,-1,2);
   check(found.length>0,`${label}: fixed adjacent glazing remains ${center}+${dx}`);
  }
  const threshold=hits(center+.6,1,18.95,0,-1,0,2);
  check(threshold.length>0,`${label}: threshold support remains at ${center}`);
 }
}
inspectOpenings(meshList,new Matrix4().makeTranslation(-35.75,0,-21.15),'source');
if(process.argv.includes('--verify-campus')){
 const before=JSON.parse(await readFile(snapshotPath,'utf8'));
 const boston=await load(resolve(repo,'public/data/mobile/boston.glb')),nodes=nodeHashes(boston);
 check(nodes.length===before.nodes.length,'Boston mesh count unchanged');
 for(const [index,old] of before.nodes.entries()){
  // Generic edge guards intentionally share names; preserve their source
  // traversal order rather than incorrectly comparing all to the first guard.
  const current=nodes[index];
  check(!!current,`Boston retained node ${old.name}`);
  check(current.name===old.name,`Boston retained node order ${index}`);
  check(JSON.stringify(current.extras)===JSON.stringify(old.extras),`Boston retained collision/visibility flags ${old.name}`);
  if(!old.name.includes('BU CDS refined'))
   check(current.geometry===old.geometry,`Boston non-CDS geometry unchanged ${old.name}`);
  else if(old.name.includes('paving')||old.name.includes('grass'))
   check(current.geometry===old.geometry,`Boston CDS ground/terrace unchanged ${old.name}`);
 }
 for(const [path,expected] of Object.entries(before.other))
  check(sha(await readFile(resolve(repo,path)))===expected,`Unrequested campus unchanged ${path}`);
 const campus=await parse(boston),campusMeshes=[];
 campus.updateMatrixWorld(true);
 campus.traverse(o=>{if(o.isMesh&&!o.userData.mobileHidden&&o.name.includes('CDS'))campusMeshes.push(o);});
 check(campusMeshes.length>0,'Baked Boston contains visible CDS meshes');
 const input=JSON.parse(await readFile(resolve(here,'input/manifest.json'),'utf8'));
 const originalToWorld=new Matrix4().fromArray(input.toWorld).multiply(new Matrix4().makeTranslation(-35.75,0,-21.15));
 inspectOpenings(campusMeshes,originalToWorld,'Boston baked');
 check(boston.bytes.length<25*1024*1024,'Boston remains below 25 MiB');
 checks.push(`Boston ${boston.bytes.length} bytes, SHA256 ${sha(boston.bytes)}`);
}
const report={passed:true,checkedAt:new Date().toISOString(),checks,sourceBytes:source.bytes.length,sourceSHA256:sha(source.bytes)};
await writeFile(resolve(here,'door-verification.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({passed:true,checks:checks.length,sourceBytes:source.bytes.length,sourceSHA256:report.sourceSHA256}));
