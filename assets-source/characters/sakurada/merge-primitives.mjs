// Consolidate only primitives whose attributes, morph targets, material and mode
// are identical. Original vertex/morph/skin buffers remain byte-identical.
import fs from 'node:fs';
import crypto from 'node:crypto';
const [input, output] = process.argv.slice(2);
const original = fs.readFileSync(input);
const jsonSize = original.readUInt32LE(12);
const doc = JSON.parse(original.subarray(20, 20 + jsonSize));
let bin = original.subarray(28 + jsonSize);
const originalBin = bin;
const changes = [];
// The downloaded legacy UniVRM fallback predates the v0.54 linear-factor fix:
// https://vrm.dev/en/release/055/v0.54.0/
// VRM 0 _Color values are sRGB; glTF baseColorFactor RGB must be linear.
// The independent CC0 mirror has the same MToon colors and these corrected factors.
const toLinear = v => v <= 0.04045 ? v / 12.92 : Math.pow((v+0.055)/1.055,2.4);
for (let i=0;i<doc.materials.length;i++) {
  const color=doc.extensions?.VRM?.materialProperties?.[i]?.vectorProperties?._Color;
  if(color) doc.materials[i].pbrMetallicRoughness.baseColorFactor=[...color.slice(0,3).map(toLinear),color[3]];
}
for (const mesh of doc.meshes) {
  const groups = new Map();
  for (const primitive of mesh.primitives) {
    const key = JSON.stringify({ ...primitive, indices: undefined });
    const group = groups.get(key) ?? [];
    group.push(primitive);
    groups.set(key, group);
  }
  const merged = [];
  for (const group of groups.values()) {
    if (group.length === 1) { merged.push(group[0]); continue; }
    const values = [];
    for (const p of group) {
      const a = doc.accessors[p.indices];
      if (a.type !== 'SCALAR' || a.sparse) throw new Error('Unsupported indices');
      const view = doc.bufferViews[a.bufferView];
      const bytes = ({5121:1, 5123:2, 5125:4})[a.componentType];
      if (!bytes) throw new Error('Unsupported index type');
      const start = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
      for (let i=0;i<a.count;i++) values.push(bin.readUIntLE(start+i*(view.byteStride??bytes),bytes));
    }
    const max = Math.max(...values);
    const size = max > 65535 ? 4 : 2;
    const payload = Buffer.alloc(values.length * size);
    values.forEach((v,i)=>payload.writeUIntLE(v,i*size,size));
    const padding = Buffer.alloc((4 - bin.length % 4) % 4);
    const view = doc.bufferViews.length;
    doc.bufferViews.push({buffer:0,byteOffset:bin.length+padding.length,byteLength:payload.length,target:34963});
    const accessor = doc.accessors.length;
    doc.accessors.push({bufferView:view,componentType:size===4?5125:5123,count:values.length,type:'SCALAR',min:[Math.min(...values)],max:[max]});
    bin = Buffer.concat([bin,padding,payload]);
    merged.push({...group[0],indices:accessor});
  }
  changes.push({mesh:mesh.name,before:mesh.primitives.length,after:merged.length});
  mesh.primitives = merged;
  // This legacy UniVRM sample stores black/transparent COLOR_0 attributes.
  // Its MToon shader ignores vertex color; standard glTF multiplies them into
  // albedo and alpha, hiding the body. Remove the unused legacy color semantic
  // while retaining its source bytes and using the original albedo textures.
  for (const primitive of mesh.primitives) delete primitive.attributes.COLOR_0;
}
if (!bin.subarray(0,originalBin.length).equals(originalBin)) throw new Error('Original buffers changed');
doc.buffers[0].byteLength = bin.length;
doc.asset.extras ??= {};
doc.asset.extras.primitiveConsolidation = {sourceSha256:crypto.createHash('sha256').update(original).digest('hex'),changes,originalBinaryPrefixByteIdentical:true,removedLegacyUnusedVertexColor:true,convertedLegacySrgbFactorsToGltfLinear:true};
let json = Buffer.from(JSON.stringify(doc));
json = Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]);
bin = Buffer.concat([bin,Buffer.alloc((4-bin.length%4)%4)]);
const header=Buffer.alloc(20);header.write('glTF');header.writeUInt32LE(2,4);header.writeUInt32LE(28+json.length+bin.length,8);header.writeUInt32LE(json.length,12);header.writeUInt32LE(0x4e4f534a,16);
const binHeader=Buffer.alloc(8);binHeader.writeUInt32LE(bin.length);binHeader.writeUInt32LE(0x004e4942,4);
fs.writeFileSync(output,Buffer.concat([header,json,binHeader,bin]));
console.log(JSON.stringify({changes,bytes:fs.statSync(output).size}));
