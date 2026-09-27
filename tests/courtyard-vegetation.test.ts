import {readFileSync} from 'node:fs';
import {afterAll, expect, it, vi} from 'vitest';
import {BufferGeometry, Float32BufferAttribute, Group, InstancedMesh, LOD, Mesh, MeshStandardMaterial, Vector3} from 'three';
import {courtyardTreeAnchors, createCourtyardVegetation, type CourtyardVegetationManifest} from '../src/features/real-campus/courtyard-vegetation';

const manifest:CourtyardVegetationManifest = JSON.parse(readFileSync('public/data/killian/detail-manifest.json', 'utf8'));
function existingTreeAndLawnMeshes() {
  const bytes = readFileSync('public/data/killian/detail.glb');
  const jsonLength = bytes.readUInt32LE(12), binStart = 28 + jsonLength;
  const doc = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  const group = new Group();
  for (const mesh of doc.meshes) for (const primitive of mesh.primitives) {
    const name = doc.materials[primitive.material].name;
    if (!['bark', 'grass'].includes(name)) continue;
    const accessor = doc.accessors[primitive.attributes.POSITION], view = doc.bufferViews[accessor.bufferView];
    const start = bytes.byteOffset + binStart + (view.byteOffset || 0) + (accessor.byteOffset || 0);
    const positions = new Float32Array(bytes.buffer.slice(start, start + accessor.count * 12));
    const geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(positions, 3));
    group.add(new Mesh(geometry, new MeshStandardMaterial({name})));
  }
  return group;
}

const source = existingTreeAndLawnMeshes();
afterAll(() => { source.traverse(object => { if (object instanceof Mesh) {object.geometry.dispose(); (object.material as MeshStandardMaterial).dispose();} }); vi.unstubAllGlobals(); });

it('retains every original tree location and recovers finite terrain-aligned roots', () => {
  const anchors = courtyardTreeAnchors(source, manifest);
  expect(anchors).toHaveLength(manifest.trees.length);
  expect(anchors.filter(anchor => anchor.hero)).toHaveLength(10);
  anchors.forEach((anchor, i) => {
    expect([anchor.x, anchor.z]).toEqual([manifest.trees[i].x, manifest.trees[i].z]);
    expect(anchor.y).toBeGreaterThan(-1);
    expect(anchor.y).toBeLessThan(12);
    expect(anchor.height).toBeGreaterThanOrEqual(8);
    expect(anchor.height).toBeLessThanOrEqual(20);
  });
  expect(new Set(anchors.map(anchor => anchor.y.toFixed(3))).size).toBeGreaterThan(10);
});

it('keeps detailed vegetation out of collision and preserves layout when quality changes', () => {
  // Raster drawing is exercised in browser QA; this test validates actual
  // instanced geometry, source alignment, resource budget and runtime quality.
  const context = new Proxy({}, {get:(_, property) => property === 'createLinearGradient' ? () => ({addColorStop:() => {}}) : () => {}});
  vi.stubGlobal('document', {createElement:() => ({width:0, height:0, getContext:() => context})});
  const vegetation = createCourtyardVegetation({source, manifest});
  const stats = vegetation.userData.stats;
  expect(stats.trees).toBe(manifest.trees.length);
  expect(stats.leafCards).toBeLessThan(55000);
  expect(stats.grassClumps).toBeGreaterThan(100);
  expect(stats.grassClumps).toBeLessThan(400);
  expect(vegetation.userData.bounds.isEmpty()).toBe(false);
  const lods = vegetation.children.filter(child => child instanceof LOD);
  expect(lods).toHaveLength(manifest.trees.length);
  let proxyCount = 0;
  vegetation.traverse(object => {
    if (!(object instanceof Mesh)) return;
    if (object.userData.collision === 'wall') {expect(object.visible).toBe(false); proxyCount++;}
    else expect(object.userData.collision).toBe('none');
  });
  expect(proxyCount).toBe(manifest.trees.length);
  const positions = lods.map(lod => lod.position.toArray());
  const standardCards = stats.activeLeafCards;
  vegetation.userData.setQuality('low');
  expect(stats.activeLeafCards).toBeLessThan(standardCards * .6);
  expect(lods.map(lod => lod.position.toArray())).toEqual(positions);
  vegetation.userData.setQuality('standard');
  expect(stats.activeLeafCards).toBe(standardCards);
  const court = manifest.porticoOpening, normal = new Vector3(...court.normal as [number, number, number]);
  const tangent = new Vector3(normal.z, 0, -normal.x), origin = new Vector3(...court.center as [number, number, number]);
  for (const lod of lods.slice(0, 10)) {
    const canopy = lod.children[0] as InstancedMesh;
    canopy.computeBoundingBox();
    const bounds = canopy.boundingBox!;
    for (const x of [bounds.min.x, bounds.max.x]) for (const z of [bounds.min.z, bounds.max.z]) {
      const relative = new Vector3(x, 0, z).add(lod.position).sub(origin);
      // Main court wings start at approximately |u|=54m; preserve their facades.
      expect(Math.abs(relative.dot(tangent))).toBeLessThan(53);
      expect(relative.dot(normal)).toBeGreaterThan(5);
    }
  }
  const geometry = new Set<BufferGeometry>(), material = new Set<MeshStandardMaterial>();
  vegetation.traverse(object => { if (object instanceof Mesh) {geometry.add(object.geometry); material.add(object.material as MeshStandardMaterial); object.customDepthMaterial?.dispose();} });
  geometry.forEach(item => item.dispose()); material.forEach(item => {item.map?.dispose(); item.dispose();});
});
