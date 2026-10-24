import {readFile,writeFile,mkdir} from 'node:fs/promises';

// Keep the surveyed MIT triangles without uploading/decoding aerial photography,
// and keep only the architectural shell / walking surfaces from the detail file.
// This is deliberately a build-time operation: phones never parse the 56 MB file.
const selected=new Set(['porticoWall','porticoGlass','porticoStone','porticoTrim','courtyardWall','courtyardGlass','courtyardPlinth','steps','porticoFloor','stone','grass','pavement','arterial','road']);
const chunks=[],views=[],accessors=[],materials=[],meshes=[],nodes=[];
let length=0;
for(const [file,keep] of [['public/data/campuses/mit/campus.glb',null],['public/data/killian/detail.glb',selected]]){
  const bytes=await readFile(file),jsonLength=bytes.readUInt32LE(12),source=JSON.parse(bytes.subarray(20,20+jsonLength).toString());
  const bin=bytes.subarray(28+jsonLength);const accessorMap=new Map(),materialMap=new Map();
  const copyAccessor=id=>{
    if(accessorMap.has(id))return accessorMap.get(id);
    const a=source.accessors[id],v=source.bufferViews[a.bufferView],data=bin.subarray(v.byteOffset??0,(v.byteOffset??0)+v.byteLength);
    const pad=(4-length%4)%4;if(pad){chunks.push(Buffer.alloc(pad));length+=pad;}
    const vi=views.length;views.push({...v,buffer:0,byteOffset:length});chunks.push(data);length+=data.length;
    const ai=accessors.length;accessors.push({...a,bufferView:vi});accessorMap.set(id,ai);return ai;
  };
  for(const sourceMesh of source.meshes)for(const primitive of sourceMesh.primitives){
    const original=source.materials[primitive.material],name=original.name;
    if(keep&&!keep.has(name))continue;
    let mat=materialMap.get(primitive.material);
    if(mat===undefined){mat=materials.length;materials.push({name,doubleSided:true,pbrMetallicRoughness:{baseColorFactor:[.65,.68,.55,1],metallicFactor:0,roughnessFactor:1}});materialMap.set(primitive.material,mat);}
    const attrs={POSITION:copyAccessor(primitive.attributes.POSITION)};
    if(primitive.attributes.NORMAL!==undefined)attrs.NORMAL=copyAccessor(primitive.attributes.NORMAL);
    const p={attributes:attrs,material:mat};if(primitive.indices!==undefined)p.indices=copyAccessor(primitive.indices);
    meshes.push({name,primitives:[p]});nodes.push({name,mesh:meshes.length-1});
  }
}
const binary=Buffer.concat(chunks),doc={asset:{version:'2.0',generator:'Pulsetact mobile MIT shell'},buffers:[{byteLength:binary.length}],bufferViews:views,accessors,materials,meshes,nodes,scenes:[{nodes:nodes.map((_,i)=>i)}],scene:0};
const raw=Buffer.from(JSON.stringify(doc)),json=Buffer.concat([raw,Buffer.alloc((4-raw.length%4)%4,32)]),bin=Buffer.concat([binary,Buffer.alloc((4-binary.length%4)%4)]);
const result=Buffer.alloc(28+json.length+bin.length);result.writeUInt32LE(0x46546c67,0);result.writeUInt32LE(2,4);result.writeUInt32LE(result.length,8);result.writeUInt32LE(json.length,12);result.writeUInt32LE(0x4e4f534a,16);json.copy(result,20);result.writeUInt32LE(bin.length,20+json.length);result.writeUInt32LE(0x004e4942,24+json.length);bin.copy(result,28+json.length);
await mkdir('assets-source/mobile',{recursive:true});await writeFile('assets-source/mobile/mit-base.glb',result);
const originalManifest=JSON.parse(await readFile('public/data/killian/detail-manifest.json','utf8'));
const {porticoOpening,courtyardFacades,dome,trees}=originalManifest;
await writeFile('assets-source/mobile/mit-detail.json',JSON.stringify({porticoOpening,courtyardFacades,dome,trees}));
console.log(JSON.stringify({bytes:result.length,meshes:meshes.length,triangles:meshes.reduce((sum,m)=>sum+accessors[m.primitives[0].indices??m.primitives[0].attributes.POSITION].count/3,0),textures:0}));
