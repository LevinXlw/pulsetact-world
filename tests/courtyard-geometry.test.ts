import {readFileSync} from 'node:fs';
import {beforeAll, expect, it} from 'vitest';
import {Group, Mesh, Raycaster, Vector3} from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {isPorticoTriangle, type PorticoOpening} from '../src/features/real-campus/portico';

type CourtyardFacade = PorticoOpening & {
  sourceFacadeIndex: number;
  model: string;
  wall: {front: number; thickness: number};
  glassDepth: number;
  openings: {id: string; x: number; w: number; bottom: number; top: number}[];
};
const manifest = JSON.parse(readFileSync('public/data/killian/detail-manifest.json', 'utf8'));
const facades: CourtyardFacade[] = manifest.courtyardFacades;
let scene: Group;

beforeAll(async () => {
  const bytes = readFileSync('public/data/killian/detail.glb');
  scene = (await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, '')).scene;
  scene.updateMatrixWorld(true);
});

function point(f: PorticoOpening, x: number, y: number, depth: number) {
  const c = f.center, n = f.normal;
  return new Vector3(c[0] + n[2] * x + n[0] * depth, y, c[2] - n[0] * x + n[2] * depth);
}
function meshes(name: string) {
  const result: Mesh[] = [];
  scene.traverse(o => {if (o instanceof Mesh && !Array.isArray(o.material) && o.material.name === name) result.push(o);});
  return result;
}

it('replaces precisely six surveyed court-facing planes and preserves their original anchors', () => {
  const source = JSON.parse(readFileSync('public/data/killian/facades.json', 'utf8'));
  expect(facades).toHaveLength(6);
  expect(facades.map(f => f.sourceFacadeIndex)).toEqual([9, 10, 14, 17, 18, 20]);
  for (const f of facades) {
    const original = source.facades[f.sourceFacadeIndex];
    // JSON normalizes the GIS source's signed zero when writing the manifest.
    for (const key of ['center', 'normal', 'width', 'bottom', 'top', 'model'] as const) expect(JSON.stringify(f[key])).toBe(JSON.stringify(original[key]));
  }
  const bytes = readFileSync('public/data/campuses/mit/campus.glb'), length = bytes.readUInt32LE(12);
  const doc = JSON.parse(bytes.toString('utf8', 20, 20 + length));
  const accessor = doc.accessors[doc.meshes[0].primitives[0].attributes.POSITION], view = doc.bufferViews[accessor.bufferView];
  const start = 28 + length + view.byteOffset;
  const positions = new Float32Array(bytes.buffer.slice(bytes.byteOffset + start, bytes.byteOffset + start + view.byteLength));
  const removed = facades.map(() => 0);
  for (let i = 0; i < positions.length; i += 9) {
    const triangle = [0, 3, 6].map(offset => Array.from(positions.slice(i + offset, i + offset + 3)));
    facades.forEach((f, index) => {if (isPorticoTriangle(triangle, f)) removed[index]++;});
  }
  expect(removed).toEqual([2, 2, 2, 2, 2, 2]);
});

it('has actual open wall apertures, solid stone reveals and separately recessed glass and backing', () => {
  const walls = meshes('courtyardWall'), glassMeshes = meshes('courtyardGlass'), backs = meshes('courtyardInterior');
  expect(walls.length).toBeGreaterThan(0);
  for (const f of facades) {
    const ray = new Raycaster(undefined, new Vector3(-f.normal[0], 0, -f.normal[2]), 0, 1.8);
    for (const opening of f.openings) {
      const y = (opening.bottom + opening.top) / 2;
      ray.ray.origin.copy(point(f, opening.x + .11, y + .07, f.wall.front + .12));
      expect(ray.intersectObjects(walls, false), opening.id + ' wall must be open').toHaveLength(0);
      const glass = ray.intersectObjects(glassMeshes, false)[0], back = ray.intersectObjects(backs, false)[0];
      expect(glass, opening.id + ' missing glass').toBeDefined();
      expect(back, opening.id + ' missing cavity backing').toBeDefined();
      expect(glass.distance).toBeGreaterThan(.40);
      expect(back.distance - glass.distance).toBeGreaterThan(.5);
      ray.ray.origin.copy(point(f, opening.x + opening.w / 2 + .08, y, f.wall.front + .12));
      expect(ray.intersectObjects(walls, false).length, opening.id + ' missing solid reveal').toBeGreaterThan(0);
    }
  }
});

it('grounds the stone edging beside the paving and keeps the central walking route clear', () => {
  const curb = meshes('courtCurb'), paving = meshes('pavement'), f = manifest.porticoOpening;
  const ray = new Raycaster(undefined, new Vector3(0, -1, 0), 0, 50);
  for (const side of [-1, 1]) {
    ray.ray.origin.copy(point(f, side * 46.10, 30, 40.5));
    const stone = ray.intersectObjects(curb, false)[0], path = ray.intersectObjects(paving, false)[0];
    expect(stone).toBeDefined();
    expect(path).toBeDefined();
    expect(stone.point.y - path.point.y).toBeGreaterThan(0);
    expect(stone.point.y - path.point.y).toBeLessThan(.10);
  }
  for (const s of [102, 110, 119, 136, 145]) {
    ray.ray.origin.copy(point(f, 0, 30, s));
    expect(ray.intersectObjects(curb, false)).toHaveLength(0);
    expect(ray.intersectObjects(paving, false).length).toBeGreaterThan(0);
  }
});

it('keeps every window aperture clear of the projecting stone strings and raised plinth', () => {
  const stone = [...meshes('courtyardTrim'), ...meshes('courtyardPlinth')];
  for (const f of facades) {
    // Start outside the deepest cornice, otherwise a ray born inside a trim
    // box can incorrectly pass a one-sided-face occlusion check.
    const ray = new Raycaster(undefined, new Vector3(-f.normal[0], 0, -f.normal[2]), 0, 1.7);
    for (const opening of f.openings) for (const fraction of [.12, .5, .85]) {
      const y = opening.bottom + (opening.top - opening.bottom) * fraction;
      ray.ray.origin.copy(point(f, opening.x + .16, y, .85));
      expect(ray.intersectObjects(stone, false), `${opening.id} at ${fraction} obstructed by a stone string`).toHaveLength(0);
    }
  }
});

it('keeps the sloped curbs continuously above the rendered paving at the approach and lawn perimeter', () => {
  const curb = meshes('courtCurb'), paving = meshes('pavement'), f = manifest.porticoOpening;
  const ray = new Raycaster(undefined, new Vector3(0, -1, 0), 0, 50);
  const segments = manifest.courtyardGround.segments as {from: number[]; to: number[]; width: number}[];
  for (const edge of segments) {
    const du = edge.to[0] - edge.from[0], ds = edge.to[1] - edge.from[1];
    const count = Math.ceil(Math.hypot(du, ds) / .4);
    // Sample stone centres, staying clear of the intentional 4 mm joints.
    for (let i = 0; i < count; i += 7) {
      const t = (i + .5) / count, u = edge.from[0] + du * t, s = edge.from[1] + ds * t;
      ray.ray.origin.copy(point(f, u, 30, s));
      const stone = ray.intersectObjects(curb, false)[0], path = ray.intersectObjects(paving, false)[0];
      expect(stone, `stone missing at ${u}, ${s}`).toBeDefined();
      expect(path, `paving missing at ${u}, ${s}`).toBeDefined();
      const upstand = stone.point.y - path.point.y;
      expect(upstand, `buried curb at ${u}, ${s}`).toBeGreaterThan(.004);
      expect(upstand, `floating curb at ${u}, ${s}`).toBeLessThan(.065);
    }
  }
});
