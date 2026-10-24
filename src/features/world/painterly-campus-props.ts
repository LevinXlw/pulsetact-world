import {BoxGeometry, BufferGeometry, Color, CylinderGeometry, Float32BufferAttribute, Group, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Quaternion, Vector3} from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {RoundedBoxGeometry} from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type {CampusCollision} from '../real-campus/campus-collision';

const ORIGIN = [12.904326162332634, -34.57887840848196] as const;
const U = [.9080005288124084, -.41896891593933105] as const;
const S = [.41896891593933105, .9080005288124084] as const;
const UP = new Vector3(0, 1, 0);

type BenchLocation = {
  id: string;
  local: readonly [number, number];
  position: readonly [number, number];
  yaw: number;
  source: 'existing' | 'illustrative';
};

function benchLocation(id: string, u: number, s: number, source: BenchLocation['source']): BenchLocation {
  const side = Math.sign(u);
  return {id, local:[u, s], position:[ORIGIN[0] + U[0] * u + S[0] * s, ORIGIN[1] + U[1] * u + S[1] * s],
    yaw:Math.atan2(-side * U[0], -side * U[1]), source};
}

export const BENCH_LOCATIONS: readonly BenchLocation[] = [
  // Retain the six original detail.glb seating anchors. The source itself calls
  // these illustrative placements; they are not a surveyed furniture inventory.
  ...[-1, 1].flatMap(side => [110, 121, 136].map(s =>
    benchLocation(`${side < 0 ? 'west' : 'east'}-court-${s}`, side * 98.65, s, 'existing'))),
  // Two modest new rest stops on the existing 8.2 m paved margins. These are
  // explicitly illustrative additions; lawn, routes and buildings are untouched.
  benchLocation('west-lawn-rest', -49, 75, 'illustrative'),
  benchLocation('east-lawn-rest', 49, 75, 'illustrative'),
];

type BatchName = 'wood' | 'frame' | 'fasteners' | 'bookCover' | 'bookPages';

/** Shared, low-draw-call campus furniture, grounded on the rendered paving. */
export function createPainterlyCampusProps(collision: Pick<CampusCollision, 'groundHeight'>) {
  const group = new Group();
  group.name = 'Campus courtyard seating';
  const colliders: Mesh[] = [];
  const batches = new Map<BatchName, BufferGeometry[]>();
  const rotation = new Quaternion(), matrix = new Matrix4(), color = new Color();
  const colliderGeometry = new BoxGeometry(1.98, 1.08, .77);
  const colliderMaterial = new MeshBasicMaterial();
  colliderGeometry.computeBoundingBox();

  const put = (kind: BatchName, geometry: BufferGeometry, transform: Matrix4, tone = 1) => {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (g !== geometry) geometry.dispose();
    if (kind === 'wood') {
      // Preserve each slat's metre coordinates before merging world transforms.
      // Grain therefore follows the timber, independent of the bench heading.
      const positions = g.getAttribute('position');
      const grain = new Float32Array(positions.count * 3), colors = new Float32Array(positions.count * 3);
      color.setRGB(tone, tone, tone);
      for (let i = 0; i < positions.count; i++) {
        grain[i * 3] = positions.getX(i); grain[i * 3 + 1] = positions.getY(i); grain[i * 3 + 2] = positions.getZ(i);
        colors.set([color.r, color.g, color.b], i * 3);
      }
      g.setAttribute('timberPoint', new Float32BufferAttribute(grain, 3));
      g.setAttribute('color', new Float32BufferAttribute(colors, 3));
    }
    g.applyMatrix4(transform);
    const list = batches.get(kind) ?? [];
    list.push(g); batches.set(kind, list);
  };

  BENCH_LOCATIONS.forEach((location, benchIndex) => {
    const [x, z] = location.position;
    const heading = new Quaternion().setFromAxisAngle(UP, location.yaw);
    const world = (lx: number, lz: number) => new Vector3(lx, 0, lz).applyQuaternion(heading).add(new Vector3(x, 0, z));
    const ground = collision.groundHeight(x, z) ?? 4;
    const footSamples = [-.76, .76].flatMap(lx => [-.23, .23].map(lz => {
      const p = world(lx, lz);
      return {lx, lz, y:collision.groundHeight(p.x, p.z) ?? ground};
    }));
    // The seat stays horizontal. Each of four legs ends at its own paving
    // height; using one centre height would leave feet visibly hovering here.
    const datum = footSamples.reduce((sum, foot) => sum + foot.y, 0) / footSamples.length;
    const benchTransform = new Matrix4().compose(new Vector3(x, datum, z), heading, new Vector3(1, 1, 1));
    const part = (kind: BatchName, px: number, py: number, pz: number, w: number, h: number, d: number,
      tilt = 0, tone = 1, yaw = 0) => {
      const geometry = new RoundedBoxGeometry(w, h, d, 1, Math.min(w, h, d) * .16);
      rotation.setFromAxisAngle(new Vector3(1, 0, 0), tilt);
      if (yaw) rotation.multiply(new Quaternion().setFromAxisAngle(UP, yaw));
      matrix.compose(new Vector3(px, py, pz), rotation, new Vector3(1, 1, 1));
      put(kind, geometry, new Matrix4().multiplyMatrices(benchTransform, matrix), tone);
    };

    // Five full-length seat boards with clean 9 mm gaps, softly eased edges.
    for (let slat = 0; slat < 5; slat++) {
      part('wood', 0, .445, -.236 + slat * .118, 1.9, .064, .109, 0, .95 + ((slat + benchIndex) % 4) * .025);
    }
    // A slightly raked, comfortably readable back; its top is below one metre.
    for (let slat = 0; slat < 3; slat++) {
      const y = .662 + slat * .123;
      part('wood', 0, y, -.31 - (y - .58) * .16, 1.9, .111, .061, -.158, .97 + ((slat + benchIndex) % 3) * .025);
    }
    for (const foot of footSamples) {
      const bottom = foot.y - datum - .006, top = .423;
      part('frame', foot.lx, (bottom + top) / 2, foot.lz, .055, top - bottom, .055);
      part('frame', foot.lx, bottom + .013, foot.lz, .105, .026, .095);
    }
    for (const lx of [-.76, .76]) {
      part('frame', lx, .394, 0, .062, .072, .61);
      part('frame', lx, .688, -.318, .052, .582, .052, -.158);
      part('frame', lx, .557, .203, .042, .27, .042);
      part('frame', lx, .69, -.014, .07, .051, .54);
      part('wood', lx, .723, -.005, .107, .037, .52, 0, .96);
    }
    part('frame', 0, .218, -.18, 1.53, .045, .045);

    // Flush warm-metal fixings remain a single shared mesh across all seats.
    for (const lx of [-.76, .76]) for (let slat = 0; slat < 3; slat++) {
      const y = .662 + slat * .123;
      const bolt = new CylinderGeometry(.011, .011, .007, 8);
      rotation.setFromAxisAngle(new Vector3(1, 0, 0), Math.PI * .5 - .158);
      matrix.compose(new Vector3(lx, y, -.274 - (y - .58) * .16), rotation, new Vector3(1, 1, 1));
      put('fasteners', bolt, new Matrix4().multiplyMatrices(benchTransform, matrix));
    }

    if (location.id === 'west-lawn-rest') {
      // One closed, unbranded notebook offers scale without adding signage.
      part('bookPages', .42, .512, .055, .166, .035, .237, 0, 1, -.19);
      for (const y of [.49, .535]) part('bookCover', .42, y, .055, .18, .009, .253, 0, 1, -.19);
    }

    const collider = new Mesh(colliderGeometry, colliderMaterial);
    collider.name = `Bench collision · ${location.id}`;
    collider.position.set(x, datum + .53, z); collider.quaternion.copy(heading);
    collider.visible = false; collider.userData.benchCollider = true;
    group.add(collider); colliders.push(collider);
  });

  const wood = new MeshStandardMaterial({name:'Campus warm timber', color:'#927046', roughness:.87, vertexColors:true});
  wood.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      attribute vec3 timberPoint;
      varying vec3 vTimberPoint;
    `).replace('#include <begin_vertex>', `#include <begin_vertex>
      vTimberPoint = timberPoint;
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vTimberPoint;
    `).replace('#include <color_fragment>', `#include <color_fragment>
      float crossGrain = vTimberPoint.y * 41.0 + vTimberPoint.z * 73.0;
      float grainWave = sin(crossGrain + sin(vTimberPoint.x * 2.1 + crossGrain * .3) * .8);
      float fineGrain = sin(crossGrain * 3.7 + vTimberPoint.x * .9) * .5 + .5;
      diffuseColor.rgb *= .97 + grainWave * .032 + fineGrain * .026;
    `);
  };
  wood.customProgramCacheKey = () => 'campus-timber-v1';
  const materials = {
    wood,
    frame:new MeshStandardMaterial({name:'Campus deep green frame', color:'#344d42', roughness:.75, metalness:.2}),
    fasteners:new MeshStandardMaterial({name:'Campus brass fixings', color:'#aa9470', roughness:.64, metalness:.45}),
    bookCover:new MeshStandardMaterial({name:'Campus notebook cloth', color:'#856349', roughness:.94}),
    bookPages:new MeshStandardMaterial({name:'Campus notebook pages', color:'#d7cbb0', roughness:1}),
  };
  const visibleMeshes: Mesh[] = [];
  for (const [kind, pieces] of batches) {
    const geometry = mergeGeometries(pieces);
    pieces.forEach(piece => piece.dispose());
    if (!geometry) { materials[kind].dispose(); continue; }
    const mesh = new Mesh(geometry, materials[kind]);
    mesh.name = `Campus seating · ${kind}`;
    mesh.castShadow = true; mesh.receiveShadow = true;
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    group.add(mesh); visibleMeshes.push(mesh);
  }
  group.userData.stats = {benches:BENCH_LOCATIONS.length, originalAnchors:6, illustrativeAdditions:2,
    drawCalls:visibleMeshes.length, triangles:visibleMeshes.reduce((sum, mesh) => sum + mesh.geometry.getAttribute('position').count / 3, 0)};
  group.updateMatrixWorld(true);
  const setQuality = (low: boolean) => visibleMeshes.forEach(mesh => { mesh.castShadow = !low; });
  return {group, colliders, setQuality};
}
