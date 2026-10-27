import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// Exact source components omitted by the historic mobile shell. This is an
// indexed/normal-packed extraction, not a claim of a decimated geometric LOD.
const sourcePath='public/data/killian/detail.glb',output='public/data/killian/mobile-portico.glb';
const names=['columnStone','columnTrim','windowInterior','windowFrame','interiorShade','entranceDoor','doorGlass','entrancePanel','entranceFrame','doorHardware','stepNosing','lettering'];
const selected=new Set(names),bytes=await readFile(sourcePath),jsonLength=bytes.readUInt32LE(12);
const source=JSON.parse(bytes.toString('utf8',20,20+jsonLength)),binary=bytes.subarray(28+jsonLength);
const chunks=[],bufferViews=[],accessors=[],materials=[],meshes=[],nodes=[],components=[];
let length=0;
const hash=value=>createHash('sha256').update(value).digest('hex');
function values(id){
  const a=source.accessors[id],v=source.bufferViews[a.bufferView],size={SCALAR:1,VEC3:3}[a.type];
  const ArrayType={5126:Float32Array,5123:Uint16Array,5125:Uint32Array}[a.componentType];
  if(!ArrayType)throw Error('Unexpected source attribute component');
  if(!size||(v.byteStride&&v.byteStride!==size*ArrayType.BYTES_PER_ELEMENT))throw Error('Unexpected source attribute layout');
  return new ArrayType(binary.buffer,binary.byteOffset+(v.byteOffset||0)+(a.byteOffset||0),a.count*size);
}
function append(array,target,extra={}){
  const pad=(4-length%4)%4;if(pad){chunks.push(Buffer.alloc(pad));length+=pad;}
  const index=bufferViews.length,data=Buffer.from(array.buffer,array.byteOffset,array.byteLength);
  bufferViews.push({buffer:0,byteOffset:length,byteLength:data.length,target,...extra});chunks.push(data);length+=data.length;return index;
}
for(const mesh of source.meshes)for(const primitive of mesh.primitives){
  const original=source.materials[primitive.material],name=original.name;if(!selected.has(name))continue;
  const positions=values(primitive.attributes.POSITION),normals=values(primitive.attributes.NORMAL);
  const order=primitive.indices===undefined?null:values(primitive.indices);
  const count=order?.length??positions.length/3,index=[],points=[],packed=[],cache=new Map();
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<count;i++){
    const offset=(order?order[i]:i)*3,p=[positions[offset],positions[offset+1],positions[offset+2]];
    const n=[0,1,2].map(k=>Math.round(Math.max(-1,Math.min(1,normals[offset+k]))*127));
    if(!p.every(Number.isFinite))throw Error(`Nonfinite source: ${name}`);
    const key=[...p,...n].join(',');let at=cache.get(key);
    if(at===undefined){at=points.length/3;cache.set(key,at);points.push(...p);packed.push(...n,0);for(let k=0;k<3;k++){min[k]=Math.min(min[k],p[k]);max[k]=Math.max(max[k],p[k]);}}
    index.push(at);
  }
  const vertexCount=points.length/3,wide=vertexCount>65535;
  const positionId=accessors.length;
  accessors.push({bufferView:append(new Float32Array(points),34962),componentType:5126,count:vertexCount,type:'VEC3',min,max});
  const normalId=accessors.length;
  accessors.push({bufferView:append(new Int8Array(packed),34962,{byteStride:4}),componentType:5120,normalized:true,count:vertexCount,type:'VEC3'});
  const indexId=accessors.length;
  accessors.push({bufferView:append(wide?new Uint32Array(index):new Uint16Array(index),34963),componentType:wide?5125:5123,count:index.length,type:'SCALAR'});
  const materialId=materials.length,factor=original.pbrMetallicRoughness?.baseColorFactor??[.65,.68,.55,1];
  materials.push({name,doubleSided:true,pbrMetallicRoughness:{baseColorFactor:[...factor.slice(0,3),1],metallicFactor:0,roughnessFactor:1}});
  meshes.push({name,primitives:[{attributes:{POSITION:positionId,NORMAL:normalId},indices:indexId,material:materialId}]});
  nodes.push({name:`MIT retained portico · ${name}`,mesh:meshes.length-1,extras:{mobileGround:false,mobileWall:['columnStone','entranceDoor','entrancePanel'].includes(name),mobileHidden:false}});
  components.push({name,vertices:vertexCount,triangles:index.length/3,min,max});
}
for(const name of names)if(!components.some(c=>c.name===name))throw Error(`Missing source component ${name}`);
const bin=Buffer.concat(chunks),doc={asset:{version:'2.0',generator:'Pulsetact retained MIT portico, source v8'},extensionsUsed:['KHR_mesh_quantization'],extensionsRequired:['KHR_mesh_quantization'],buffers:[{byteLength:bin.length}],bufferViews,accessors,materials,meshes,nodes,scenes:[{name:'MIT retained mobile portico',nodes:nodes.map((_,i)=>i)}],scene:0};
const raw=Buffer.from(JSON.stringify(doc)),json=Buffer.concat([raw,Buffer.alloc((4-raw.length%4)%4,32)]),padded=Buffer.concat([bin,Buffer.alloc((4-bin.length%4)%4)]);
const result=Buffer.alloc(28+json.length+padded.length);
result.writeUInt32LE(0x46546c67,0);result.writeUInt32LE(2,4);result.writeUInt32LE(result.length,8);
result.writeUInt32LE(json.length,12);result.writeUInt32LE(0x4e4f534a,16);json.copy(result,20);
result.writeUInt32LE(padded.length,20+json.length);result.writeUInt32LE(0x004e4942,24+json.length);padded.copy(result,28+json.length);
await writeFile(output,result);
const manifest={version:1,source:sourcePath,sourceSha256:hash(bytes),output,sha256:hash(result),bytes:result.length,triangles:components.reduce((s,c)=>s+c.triangles,0),vertices:components.reduce((s,c)=>s+c.vertices,0),meshes:meshes.length,textures:0,components,processing:'Lossless source positions and original triangles; deduplicated vertices and normalized signed-byte normals. No decimation or layout change.',scope:'Only the Building 10 columns, column bases/capitals, window frames/backings, door leaves/frames/hardware, step nosings and inscriptions omitted by the existing mobile shell.',collision:'columnStone, entranceDoor and entrancePanel join the mobile wall query; all walking ground remains the existing baked ground.',sourceGeometryBasis:'Original measured campus frame plus photo-informed portico-study.json; not a new survey.'};
await writeFile('public/data/killian/mobile-portico.json',JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({output,bytes:manifest.bytes,triangles:manifest.triangles,vertices:manifest.vertices,meshes:manifest.meshes,sha256:manifest.sha256}));
