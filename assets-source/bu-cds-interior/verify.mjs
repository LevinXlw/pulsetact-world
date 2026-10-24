import {readFile,writeFile} from 'node:fs/promises';
import {Matrix4,Vector3,Quaternion,Ray} from 'three';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const assetRoot=new URL('../../public/assets/bu-cds-interior/',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('manifest.json',assetRoot),'utf8'));
const checks=[];
async function load(name){
 const bytes=await readFile(new URL(name,assetRoot));assert.equal(bytes.toString('ascii',0,4),'glTF');assert.equal(bytes.readUInt32LE(8),bytes.length);
 let doc,bin;for(let offset=12;offset<bytes.length;){const size=bytes.readUInt32LE(offset),type=bytes.readUInt32LE(offset+4),chunk=bytes.subarray(offset+8,offset+8+size);if(type===0x4e4f534a)doc=JSON.parse(chunk);if(type===0x004e4942)bin=chunk;offset+=8+size;}
 const sizes={5120:1,5121:1,5122:2,5123:2,5125:4,5126:4},readers={5120:'readInt8',5121:'readUInt8',5122:'readInt16LE',5123:'readUInt16LE',5125:'readUInt32LE',5126:'readFloatLE'},components={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16};
 const cache=new Map();
 function acc(id){if(cache.has(id))return cache.get(id);const a=doc.accessors[id],v=doc.bufferViews[a.bufferView],width=sizes[a.componentType],count=components[a.type],start=(v.byteOffset??0)+(a.byteOffset??0),stride=v.byteStride??width*count,out=[];for(let i=0;i<a.count;i++)for(let j=0;j<count;j++){const n=bin[readers[a.componentType]](start+i*stride+j*width);assert.ok(Number.isFinite(n),`${name} attribute finite`);out.push(n);}cache.set(id,out);return out;}
 const triangles=[];
 function visit(id,parent){const node=doc.nodes[id],local=node.matrix?new Matrix4().fromArray(node.matrix):new Matrix4().compose(new Vector3().fromArray(node.translation??[0,0,0]),new Quaternion().fromArray(node.rotation??[0,0,0,1]),new Vector3().fromArray(node.scale??[1,1,1])),world=parent.clone().multiply(local);if(node.mesh!==undefined)for(const p of doc.meshes[node.mesh].primitives){const positions=acc(p.attributes.POSITION),index=p.indices===undefined?Array.from({length:positions.length/3},(_,i)=>i):acc(p.indices);for(const aid of Object.values(p.attributes))acc(aid);for(let i=0;i<index.length;i+=3){assert.ok(index.slice(i,i+3).every(v=>v>=0&&v<positions.length/3));const pts=[0,1,2].map(k=>new Vector3().fromArray(positions,index[i+k]*3).applyMatrix4(world)),normal=pts[1].clone().sub(pts[0]).cross(pts[2].clone().sub(pts[0])).normalize();triangles.push({name:node.name,points:pts,normal});}}for(const child of node.children??[])visit(child,world);}
 for(const id of doc.scenes[doc.scene??0].nodes)visit(id,new Matrix4());
 return{doc,triangles,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};
}
const physics=await load('physics.glb'),desktop=await load('interior-desktop.glb'),mobile=await load('interior-mobile.glb');
assert.equal(mobile.doc.textures?.length??0,0);assert.equal(mobile.doc.images?.length??0,0);checks.push('Mobile has no images or textures');
function exportedWalkSignature(asset){
 const names=['floor-1 · floor-concrete','floor-2-slab · floor-concrete','stairs · floor-concrete'];
 const records=asset.triangles.filter(t=>t.normal.y>.5&&names.some(n=>t.name.startsWith(n)))
  .map(t=>t.points.map(p=>p.toArray().map(n=>n.toFixed(6)).join(',')).sort().join('|')).sort();
 return createHash('sha256').update(records.join('\n')).digest('hex');
}
assert.equal(exportedWalkSignature(desktop),exportedWalkSignature(mobile),'Actual exported desktop and mobile support triangles must match');
checks.push('Actual exported desktop/mobile walk surfaces have identical canonical triangle positions');
for(const [key,asset]of Object.entries({desktop,mobile,physics})){assert.equal(asset.sha256,manifest.assets[key].sha256);checks.push(`${key} header, finite attributes, index bounds and manifest hash`);}
const ground=physics.triangles.filter(t=>t.name==='interior-ground'),walls=physics.triangles.filter(t=>t.name==='interior-walls'),ceilings=physics.triangles.filter(t=>t.name==='interior-ceilings');
assert.ok(ground.length&&walls.length&&ceilings.length);assert.ok(ground.every(t=>t.normal.y>.49),'All ground faces wind upward');checks.push('Three exact physics role batches; ground triangles face upward');
function support(x,z,ceiling=Infinity,triangles=ground){const ray=new Ray(new Vector3(x,30,z),new Vector3(0,-1,0)),hit=new Vector3(),ys=[];for(const t of triangles)if(ray.intersectTriangle(...t.points,false,hit)&&hit.y<=ceiling+1e-5)ys.push(hit.y);return ys.length?Math.max(...ys):null;}
function obstruction(a,b,triangles=walls){const p=new Vector3(...a),q=new Vector3(...b),delta=q.clone().sub(p),length=delta.length();if(length<1e-6)return null;const ray=new Ray(p,delta.divideScalar(length)),hit=new Vector3();for(const t of triangles)if(ray.intersectTriangle(...t.points,false,hit)&&hit.distanceTo(p)<length-1e-5)return{distance:hit.distanceTo(p),point:hit.toArray(),name:t.name};return null;}
const stairResults=[];
for(const [name,path]of Object.entries(manifest.stairWaypoints)){
 for(const direction of ['up','down']){
  const way=direction==='up'?path:[...path].reverse();let samples=0,maxRise=0;
  for(let i=0;i<way.length;i++){
   const p=way[i],y=support(p[0],p[2],p[1]+.34);assert.notEqual(y,null,`${name} ${direction} ground`);assert.ok(Math.abs(y-p[1])<.025,`${name} ${direction} support ${i}: ${y} vs ${p[1]}`);
   if(!i)continue;const a=way[i-1],distance=Math.hypot(p[0]-a[0],p[2]-a[2]),n=Math.max(1,Math.ceil(distance/.10));let prior=a[1];
   for(let j=1;j<=n;j++){const t=j/n,x=a[0]+(p[0]-a[0])*t,z=a[2]+(p[2]-a[2])*t,expected=a[1]+(p[1]-a[1])*t,h=support(x,z,Math.max(a[1],p[1])+.34);assert.notEqual(h,null,`${name} support gap`);assert.ok(Math.abs(h-expected)<.34,`${name} surface discontinuity`);maxRise=Math.max(maxRise,Math.abs(h-prior));prior=h;samples++;}
   for(const h of [.52,1.05])assert.equal(obstruction([a[0],a[1]+h,a[2]],[p[0],p[1]+h,p[2]]),null,`${name} ${direction} torso obstruction at ${i}`);
  }
  assert.ok(maxRise<.20,`${name} max step ${maxRise}`);stairResults.push({name,direction,samples,maxRise});
 }
}
checks.push('Both actual exported stairs sampled in both directions at <=10cm; rise <20cm and no torso-wall crossings');
for(const [name,p]of Object.entries({...manifest.anchors,entrySpawn:manifest.entrySpawn})){const y=support(p[0],p[2],p[1]+.34);assert.notEqual(y,null,name);assert.ok(Math.abs(y-p[1])<.025,`${name} supports documented height`);}
checks.push('Spawn and all public anchors have correct support');
assert.equal(support(-10,17,1),null,'Removed preview floor must not remain outside exterior union');
for(const x of [20,23,25]){
 const hit=obstruction([x,.9,11.35],[x,.9,12.45]);assert.ok(hit,`Grand concrete north side blocks at x=${x}`);
 assert.ok(hit.distance>.5&&hit.distance<.7,`Grand actual side-wall location at x=${x}`);
 assert.equal(support(x,12.1,.34),null,`No hidden first-floor support inside grand solid x=${x}`);
}
assert.equal(support(29.5,16,.34),null,'Lowest seating terrace must not expose buried first-floor support');
checks.push('Grand concrete has actual side walls and no buried first-floor fallback, including low seating terrace');
assert.equal(support(0,3,.34),0,'First-floor selection stays below second-floor slab');
assert.ok(obstruction([41,6.3,13],[30,6.3,13]),'Grand stair east void guard blocks falling approach');
assert.ok(obstruction([27,6.3,11.35],[27,6.3,12.2]),'Grand north edge guarded outside butterfly opening');
assert.equal(obstruction([24,6.3,11.4],[27.8,6.3,11.4]),null,'Butterfly landing exit remains open');
checks.push('Removed exterior overflow, floor selection and second-floor void protection');
for(const d of manifest.doors){const x=d.center[0];assert.equal(support(x,18.8,.34),0);assert.equal(obstruction([x,1,18.6],[x,1,19.12]),null,'Visual door remains passable to inner threshold');assert.ok(obstruction([x,1,18.6],[x,1,19.5]),'Exit gate prevents stepping beyond the floor');}
checks.push('Both aligned door holes are open, with safety gate behind threshold');
const ceilingHits=support(-15,7,20,ceilings);assert.ok(ceilingHits>5,'Camera has independent overhead surfaces');
const report={status:'passed',checkedAt:new Date().toISOString(),checks,stairResults,assets:Object.fromEntries(Object.entries({desktop,mobile,physics}).map(([k,v])=>[k,{bytes:v.bytes,sha256:v.sha256,triangles:v.triangles.length}])),limitation:'Asset geometry and low-poly proxies only; runtime controller/input/lifecycle require separate integration testing.'};
await writeFile(new URL('verification.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
