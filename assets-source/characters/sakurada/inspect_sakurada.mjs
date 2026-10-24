import fs from 'node:fs';
import crypto from 'node:crypto';
const [input, output] = process.argv.slice(2);
const bytes=fs.readFileSync(input), length=bytes.readUInt32LE(12);
if(bytes.readUInt32LE(8)!==bytes.length)throw new Error('Truncated model');
const gltf=JSON.parse(bytes.subarray(20,20+length));
const binary=bytes.subarray(28+length);
const primitives=gltf.meshes.flatMap(m=>m.primitives);
let triangles=0;
for(const p of primitives){if((p.mode??4)!==4)throw new Error('Non-triangle mesh');triangles+=gltf.accessors[p.indices].count/3;}
const images=gltf.images.map(image=>{const view=gltf.bufferViews[image.bufferView];const b=binary.subarray(view.byteOffset??0,(view.byteOffset??0)+view.byteLength);return {name:image.name,bytes:b.length,width:b.readUInt32BE(16),height:b.readUInt32BE(20)};});
const report={file:input,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),meta:gltf.extensions?.VRM?.meta,triangles,primitives:primitives.length,materials:gltf.materials.length,nodes:gltf.nodes.length,skins:gltf.skins.map(s=>({joints:s.joints.length})),meshes:gltf.meshes.map(m=>({name:m.name,primitives:m.primitives.length,morphTargets:Math.max(...m.primitives.map(p=>p.targets?.length??0))})),images,animations:gltf.animations?.map(a=>({name:a.name,channels:a.channels.length})),expressionPresets:gltf.extensions?.VRM?.blendShapeMaster?.blendShapeGroups?.map(g=>g.presetName)};
if(output)fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,images:report.images.map(i=>({name:i.name,size:`${i.width}x${i.height}`}))},null,2));
