import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const root = process.argv[2] ?? 'assets-source/nyc-local/empire';
const modelDirectory = process.argv[3] ? `${process.argv[3]}/` : '';
const manifest = JSON.parse(await readFile(`${root}/manifest.json`, 'utf8'));
const out = { asset: { version: '2.0', generator: 'Pulsetact local kit packer' }, scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], accessors: [], bufferViews: [], buffers: [], images: [], textures: [], materials: [], samplers: [] };
const chunks = [], imageCache = new Map(), materialCache = new Map();
let offset = 0;
function append(bytes, properties = {}) {
  const pad = (4 - offset % 4) % 4;
  if (pad) { chunks.push(Buffer.alloc(pad)); offset += pad; }
  const index = out.bufferViews.length;
  out.bufferViews.push({ ...properties, buffer: 0, byteOffset: offset, byteLength: bytes.length });
  chunks.push(bytes); offset += bytes.length;
  return index;
}
for (const sample of manifest.samples) {
  const file = await readFile(`${root}/${modelDirectory}${sample.file}`);
  assert.equal(file.readUInt32LE(0), 0x46546c67);
  const length = file.readUInt32LE(12);
  const doc = JSON.parse(file.subarray(20, 20 + length).toString());
  const binary = file.subarray(28 + length);
  assert.equal(doc.buffers.length, 1);
  const viewMap = new Map(), accessorMap = new Map();
  function view(index) {
    if (viewMap.has(index)) return viewMap.get(index);
    const v = doc.bufferViews[index];
    const mapped = append(binary.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength), v);
    viewMap.set(index, mapped); return mapped;
  }
  function accessor(index) {
    if (accessorMap.has(index)) return accessorMap.get(index);
    const source = doc.accessors[index];
    assert.ok(!source.sparse);
    const mapped = out.accessors.length;
    out.accessors.push({ ...source, bufferView: view(source.bufferView) });
    accessorMap.set(index, mapped); return mapped;
  }
  const textureMap = (doc.textures ?? []).map(texture => {
    const source = doc.images[texture.source], v = doc.bufferViews[source.bufferView];
    const bytes = binary.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength);
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (imageCache.has(hash)) return imageCache.get(hash);
    const image = out.images.length;
    out.images.push({ ...source, bufferView: append(bytes) });
    const sampler = out.samplers.length;
    out.samplers.push(doc.samplers[texture.sampler]);
    const mapped = out.textures.length;
    out.textures.push({ ...texture, source: image, sampler });
    imageCache.set(hash, mapped); return mapped;
  });
  const materialMap = doc.materials.map(source => {
    const material = structuredClone(source);
    for (const owner of [material, material.pbrMetallicRoughness]) for (const key of Object.keys(owner ?? {})) {
      if (key.endsWith('Texture') && owner[key]) owner[key].index = textureMap[owner[key].index];
    }
    const key = JSON.stringify(material);
    if (materialCache.has(key)) return materialCache.get(key);
    const index = out.materials.length; out.materials.push(material); materialCache.set(key, index); return index;
  });
  const meshStart = out.meshes.length;
  for (const mesh of doc.meshes) out.meshes.push({ ...mesh, primitives: mesh.primitives.map(p => ({ ...p, attributes: Object.fromEntries(Object.entries(p.attributes).map(([key, index]) => [key, accessor(index)])), indices: accessor(p.indices), material: materialMap[p.material] })) });
  const parent = out.nodes.length;
  out.nodes.push({ name: sample.label, children: [], extras: { sourceAsset: sample.id } });
  out.scenes[0].nodes.push(parent);
  for (const index of doc.scenes[doc.scene ?? 0].nodes) {
    const node = doc.nodes[index]; assert.ok(!node.children?.length && node.skin === undefined);
    out.nodes[parent].children.push(out.nodes.length);
    out.nodes.push({ ...node, mesh: meshStart + node.mesh });
  }
}
const pad = (4 - offset % 4) % 4;
if (pad) { chunks.push(Buffer.alloc(pad)); offset += pad; }
out.buffers.push({ byteLength: offset });
let json = Buffer.from(JSON.stringify(out));
json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)]);
const header = Buffer.alloc(20); header.writeUInt32LE(0x46546c67); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + json.length + offset, 8); header.writeUInt32LE(json.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(offset); binHeader.writeUInt32LE(0x004e4942, 4);
const packed = Buffer.concat([header, json, binHeader, ...chunks]);
await writeFile(`${root}/empire-kit.glb`, packed);
manifest.library = { file: 'empire-kit.glb', bytes: packed.length, sourceBytes: manifest.samples.reduce((n, s) => n + s.bytes, 0), uniqueImages: out.images.length, materials: out.materials.length, models: manifest.samples.length };
await writeFile(`${root}/manifest.json`, JSON.stringify(manifest, null, 2));
console.log(manifest.library);
