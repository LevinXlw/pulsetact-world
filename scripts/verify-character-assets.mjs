import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Run with no arguments for the required pixiv avatar, or provide GLB paths to
// validate additional candidates. No browser, network or rendering is needed.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inputs = process.argv.slice(2);
const files = inputs.length ? inputs : ['public/assets/characters/pixiv/character.glb'];
const componentSizes = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4};
const typeSizes = {SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16};

function at(list, index, label) {
  assert(Number.isInteger(index) && index >= 0 && index < (list?.length ?? 0), `${label}: invalid index ${index}`);
  return list[index];
}

function parseGlb(bytes) {
  assert(bytes.length >= 20, 'GLB is too short');
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, 'GLB magic must be glTF');
  assert.equal(bytes.readUInt32LE(4), 2, 'Only GLB 2 is supported');
  assert.equal(bytes.readUInt32LE(8), bytes.length, 'GLB header byte length does not match file');
  const chunks = [];
  for (let offset = 12; offset < bytes.length;) {
    assert(offset + 8 <= bytes.length, 'Truncated GLB chunk header');
    const size = bytes.readUInt32LE(offset), type = bytes.readUInt32LE(offset + 4);
    assert.equal(size % 4, 0, 'GLB chunk must be aligned to four bytes');
    assert(offset + 8 + size <= bytes.length, 'Truncated GLB chunk body');
    chunks.push({type, bytes: bytes.subarray(offset + 8, offset + 8 + size)});
    offset += 8 + size;
  }
  assert.equal(chunks[0]?.type, 0x4e4f534a, 'First GLB chunk must be JSON');
  assert.equal(chunks.filter(chunk => chunk.type === 0x4e4f534a).length, 1, 'Duplicate JSON chunks');
  assert.equal(chunks.filter(chunk => chunk.type === 0x004e4942).length, 1, 'Expected one embedded BIN chunk');
  const json = JSON.parse(chunks[0].bytes.toString('utf8').trim());
  assert.equal(json.asset?.version, '2.0', 'Expected glTF 2.0');
  return {json, binary: chunks.find(chunk => chunk.type === 0x004e4942).bytes};
}

async function verify(file) {
  const absolute = path.resolve(root, file);
  const bytes = await readFile(absolute);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const {json: gltf, binary} = parseGlb(bytes);
  assert.equal(gltf.buffers?.length, 1, 'Expected one self-contained binary buffer');
  assert.equal(gltf.buffers[0].uri, undefined, 'External or data URI buffers are not expected in this GLB');
  const bufferSize = gltf.buffers[0].byteLength;
  assert(Number.isInteger(bufferSize) && bufferSize > 0, 'Invalid buffer size');
  assert(binary.length >= bufferSize && binary.length - bufferSize <= 3, 'Embedded buffer size does not match BIN chunk');

  for (const [index, view] of (gltf.bufferViews ?? []).entries()) {
    assert.equal(view.buffer, 0, `bufferView ${index}: missing embedded buffer`);
    assert(Number.isInteger(view.byteOffset ?? 0) && (view.byteOffset ?? 0) >= 0, `bufferView ${index}: invalid offset`);
    assert(Number.isInteger(view.byteLength) && view.byteLength > 0, `bufferView ${index}: invalid length`);
    assert((view.byteOffset ?? 0) + view.byteLength <= bufferSize, `bufferView ${index}: extends past buffer`);
  }

  function accessor(index) {
    const item = at(gltf.accessors, index, 'accessor');
    const view = item.bufferView === undefined ? null : at(gltf.bufferViews, item.bufferView, `accessor ${index} bufferView`);
    const size = componentSizes[item.componentType], width = typeSizes[item.type];
    assert(size && width, `accessor ${index}: unsupported component or shape`);
    // glTF pads small matrix columns to four bytes. This avatar uses float MAT4,
    // but account for padded matrices when checking any additional candidates.
    const columns = item.type.startsWith('MAT') ? Number(item.type.slice(3)) : 1;
    const columnBytes = (width / columns) * size;
    const packedSize = columns > 1 ? Math.ceil(columnBytes / 4) * 4 * columns : width * size;
    const stride = view?.byteStride ?? packedSize;
    assert(Number.isInteger(item.count) && item.count > 0, `accessor ${index}: invalid count`);
    assert(stride >= packedSize && stride % size === 0, `accessor ${index}: invalid stride`);
    const offset = item.byteOffset ?? 0;
    assert(Number.isInteger(offset) && offset >= 0 && offset % size === 0, `accessor ${index}: invalid offset`);
    if (view) assert(offset + (item.count - 1) * stride + packedSize <= view.byteLength, `accessor ${index}: extends past bufferView`);
    else assert.equal(offset, 0, `accessor ${index}: base offset without a bufferView`);
    let sparse;
    if (item.sparse) {
      const count = item.sparse.count;
      assert(Number.isInteger(count) && count > 0 && count <= item.count, `accessor ${index}: invalid sparse count`);
      const indices = item.sparse.indices, data = item.sparse.values;
      assert([5121, 5123, 5125].includes(indices.componentType), `accessor ${index}: invalid sparse index type`);
      const indexView = at(gltf.bufferViews, indices.bufferView, `accessor ${index} sparse indices`);
      const valueView = at(gltf.bufferViews, data.bufferView, `accessor ${index} sparse values`);
      const indexSize = componentSizes[indices.componentType];
      for (const [entry, entryView, entrySize] of [[indices, indexView, indexSize], [data, valueView, size]]) {
        assert(Number.isInteger(entry.byteOffset ?? 0) && (entry.byteOffset ?? 0) >= 0 && (entry.byteOffset ?? 0) % entrySize === 0, `accessor ${index}: invalid sparse offset`);
        assert.equal(entryView.byteStride, undefined, `accessor ${index}: sparse bufferViews cannot be interleaved`);
      }
      assert((indices.byteOffset ?? 0) + count * indexSize <= indexView.byteLength, `accessor ${index}: sparse indices exceed bufferView`);
      assert((data.byteOffset ?? 0) + count * packedSize <= valueView.byteLength, `accessor ${index}: sparse values exceed bufferView`);
      sparse = {count, indexSize, indexType: indices.componentType, indexOffset: (indexView.byteOffset ?? 0) + (indices.byteOffset ?? 0), valueOffset: (valueView.byteOffset ?? 0) + (data.byteOffset ?? 0)};
    }
    return {item, width, columns, packedSize, stride, offset: (view?.byteOffset ?? 0) + offset, size, hasBase: Boolean(view), sparse};
  }

  const valueCache = new Map();
  function values(index) {
    if (valueCache.has(index)) return valueCache.get(index);
    const entry = accessor(index);
    const methods = {5120: 'readInt8', 5121: 'readUInt8', 5122: 'readInt16LE', 5123: 'readUInt16LE', 5125: 'readUInt32LE', 5126: 'readFloatLE'};
    const output = new Array(entry.item.count * entry.width).fill(0);
    function assign(row, start) {
      for (let component = 0; component < entry.width; component++) {
        const columnHeight = entry.width / entry.columns;
        const componentOffset = entry.columns > 1 ? Math.floor(component / columnHeight) * (entry.packedSize / entry.columns) + (component % columnHeight) * entry.size : component * entry.size;
        const value = binary[methods[entry.item.componentType]](start + componentOffset);
        assert(Number.isFinite(value), `accessor ${index}: contains non-finite values`);
        output[row * entry.width + component] = value;
      }
    }
    if (entry.hasBase) for (let row = 0; row < entry.item.count; row++) assign(row, entry.offset + row * entry.stride);
    if (entry.sparse) {
      let previous = -1;
      const sparse = entry.sparse;
      for (let row = 0; row < sparse.count; row++) {
        const target = binary[methods[sparse.indexType]](sparse.indexOffset + row * sparse.indexSize);
        assert(target > previous && target < entry.item.count, `accessor ${index}: sparse indices must increase and stay within accessor`);
        assign(target, sparse.valueOffset + row * entry.packedSize);
        previous = target;
      }
    }
    valueCache.set(index, output);
    return output;
  }

  for (const index of (gltf.accessors ?? []).keys()) values(index);
  assert(gltf.images?.length > 0 && gltf.materials?.length > 0, 'Character must contain textures and materials');
  for (const [index, image] of gltf.images.entries()) {
    assert.equal(image.uri, undefined, `image ${index}: resource is not embedded`);
    const view = at(gltf.bufferViews, image.bufferView, `image ${index} bufferView`);
    assert(['image/png', 'image/jpeg', 'image/webp'].includes(image.mimeType), `image ${index}: unsupported image type`);
    const start = view.byteOffset ?? 0;
    if (image.mimeType === 'image/png') assert.equal(binary.subarray(start, start + 8).toString('hex'), '89504e470d0a1a0a', `image ${index}: invalid PNG signature`);
    if (image.mimeType === 'image/jpeg') assert.equal(binary.readUInt16BE(start), 0xffd8, `image ${index}: invalid JPEG signature`);
  }
  for (const [index, texture] of (gltf.textures ?? []).entries()) at(gltf.images, texture.source ?? texture.extensions?.EXT_texture_webp?.source, `texture ${index} image`);
  function checkTextureReferences(value, location) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key.endsWith('Texture') && child && typeof child === 'object') at(gltf.textures, child.index, `${location}.${key}`);
      checkTextureReferences(child, `${location}.${key}`);
    }
  }
  gltf.materials.forEach((material, index) => checkTextureReferences(material, `material ${index}`));

  assert(gltf.nodes?.length > 0 && gltf.meshes?.length > 0 && gltf.skins?.length > 0, 'Character is missing nodes, meshes or skeletons');
  const scene = at(gltf.scenes, gltf.scene ?? 0, 'default scene');
  assert(scene.nodes?.length, 'Default scene is empty');
  const reachable = new Set();
  function visit(index, ancestors = new Set()) {
    assert(!ancestors.has(index), `Node ${index}: scene hierarchy has a cycle`);
    const node = at(gltf.nodes, index, 'scene node');
    if (reachable.has(index)) return;
    reachable.add(index);
    const next = new Set(ancestors).add(index);
    for (const child of node.children ?? []) visit(child, next);
  }
  for (const index of scene.nodes) visit(index);
  const jointNodes = new Set();
  for (const [index, skin] of gltf.skins.entries()) {
    assert(skin.joints?.length > 0 && new Set(skin.joints).size === skin.joints.length, `skin ${index}: invalid joints`);
    for (const joint of skin.joints) {
      at(gltf.nodes, joint, `skin ${index} joint`);
      assert(reachable.has(joint), `skin ${index}: joint is outside active scene`);
      jointNodes.add(joint);
    }
    if (skin.inverseBindMatrices !== undefined) {
      const matrices = accessor(skin.inverseBindMatrices).item;
      assert(matrices.type === 'MAT4' && matrices.componentType === 5126 && matrices.count === skin.joints.length, `skin ${index}: inverse bind matrices do not match joints`);
      values(skin.inverseBindMatrices);
    }
  }

  let triangles = 0, skinnedMeshNodes = 0;
  for (const index of reachable) {
    const node = gltf.nodes[index];
    if (node.mesh === undefined) continue;
    const mesh = at(gltf.meshes, node.mesh, `node ${index} mesh`);
    const skin = node.skin === undefined ? null : at(gltf.skins, node.skin, `node ${index} skin`);
    if (skin) skinnedMeshNodes++;
    assert(mesh.primitives?.length > 0, `mesh ${node.mesh}: no primitives`);
    for (const primitive of mesh.primitives) {
      assert.equal(primitive.mode ?? 4, 4, `mesh ${node.mesh}: expected triangle primitives`);
      const position = accessor(primitive.attributes?.POSITION).item;
      assert(position.type === 'VEC3' && position.componentType === 5126, `mesh ${node.mesh}: invalid positions`);
      values(primitive.attributes.POSITION);
      for (const [attribute, index] of Object.entries(primitive.attributes)) assert.equal(accessor(index).item.count, position.count, `mesh ${node.mesh}: ${attribute} count differs from positions`);
      for (const target of primitive.targets ?? []) for (const [attribute, index] of Object.entries(target)) assert.equal(accessor(index).item.count, position.count, `mesh ${node.mesh}: morph ${attribute} count differs from positions`);
      const indices = primitive.indices === undefined ? null : values(primitive.indices);
      if (indices) assert(indices.every(value => Number.isInteger(value) && value >= 0 && value < position.count), `mesh ${node.mesh}: index exceeds vertex count`);
      const count = indices?.length ?? position.count;
      assert.equal(count % 3, 0, `mesh ${node.mesh}: incomplete triangle`);
      triangles += count / 3;
      if (primitive.material !== undefined) at(gltf.materials, primitive.material, `mesh ${node.mesh} material`);
      if (!skin) continue;
      const joints = accessor(primitive.attributes.JOINTS_0).item;
      const weights = accessor(primitive.attributes.WEIGHTS_0).item;
      assert(joints.type === 'VEC4' && joints.count === position.count, `mesh ${node.mesh}: joint attributes do not match positions`);
      assert(weights.type === 'VEC4' && weights.count === position.count, `mesh ${node.mesh}: weight attributes do not match positions`);
      assert(values(primitive.attributes.JOINTS_0).every(joint => Number.isInteger(joint) && joint >= 0 && joint < skin.joints.length), `mesh ${node.mesh}: invalid skin joint index`);
      const weightValues = values(primitive.attributes.WEIGHTS_0);
      const divisor = weights.normalized ? ({5121: 255, 5123: 65535}[weights.componentType] ?? 1) : 1;
      for (let vertex = 0; vertex < position.count; vertex++) {
        const group = weightValues.slice(vertex * 4, vertex * 4 + 4).map(value => value / divisor);
        assert(group.every(value => value >= 0) && Math.abs(group.reduce((sum, value) => sum + value, 0) - 1) < .025, `mesh ${node.mesh}: vertex ${vertex} has invalid skin weights`);
      }
    }
  }
  assert(skinnedMeshNodes > 0 && triangles > 0, 'Active scene has no renderable skinned character');

  const clips = [];
  for (const [index, animation] of (gltf.animations ?? []).entries()) {
    assert(animation.channels?.length > 0 && animation.samplers?.length > 0, `animation ${index}: empty`);
    let duration = 0, animatedJoints = 0;
    for (const channel of animation.channels) {
      const sampler = at(animation.samplers, channel.sampler, `animation ${index} sampler`);
      const input = accessor(sampler.input).item, output = accessor(sampler.output).item;
      assert(input.type === 'SCALAR' && input.componentType === 5126, `animation ${index}: invalid keyframe times`);
      const times = values(sampler.input);
      assert(times[0] >= 0 && times.every((time, frame) => frame === 0 || time > times[frame - 1]), `animation ${index}: keyframe times must increase`);
      values(sampler.output);
      const target = channel.target;
      at(gltf.nodes, target?.node, `animation ${index} target node`);
      assert(['translation', 'rotation', 'scale', 'weights'].includes(target.path), `animation ${index}: unsupported channel path`);
      if (target.path !== 'weights') {
        assert.equal(output.type, target.path === 'rotation' ? 'VEC4' : 'VEC3', `animation ${index}: incompatible channel values`);
        assert.equal(output.count, input.count * (sampler.interpolation === 'CUBICSPLINE' ? 3 : 1), `animation ${index}: keyframe value count mismatch`);
      }
      duration = Math.max(duration, times.at(-1));
      if (jointNodes.has(target.node)) animatedJoints++;
    }
    assert(duration > 0 && animatedJoints > 0, `animation ${index}: no duration or animated skeleton joints`);
    clips.push({name: animation.name ?? `(unnamed ${index})`, durationSeconds: Number(duration.toFixed(3)), skeletonChannels: animatedJoints});
  }

  const isPixiv = gltf.extensions?.VRMC_vrm?.meta?.name === 'VRM1_Constraint_Twist_Sample' || path.basename(path.dirname(absolute)) === 'pixiv';
  let source;
  try {source = JSON.parse(await readFile(path.join(path.dirname(absolute), 'SOURCE.json'), 'utf8'));}
  catch (error) {if (isPixiv || error.code !== 'ENOENT') throw error;}
  if (source?.sha256) assert.equal(sha256, source.sha256.toLowerCase(), 'Asset hash differs from recorded source');
  if (isPixiv) {
    const meta = gltf.extensions?.VRMC_vrm?.meta;
    assert(meta, 'pixiv: embedded VRM permission metadata is missing');
    const expected = {avatarPermission: 'everyone', commercialUsage: 'corporation', allowRedistribution: true, modification: 'allowModificationRedistribution', allowAntisocialOrHateUsage: false};
    for (const [key, value] of Object.entries(expected)) {
      assert.equal(meta[key], value, `pixiv: unexpected embedded permission ${key}`);
      assert.equal(source.permissions?.[key], value, `pixiv: SOURCE.json disagrees with embedded ${key}`);
    }
    assert(meta.authors?.includes('pixiv Inc.'), 'pixiv: unexpected model author');
    assert.equal(meta.licenseUrl, 'https://vrm.dev/licenses/1.0/', 'pixiv: unexpected model license');
    assert.equal(source.licenseUrl, meta.licenseUrl, 'pixiv: provenance license disagrees with model');
    for (const name of ['Idle', 'Walk', 'Run']) assert(clips.some(clip => clip.name === name), `pixiv: required ${name} clip is missing`);
    assert(source.sha256, 'pixiv: provenance is missing its asset hash');
    assert((await readFile(path.join(path.dirname(absolute), 'LICENSE-ANIMATIONS.txt'), 'utf8')).length > 0, 'pixiv: animation license file is empty');
  }
  return {file: path.relative(root, absolute).replaceAll('\\', '/'), bytes: bytes.length, triangles, skinnedMeshNodes, skins: gltf.skins.length, materials: gltf.materials.length, embeddedImages: gltf.images.length, clips, sha256, sourceHashVerified: Boolean(source?.sha256), embeddedPermissionsVerified: isPixiv};
}

let failed = false;
for (const file of files) {
  try {console.log(JSON.stringify({status: 'PASS', ...await verify(file)}, null, 2));}
  catch (error) {failed = true; console.error(JSON.stringify({status: 'FAIL', file, error: error.message}, null, 2));}
}
process.exitCode = failed ? 1 : 0;
