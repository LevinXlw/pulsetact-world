// Derived preview LOD indices. The original vertex data and LOD0 indices remain intact.
import fs from 'node:fs/promises';
import path from 'node:path';
import { MeshoptSimplifier } from 'meshoptimizer';
await MeshoptSimplifier.ready;
const root = path.resolve('assets-source/nyc-local/manhattan');
const index = JSON.parse(await fs.readFile(path.join(root,'index.json'),'utf8'));
let original = 0, simplified = 0, changed = 0;
for (const model of Object.values(index.models)) {
  const file = path.join(root,model.streamFile), raw = await fs.readFile(file);
  const jsonLength = raw.readUInt32LE(12), doc = JSON.parse(raw.subarray(20,20+jsonLength));
  const binary = raw.subarray(28+jsonLength), chunks = [binary];
  let byteLength = binary.length, modelFarTriangles = 0;
  function accessor(id) {
    const a = doc.accessors[id], v = doc.bufferViews[a.bufferView];
    const width = a.type === 'VEC3' ? 3 : 1, stride = v.byteStride ?? width*({5123:2,5125:4,5126:4}[a.componentType]);
    const values = a.componentType === 5126 ? new Float32Array(a.count*width) : new Uint32Array(a.count*width);
    const read = a.componentType === 5126 ? 'readFloatLE' : a.componentType === 5123 ? 'readUInt16LE' : 'readUInt32LE';
    const size = a.componentType === 5123 ? 2 : 4;
    for (let i=0;i<a.count;i++) for(let j=0;j<width;j++) values[i*width+j]=binary[read]((v.byteOffset??0)+(a.byteOffset??0)+i*stride+j*size);
    return values;
  }
  for (const mesh of doc.meshes) {
    if (mesh.primitives.length !== 1) throw new Error('Expected one original primitive per recovered mesh');
    const primitive = mesh.primitives[0], indices = accessor(primitive.indices);
    original += indices.length/3;
    if (mesh.extras?.farIndicesAccessor !== undefined) {
      const count = doc.accessors[mesh.extras.farIndicesAccessor].count/3;
      simplified += count; modelFarTriangles += count; continue;
    }
    if (indices.length < 36) { simplified += indices.length/3; modelFarTriangles += indices.length/3; continue; }
    const positions = accessor(primitive.attributes.POSITION);
    const [low,error] = MeshoptSimplifier.simplify(indices,positions,3,Math.max(12,Math.floor(indices.length*.2/3)*3),.008,['LockBorder']);
    const useful = low.length < indices.length*.8;
    simplified += (useful ? low.length : indices.length)/3; modelFarTriangles += (useful ? low.length : indices.length)/3;
    if (!useful) continue;
    const data = Buffer.from(low.buffer,low.byteOffset,low.byteLength), view = doc.bufferViews.length;
    doc.bufferViews.push({buffer:0,byteOffset:byteLength,byteLength:data.length,target:34963});
    const a = doc.accessors.length; doc.accessors.push({bufferView:view,componentType:5125,count:low.length,type:'SCALAR'});
    mesh.extras = {...mesh.extras,farIndicesAccessor:a,farRelativeError:error};
    chunks.push(data); byteLength += data.length; changed++;
  }
  doc.buffers[0].byteLength = byteLength;
  let json = Buffer.from(JSON.stringify(doc)); json = Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]);
  const header = Buffer.alloc(20), binHeader = Buffer.alloc(8);
  [0x46546c67,2,28+json.length+byteLength,json.length,0x4e4f534a].forEach((v,i)=>header.writeUInt32LE(v,i*4));
  binHeader.writeUInt32LE(byteLength); binHeader.writeUInt32LE(0x004e4942,4);
  const output = Buffer.concat([header,json,binHeader,...chunks]); await fs.writeFile(file,output);
  model.streamBytes = output.length; model.farTriangles = modelFarTriangles;
  const reportFile = path.join(root,'models',`${model.id}.json`), report = JSON.parse(await fs.readFile(reportFile,'utf8'));
  report.streamBytes=output.length; report.farTriangles=modelFarTriangles; report.previewLodVersion=1;
  await fs.writeFile(reportFile,JSON.stringify(report));
}
index.geometryBytes=Object.values(index.models).reduce((s,m)=>s+m.streamBytes,0);
index.previewLod = {version:1,relativeError:.008,lockedBorders:true,originalTriangles:original,farTriangles:simplified};
await fs.writeFile(path.join(root,'index.json'),JSON.stringify(index));
console.log(JSON.stringify({...index.previewLod,changedPrimitives:changed},null,2));
