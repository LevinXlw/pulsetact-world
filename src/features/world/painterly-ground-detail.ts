import {
  BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, InstancedMesh,
  Matrix4, Mesh, MeshStandardMaterial, Quaternion, Vector3,
} from 'three';
import type {CampusCollision} from '../real-campus/campus-collision';
import {lawnEdgeDistance} from '../real-campus/courtyard-ground-detail';

type Tree = {x:number; z:number; radius:number};
type Wind = {value:number};
type GroundTriangle = {a:Vector3; b:Vector3; c:Vector3; minX:number; maxX:number; minZ:number; maxZ:number; denominator:number};
type Placement = {position:Vector3; matrix:Matrix4; color:Color};
type GroundDetailOptions = {trees:Tree[]; collision:CampusCollision; lawn:Mesh|null; wind:Wind};
const UP = new Vector3(0, 1, 0);
const TAU = Math.PI * 2;
// Same surveyed metre frame and lawn rectangles as courtyard-ground-detail.ts.
// The fragment shader evaluates the minimum distance directly; interpolating
// distances at triangle vertices would erase wear on boundary-only triangles.
const LAWN_RECTS = [[-46,46,7,92],[-46,-2,95,128],[2,46,95,128],[-46,-2,131,152],[2,46,131,152]];
const lawnEdgeShader = `
  float exactLawnEdge(vec2 world) {
    vec2 relative=world-vec2(12.904326,-34.578878);
    float u=dot(relative,vec2(.9080005,-.4189689));
    float s=dot(relative,vec2(.4189689,.9080005));
    ${LAWN_RECTS.map(([u0,u1,s0,s1]) => `
      if(u>${u0.toFixed(1)}&&u<${u1.toFixed(1)}&&s>${s0.toFixed(1)}&&s<${s1.toFixed(1)})
        return min(min(u-(${u0.toFixed(1)}),${u1.toFixed(1)}-u),min(s-(${s0.toFixed(1)}),${s1.toFixed(1)}-s));
    `).join('')}
    return -1.;
  }
`;

function seeded(seed:number) {
  return () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296;};
}

/** Use the surveyed triangles themselves for the colour wash, and barycentric
 * positions for small plants. Nothing bridges a path or invents a ground level. */
function groundSampler(lawn:Mesh) {
  const triangles:GroundTriangle[] = [], cells = new Map<string, GroundTriangle[]>(), cellSize = 4;
  lawn.updateWorldMatrix(true, false);
  const vertices = lawn.geometry.getAttribute('position'), indices = lawn.geometry.index;
  const count = indices?.count ?? vertices.count;
  for (let index = 0; index + 2 < count; index += 3) {
    const points = [0, 1, 2].map(offset => new Vector3()
      .fromBufferAttribute(vertices, indices ? indices.getX(index + offset) : index + offset)
      .applyMatrix4(lawn.matrixWorld));
    if (points.some(point => !Number.isFinite(point.x + point.y + point.z))) continue;
    const [a, b, c] = points;
    if (lawnEdgeDistance((a.x + b.x + c.x) / 3, (a.z + b.z + c.z) / 3) < 0) continue;
    const denominator = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
    if (Math.abs(denominator) < 1e-8) continue;
    const triangle = {a, b, c, denominator, minX:Math.min(a.x, b.x, c.x), maxX:Math.max(a.x, b.x, c.x),
      minZ:Math.min(a.z, b.z, c.z), maxZ:Math.max(a.z, b.z, c.z)};
    triangles.push(triangle);
    for (let x = Math.floor(triangle.minX / cellSize); x <= Math.floor(triangle.maxX / cellSize); x++) {
      for (let z = Math.floor(triangle.minZ / cellSize); z <= Math.floor(triangle.maxZ / cellSize); z++) {
        const key = `${x}:${z}`, cell = cells.get(key);
        if (cell) cell.push(triangle); else cells.set(key, [triangle]);
      }
    }
  }
  const height = (x:number, z:number) => {
    if (lawnEdgeDistance(x, z) <= .025) return undefined;
    const cell = cells.get(`${Math.floor(x / cellSize)}:${Math.floor(z / cellSize)}`);
    if (!cell) return undefined;
    for (const {a, b, c, denominator, minX, maxX, minZ, maxZ} of cell) {
      if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
      const wa = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / denominator;
      const wb = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / denominator, wc = 1 - wa - wb;
      if (wa < -1e-6 || wb < -1e-6 || wc < -1e-6) continue;
      const y = a.y * wa + b.y * wb + c.y * wc;
      if (Number.isFinite(y)) return y;
    }
    return undefined;
  };
  return {triangles, height};
}

function groundWash(triangles:GroundTriangle[], trees:Tree[]) {
  const positions:number[] = [], detail:number[] = [];
  // Each copied vertex belongs to an existing terrain triangle. The shader
  // softly cuts the wear and irregular root shapes inside those triangles.
  const add = ({a, b, c}:GroundTriangle, tree:Tree|null, radius=1) => {
    if (positions.length / 9 >= 7600) return;
    for (const point of [a, b, c]) {
      positions.push(point.x, point.y + .007, point.z);
      detail.push(tree ? (point.x - tree.x) / radius : 0,
        tree ? (point.z - tree.z) / radius : 0, tree ? 1 : 0);
    }
  };
  for (const triangle of triangles) {
    const edge = Math.min(...[triangle.a, triangle.b, triangle.c].map(p => Math.max(0, lawnEdgeDistance(p.x, p.z))));
    if (edge < 1.1) add(triangle, null);
  }
  trees.slice(0, 22).forEach((tree, index) => {
    const radius = 1.08 + (index % 4) * .12;
    for (const triangle of triangles) {
      const dx = Math.max(triangle.minX - tree.x, tree.x - triangle.maxX, 0);
      const dz = Math.max(triangle.minZ - tree.z, tree.z - triangle.maxZ, 0);
      if (dx * dx + dz * dz < radius * radius * 1.22) add(triangle, tree, radius);
    }
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('groundDetail', new Float32BufferAttribute(detail, 3));
  geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  const material = new MeshStandardMaterial({name:'Grounded root earth and mown margin',
    color:'#ffffff', roughness:1, transparent:true, depthWrite:false,
    polygonOffset:true, polygonOffsetFactor:-2, polygonOffsetUnits:-1});
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      attribute vec3 groundDetail;
      varying vec3 vGroundDetail;
      varying vec3 vGroundPosition;
    `).replace('#include <begin_vertex>', `#include <begin_vertex>
      vGroundDetail=groundDetail;
      vGroundPosition=(modelMatrix*vec4(position,1.)).xyz;
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vGroundDetail;
      varying vec3 vGroundPosition;
      ${lawnEdgeShader}
      float groundHash(vec2 p) {return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float groundNoise(vec2 p) {
        vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(groundHash(i),groundHash(i+vec2(1.,0.)),f.x),
          mix(groundHash(i+vec2(0.,1.)),groundHash(i+vec2(1.,1.)),f.x),f.y);
      }
    `).replace('#include <color_fragment>', `#include <color_fragment>
      float wash=groundNoise(vGroundPosition.xz*.91);
      float smallWash=groundNoise(vGroundPosition.xz*3.2);
      float mask;
      if(vGroundDetail.z>.5) {
        float distanceFromRoot=length(vGroundDetail.xy);
        float rim=.72+wash*.27+smallWash*.07;
        mask=(1.-smoothstep(rim-.20,rim+.12,distanceFromRoot))*.69;
        diffuseColor.rgb=mix(vec3(.205,.185,.116),vec3(.292,.274,.179),wash);
      } else {
        float edge=exactLawnEdge(vGroundPosition.xz);
        float width=.22+wash*.50;
        mask=smoothstep(.025,.13,edge)*(1.-smoothstep(width*.35,width+.20,edge))*.25;
        diffuseColor.rgb=mix(vec3(.280,.290,.173),vec3(.348,.325,.215),smallWash);
      }
      diffuseColor.a*=mask*(1.-smoothstep(24.,40.,distance(vGroundPosition,cameraPosition)));
      if(diffuseColor.a<.008) discard;
    `);
  };
  material.customProgramCacheKey = () => 'mit-fitted-ground-wash-v2';
  const mesh = new Mesh(geometry, material); mesh.name = 'Terrain fitted wear and root earth';
  mesh.receiveShadow = true; mesh.renderOrder = 2;
  return mesh;
}

function littleLeaves(clover:boolean) {
  const vertices:number[] = [], colors:number[] = [];
  const add = (points:number[][], indices:number[], leaf:number) => {
    for (const index of indices) {
      vertices.push(...points[index]);
      const shade = index === 0 ? .83 : index % 2 ? 1 : .94;
      colors.push(shade, shade, shade * (leaf ? .96 : 1));
    }
  };
  if (clover) {
    for (let leaf = 0; leaf < 3; leaf++) {
      const angle = leaf / 3 * TAU;
      const points = [[0,.055,0], [.045,.084,.016], [.093,.092,-.002], [.109,.087,-.046],
        [.073,.082,-.085], [.027,.074,-.061]].map(([x,y,z]) => [x*Math.cos(angle)-z*Math.sin(angle), y, x*Math.sin(angle)+z*Math.cos(angle)]);
      add(points, [0,1,2,0,2,3,0,3,4,0,4,5], 1);
    }
  } else {
    add([[-.09,.006,0],[-.032,.023,-.041],[.07,.021,-.019],[.13,.007,0],[.025,.012,.049]], [0,1,2,0,2,4,2,3,4], 0);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function detailMaterial(clover:boolean, wind:Wind) {
  const material = new MeshStandardMaterial({name:clover ? 'Quiet clover leaves' : 'Scattered broad fallen leaves',
    color:'#ffffff', roughness:1, vertexColors:true, side:DoubleSide});
  material.onBeforeCompile = shader => {
    shader.uniforms.detailWind = wind;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      uniform float detailWind;
    `).replace('#include <begin_vertex>', `#include <begin_vertex>
      vec3 rootWorld=(modelMatrix*instanceMatrix*vec4(0.,0.,0.,1.)).xyz;
      float presence=1.-smoothstep(14.,24.,distance(rootWorld,cameraPosition));
      transformed*=presence;
      ${clover ? 'transformed.x+=sin(detailWind*.8+rootWorld.x*.7+rootWorld.z*.5)*position.y*.055*presence;' : ''}
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      normal=normalize(normal*.25+mat3(viewMatrix)*vec3(0.,.75,0.));
    `);
  };
  material.customProgramCacheKey = () => `mit-ground-${clover ? 'clover' : 'litter'}-v1`;
  return material;
}

function nearInstances(name:string, placements:Placement[], clover:boolean, wind:Wind) {
  const mesh = new InstancedMesh(littleLeaves(clover), detailMaterial(clover, wind), placements.length);
  mesh.name = name; mesh.receiveShadow = true; mesh.frustumCulled = false;
  mesh.userData.collision = 'none';
  const update = (camera:Vector3, low:boolean) => {
    let count = 0;
    placements.forEach(({position, matrix, color}, index) => {
      if (low && index % 3 !== 0) return;
      const dx = position.x - camera.x, dz = position.z - camera.z;
      if (dx * dx + dz * dz > 25 * 25) return;
      mesh.setMatrixAt(count, matrix); mesh.setColorAt(count++, color);
    });
    mesh.count = count; mesh.visible = count > 0;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };
  return {mesh, update};
}

/** A maintained campus lawn: slight wear, earth at roots, and occasional small
 * leaves. The detailed layer submits at most three draws and 12,880 triangles. */
export function createPainterlyGroundDetail({trees, collision, lawn, wind}:GroundDetailOptions) {
  const group = new Group(); group.name = 'MIT lawn margins and tree foot detail';
  if (!lawn) return {group, setQuality:(_low:boolean) => {}, update:(_cameraPosition:Vector3) => {}};
  const sampler = groundSampler(lawn), wash = groundWash(sampler.triangles, trees);
  group.add(wash);
  const random = seeded(79011), litter:Placement[] = [], clover:Placement[] = [];
  const rotation = new Quaternion(), scale = new Vector3();
  const place = (x:number, z:number, isClover:boolean) => {
    const target = isClover ? clover : litter, maximum = isClover ? 330 : 440;
    if (target.length >= maximum || lawnEdgeDistance(x, z) < .20) return;
    const y = sampler.height(x, z); if (y === undefined) return;
    // A source lawn below a step or path cannot receive visible ground detail.
    const actualHeight = collision.groundHeight(x, z);
    if (actualHeight !== undefined && (!Number.isFinite(actualHeight) || Math.abs(actualHeight - y) > .08)) return;
    const position = new Vector3(x, y + .012, z);
    rotation.setFromAxisAngle(UP, random() * TAU);
    scale.setScalar(isClover ? .82 + random() * .65 : .7 + random() * .6);
    const palette = isClover ? ['#718852','#79915a','#698151'] : ['#92865a','#a39465','#b09b6f','#86815c'];
    target.push({position, matrix:new Matrix4().compose(position, rotation, scale), color:new Color(palette[Math.floor(random() * palette.length)])});
  };
  trees.slice(0, 22).forEach((tree, index) => {
    // A few coherent patches leave most of the mown grass open.
    for (let leaf = 0; leaf < 15; leaf++) {
      const angle = random() * TAU, radius = .60 + random() * 2.6;
      place(tree.x + Math.cos(angle) * radius, tree.z + Math.sin(angle) * radius, false);
    }
    for (let patch = 0; patch < 2; patch++) {
      const angle = index * 2.4 + patch * 2.1, radius = 1.4 + random() * 2;
      const x = tree.x + Math.cos(angle) * radius, z = tree.z + Math.sin(angle) * radius;
      for (let plant = 0; plant < 6; plant++) place(x + (random()-.5)*.7, z + (random()-.5)*.7, true);
    }
  });
  // Occasional clusters along the lawn edge, separated by many metres.
  for (let attempt = 0; attempt < 900 && clover.length < 330; attempt++) {
    const triangle = sampler.triangles[Math.floor(random() * sampler.triangles.length)];
    if (!triangle) break;
    const t = Math.sqrt(random()), v = random(), wa = 1-t, wb = t*(1-v), wc = t*v;
    const x = triangle.a.x*wa + triangle.b.x*wb + triangle.c.x*wc;
    const z = triangle.a.z*wa + triangle.b.z*wb + triangle.c.z*wc;
    const edge = lawnEdgeDistance(x,z); if (edge < .35 || edge > 1.6) continue;
    for (let plant = 0; plant < 4; plant++) place(x+(random()-.5)*.55, z+(random()-.5)*.55, true);
    place(x + .3, z - .2, false);
  }
  const leaves = nearInstances('Near scattered leaves', litter, false, wind);
  const plants = nearInstances('Small lawn clover patches', clover, true, wind);
  group.add(leaves.mesh, plants.mesh);
  const lastCamera = new Vector3(Infinity, Infinity, Infinity);
  let lowQuality = false;
  const update = (cameraPosition:Vector3) => {
    if (!Number.isFinite(cameraPosition.x + cameraPosition.y + cameraPosition.z)) return;
    if (lastCamera.distanceToSquared(cameraPosition) < .64) return;
    lastCamera.copy(cameraPosition);
    leaves.update(cameraPosition, lowQuality); plants.update(cameraPosition, lowQuality);
  };
  const setQuality = (low:boolean) => {
    lowQuality = low;
    if (Number.isFinite(lastCamera.x)) {
      leaves.update(lastCamera, low); plants.update(lastCamera, low);
    }
  };
  group.userData.stats = {rootPatches:Math.min(trees.length,22), cloverPlants:clover.length, fallenLeaves:litter.length,
    triangles:wash.geometry.getAttribute('position').count/3+clover.length*12+litter.length*3, drawCalls:3};
  update(new Vector3(53.5, 2, 58));
  return {group, setQuality, update};
}
