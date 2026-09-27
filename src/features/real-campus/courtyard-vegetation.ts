import {
  Box3, BufferGeometry, CanvasTexture, Color, CylinderGeometry, DoubleSide,
  Float32BufferAttribute, Group, InstancedMesh, LOD, Matrix4, Mesh,
  MeshDepthMaterial, MeshStandardMaterial, PlaneGeometry, Quaternion,
  Raycaster, RepeatWrapping, RGBADepthPacking, SRGBColorSpace, Vector3,
} from 'three';

type TreePosition = {x:number; z:number; radius?:number};
export type CourtyardVegetationManifest = {
  trees:TreePosition[];
  porticoOpening:{center:number[]; normal:number[]};
};
export type CourtyardTreeAnchor = TreePosition & {y:number; height:number; hero:boolean};
export type CourtyardVegetationOptions = {
  /** Core GLB before its legacy bark is hidden. No source geometry is modified. */
  source:Group;
  manifest:CourtyardVegetationManifest;
  windTime?:{value:number};
  lowQuality?:boolean;
};

const UP = new Vector3(0, 1, 0);
const TWO_PI = Math.PI * 2;
function random(seed:number) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}

/** Recover ground elevations from the original surveyed-terrain-aligned trunks.
 * Manifest positions are retained exactly. The first ten trees are the two
 * existing rows inside Killian Court; these positions are illustrative, not a
 * tree survey. The source generator's trunk is 65% of its tree-height input.
 */
export function courtyardTreeAnchors(source:Group, manifest:CourtyardVegetationManifest):CourtyardTreeAnchor[] {
  const extent = manifest.trees.map(() => ({bottom:Infinity, top:-Infinity}));
  const point = new Vector3();
  source.updateMatrixWorld(true);
  source.traverse(object => {
    if (!(object instanceof Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (!materials.some(material => material.name === 'bark')) return;
    const positions = object.geometry.getAttribute('position');
    for (let vertex = 0; vertex < positions.count; vertex++) {
      point.fromBufferAttribute(positions, vertex).applyMatrix4(object.matrixWorld);
      for (let i = 0; i < manifest.trees.length; i++) {
        const tree = manifest.trees[i];
        if ((point.x - tree.x) ** 2 + (point.z - tree.z) ** 2 > .52 ** 2) continue;
        extent[i].bottom = Math.min(extent[i].bottom, point.y);
        extent[i].top = Math.max(extent[i].top, point.y);
        break;
      }
    }
  });
  return manifest.trees.map((tree, i) => ({
    ...tree,
    y:Number.isFinite(extent[i].bottom) ? extent[i].bottom : 4,
    height:Number.isFinite(extent[i].top) ? Math.max(8, Math.min(20, (extent[i].top - extent[i].bottom) / .65)) : i < 10 ? 17 : 11,
    hero:i < 10,
  }));
}

function canvasTexture(width:number, height:number, draw:(ctx:CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to create courtyard vegetation texture');
  draw(context);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** One twig with rounded ovate leaves. Holes are genuine alpha cutouts, never
 * opaque disks or the previous triangular blades. It is shared by every tree.
 */
function broadleafTexture() {
  return canvasTexture(256, 256, context => {
    context.clearRect(0, 0, 256, 256);
    context.strokeStyle = '#a29c69'; context.lineWidth = 2;
    context.beginPath(); context.moveTo(123, 249);
    context.bezierCurveTo(130, 173, 130, 93, 147, 20); context.stroke();
    const leaves = [
      [122, 208, -2.54, 58, 27], [128, 191, -.57, 63, 30],
      [130, 151, -2.61, 70, 33], [133, 140, -.53, 67, 32],
      [136, 96, -2.56, 65, 29], [140, 86, -.56, 61, 27],
      [144, 49, -2.34, 46, 24], [146, 34, -1.43, 31, 18],
    ];
    for (let i = 0; i < leaves.length; i++) {
      const [x, y, angle, length, width] = leaves[i];
      context.save(); context.translate(x, y); context.rotate(angle);
      const shade = context.createLinearGradient(0, -width, length, width);
      shade.addColorStop(0, '#d1d6b6'); shade.addColorStop(.48, '#e0e3c7'); shade.addColorStop(1, '#b4bf94');
      context.fillStyle = shade;
      context.beginPath(); context.moveTo(0, 0);
      context.bezierCurveTo(length * .16, -width * .95, length * .73, -width * 1.13, length, 0);
      context.bezierCurveTo(length * .76, width * .86, length * .25, width * 1.12, 0, 0);
      context.fill();
      context.strokeStyle = '#9fab80'; context.lineWidth = .8;
      context.beginPath(); context.moveTo(1, 0); context.lineTo(length * .91, 0); context.stroke();
      context.globalAlpha = .42; context.lineWidth = .6;
      for (let vein = .25; vein < .85; vein += .2) {
        const veinWidth = width * Math.sin(vein * Math.PI) * .71;
        context.beginPath(); context.moveTo(length * vein, 0);
        context.lineTo(length * (vein + .16), -veinWidth);
        context.moveTo(length * vein, 0); context.lineTo(length * (vein + .16), veinWidth);
        context.stroke();
      }
      context.restore();
    }
  });
}

function barkTexture() {
  const texture = canvasTexture(128, 512, context => {
    const rng = random(217);
    context.fillStyle = '#887f6d'; context.fillRect(0, 0, 128, 512);
    for (let i = 0; i < 320; i++) {
      const x = rng() * 128, y = rng() * 512, length = 12 + rng() * 110;
      context.strokeStyle = i % 3 ? `rgba(49,44,34,${.08 + rng() * .26})` : `rgba(218,210,184,${.08 + rng() * .25})`;
      context.lineWidth = .7 + rng() * 2.8;
      context.beginPath(); context.moveTo(x, y);
      context.bezierCurveTo(x + rng() * 6 - 3, y + length * .3, x + rng() * 7 - 3.5, y + length * .7, x + rng() * 4 - 2, y + length);
      context.stroke();
    }
  });
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(2, 2);
  return texture;
}

function windMaterial(material:MeshStandardMaterial | MeshDepthMaterial, time:{value:number}, grass = false) {
  material.onBeforeCompile = shader => {
    shader.uniforms.courtyardWindTime = time;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float courtyardWindTime;');
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 windAnchor = instanceMatrix[3].xyz;
        float breeze = sin(courtyardWindTime * .72 + windAnchor.x * .13 + windAnchor.z * .09);
        float flutter = sin(courtyardWindTime * 1.6 + windAnchor.x * .71 + windAnchor.y * .51);
        float weight = ${grass ? 'clamp(position.y, 0.0, 1.0)' : 'clamp(position.y + .5, 0.0, 1.0)'};
        transformed.x += (breeze * ${grass ? '.06' : '.035'} + flutter * .012) * weight;
        transformed.z += breeze * .018 * weight;
      #endif
    `);
  };
  material.customProgramCacheKey = () => `courtyard-${grass ? 'grass' : 'broadleaf'}-wind-v1`;
}

type Branch = {a:Vector3; b:Vector3; radius:number};
type CrownLobe = {center:Vector3; width:number; height:number; angle:number};
function treeStructure(tree:CourtyardTreeAnchor, index:number) {
  const rng = random(773 + index * 931);
  const h = tree.height, lean = new Vector3((rng() - .5) * .85, 0, (rng() - .5) * .85);
  const branches:Branch[] = [], lobes:CrownLobe[] = [];
  const baseRadius = tree.hero ? .43 + rng() * .04 : .3 + rng() * .1;
  const forkHeight = h * (.30 + rng() * .075);
  const trunk = [new Vector3(), new Vector3(lean.x * .1, .65, lean.z * .1),
    new Vector3(lean.x * .35, h * .18, lean.z * .35), new Vector3(lean.x, forkHeight, lean.z)];
  for (let j = 1; j < trunk.length; j++) branches.push({a:trunk[j - 1], b:trunk[j], radius:baseRadius * [1.22, 1, .76][j - 1]});
  // Low tapered roots terminate below the ground rather than floating cylinders.
  for (let j = 0; j < 6; j++) {
    const angle = j / 6 * TWO_PI + rng() * .45;
    branches.push({a:new Vector3(Math.cos(angle) * .22, .23, Math.sin(angle) * .22),
      b:new Vector3(Math.cos(angle) * (.75 + rng() * .25), -.045, Math.sin(angle) * (.75 + rng() * .25)), radius:.16});
  }
  // Fewer, overlapping deep lobes hold the same leaf budget more densely.
  // Different fork elevations and bent limbs avoid a repeated radial V frame.
  const count = tree.hero ? 5 + index % 3 : 5;
  const elbows:Vector3[] = [];
  for (let j = 0; j < count; j++) {
    const angle = j / count * TWO_PI + (rng() - .5) * 1.05 + index * .73;
    const spread = (tree.hero ? 3.1 : 2.6) + rng() * 1.8;
    const start = trunk[3].clone().multiplyScalar(.65 + rng() * .35);
    const tip = new Vector3(lean.x + Math.cos(angle) * spread, h * (.58 + rng() * .20), lean.z + Math.sin(angle) * spread);
    const elbow = start.clone().lerp(tip, .41 + rng() * .23);
    elbow.y += .9 + rng() * 1.15;
    elbow.x += Math.sin(angle) * (rng() - .5) * 1.15;
    elbow.z += Math.cos(angle) * (rng() - .5) * 1.15;
    elbows.push(elbow);
    branches.push({a:start, b:elbow, radius:baseRadius * (.40 + rng() * .14)}, {a:elbow, b:tip, radius:baseRadius * .20});
    lobes.push({center:tip.clone().add(new Vector3(0, -.45 + rng() * .6, 0)), width:(tree.hero ? 2.55 : 2.05) + rng() * .62, height:(tree.hero ? 3.05 : 2.5) + rng() * .9, angle});
    for (const side of [-1, 1]) {
      const twigStart = elbow.clone().lerp(tip, .55);
      const twigTip = tip.clone().add(new Vector3(Math.cos(angle + side * .95) * 1.4, .7 + rng(), Math.sin(angle + side * .95) * 1.4));
      branches.push({a:twigStart, b:twigTip, radius:.048});
      if (tree.hero) {
        const end = twigTip.clone().add(new Vector3(Math.cos(angle + side * 1.5) * .8, .6, Math.sin(angle + side * 1.5) * .8));
        branches.push({a:twigTip, b:end, radius:.017});
      }
    }
  }
  const leader = new Vector3(lean.x * 1.8 + Math.sin(index * 1.9) * 1.2, h * (.79 + rng() * .06), lean.z * 1.8 + Math.cos(index * 1.7) * 1.2);
  branches.push({a:elbows[index % elbows.length], b:leader, radius:baseRadius * .17});
  lobes.push({center:leader, width:tree.hero ? 2.8 : 2.3, height:tree.hero ? 3.15 : 2.65, angle:rng() * TWO_PI});
  return {branches, lobes};
}

function leafGeometry() {
  const geometry = new PlaneGeometry(1, 1, 2, 2);
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    // A gently cupped twig catches light across its width.
    position.setZ(i, Math.abs(position.getX(i)) * .13);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function grassGeometry() {
  const positions:number[] = [], colors:number[] = [];
  const rng = random(399);
  for (let blade = 0; blade < 5; blade++) {
    const angle = rng() * TWO_PI, x = (rng() - .5) * .2, z = (rng() - .5) * .2;
    const height = .45 + rng() * .55, width = .028 + rng() * .024, bend = .12 + rng() * .17;
    const dx = Math.cos(angle), dz = Math.sin(angle);
    const a = [x - dx * width, 0, z - dz * width], b = [x + dx * width, 0, z + dz * width];
    const c = [x - dx * width * .5 + dz * bend * .4, height * .55, z - dz * width * .5 + dx * bend * .4];
    const d = [x + dx * width * .5 + dz * bend * .4, height * .55, z + dz * width * .5 + dx * bend * .4];
    const top = [x + dz * bend, height, z + dx * bend];
    for (const vertex of [a, b, c, b, d, c, c, d, top]) {
      positions.push(...vertex);
      const shade = .63 + vertex[1] / height * .37;
      colors.push(shade, shade, shade);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** Replaces ALL old trees, so the caller must hide the core's `bark` material
 * and omit the legacy vegetation.glb request. No building or path is replaced.
 * Exposes windTime and stats in userData; regular scene disposal owns all maps,
 * geometry and materials. customDepthMaterial must also be disposed by caller.
 */
export function createCourtyardVegetation({source, manifest, windTime = {value:0}, lowQuality = false}:CourtyardVegetationOptions):Group {
  const result = new Group(); result.name = 'Killian broadleaf trees and lawn edges';
  result.userData.collision = 'none';
  const anchors = courtyardTreeAnchors(source, manifest);
  const leaves = broadleafTexture(), bark = barkTexture();
  const foliageMaterial = new MeshStandardMaterial({name:'courtyardBroadleaf', color:'white', map:leaves, roughness:.88, metalness:0, side:DoubleSide, alphaTest:.4});
  foliageMaterial.alphaToCoverage = true;
  windMaterial(foliageMaterial, windTime);
  const shadowMaterial = new MeshDepthMaterial({map:leaves, alphaTest:.4, depthPacking:RGBADepthPacking, side:DoubleSide});
  windMaterial(shadowMaterial, windTime);
  const barkMaterial = new MeshStandardMaterial({name:'courtyardBark', map:bark, roughness:1, color:'#a99f8b'});
  const branchGeometry = new CylinderGeometry(.6, 1, 1, 10, 1);
  const collisionGeometry = new CylinderGeometry(.4, .47, 2, 8, 1);
  const foliageGeometry = leafGeometry();
  const structures = anchors.map(treeStructure);
  const branchCount = structures.reduce((total, structure) => total + structure.branches.length, 0);
  const limbs = new InstancedMesh(branchGeometry, barkMaterial, branchCount);
  limbs.name = 'Branching trunks and root flares'; limbs.castShadow = true; limbs.receiveShadow = true;
  const matrix = new Matrix4(), rotation = new Quaternion(), color = new Color(), position = new Vector3(), scale = new Vector3();
  const qualityMeshes:{mesh:InstancedMesh; count:number; shadow:boolean; ratio:number}[] = [];
  let branchIndex = 0, cards = 0;
  anchors.forEach((tree, index) => {
    const structure = structures[index], rng = random(1273 + index * 8179);
    for (const branch of structure.branches) {
      const direction = branch.b.clone().sub(branch.a);
      rotation.setFromUnitVectors(UP, direction.clone().normalize());
      position.copy(branch.a).add(branch.b).multiplyScalar(.5).add(new Vector3(tree.x, tree.y + .04, tree.z));
      scale.set(branch.radius, direction.length(), branch.radius);
      limbs.setMatrixAt(branchIndex, matrix.compose(position, rotation, scale));
      color.setHSL(.105 + rng() * .018, .095 + rng() * .055, .72 + rng() * .18);
      limbs.setColorAt(branchIndex++, color);
    }
    const cardCount = tree.hero ? 1650 : index < 22 ? 820 : 340;
    cards += cardCount;
    const crown = new InstancedMesh(foliageGeometry, foliageMaterial, cardCount);
    crown.name = `Broadleaf crown ${index + 1}`; crown.castShadow = index < 22; crown.receiveShadow = true;
    crown.userData.excludeFromAO = true;
    crown.customDepthMaterial = shadowMaterial;
    const lod = new LOD(); lod.name = `Existing tree ${index + 1}`; lod.position.set(tree.x, tree.y + .04, tree.z);
    for (let card = 0; card < cardCount; card++) {
      const lobe = structure.lobes[card % structure.lobes.length];
      const angle = rng() * TWO_PI, vertical = rng() * 2 - 1, radius = Math.cbrt(rng()), ring = Math.sqrt(1 - vertical * vertical);
      const spreadX = Math.cos(angle) * ring * radius * lobe.width;
      const spreadZ = Math.sin(angle) * ring * radius * lobe.width * .8;
      position.set(lobe.center.x + spreadX, lobe.center.y + vertical * radius * lobe.height, lobe.center.z + spreadZ);
      // Rotate complete twigs in 3D; no camera-facing billboards.
      rotation.setFromAxisAngle(UP, rng() * TWO_PI);
      rotation.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), (rng() - .5) * Math.PI));
      rotation.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), (rng() - .5) * Math.PI));
      const size = (tree.hero ? .82 : .95) + rng() * .4;
      scale.set(size * (.8 + rng() * .25), size, size);
      crown.setMatrixAt(card, matrix.compose(position, rotation, scale));
      const outer = radius > .68, autumn = index % 5 === 3 && rng() < .13;
      color.setHSL(autumn ? .135 + rng() * .035 : .22 + rng() * .045, autumn ? .38 : .29 + rng() * .12, (outer ? .31 : .26) + rng() * .12);
      crown.setColorAt(card, color);
    }
    crown.instanceMatrix.needsUpdate = true;
    if (crown.instanceColor) crown.instanceColor.needsUpdate = true;
    crown.computeBoundingSphere();
    const distant = new InstancedMesh(foliageGeometry, foliageMaterial, Math.ceil(cardCount * .38));
    distant.instanceMatrix = crown.instanceMatrix;
    distant.instanceColor = crown.instanceColor;
    distant.receiveShadow = true; distant.castShadow = false;
    distant.userData.excludeFromAO = true;
    distant.boundingSphere = crown.boundingSphere?.clone() ?? null;
    distant.name = `Distant broadleaf crown ${index + 1}`;
    lod.addLevel(crown, 0); lod.addLevel(distant, tree.hero ? 155 : 120, .16);
    result.add(lod);
    qualityMeshes.push({mesh:crown, count:cardCount, shadow:index < 22, ratio:.56}, {mesh:distant, count:distant.count, shadow:false, ratio:.64});
    // Ray queries see one eight-sided ground-level trunk, never canopy geometry.
    const proxy = new Mesh(collisionGeometry, barkMaterial);
    proxy.name = `Tree trunk collision ${index + 1}`;
    proxy.position.set(tree.x, tree.y + 1, tree.z);
    proxy.visible = false; proxy.userData.collision = 'wall';
    result.add(proxy);
  });
  limbs.instanceMatrix.needsUpdate = true;
  if (limbs.instanceColor) limbs.instanceColor.needsUpdate = true;
  limbs.computeBoundingSphere(); result.add(limbs);

  // Grass is restricted to a narrow strip inside the existing lawn: no new
  // meadow, no obstruction in the central vista or in any pedestrian path.
  const normal = manifest.porticoOpening.normal, center = manifest.porticoOpening.center;
  const tangent = [normal[2], 0, -normal[0]], ground:Mesh[] = [];
  source.traverse(object => {
    if (!(object instanceof Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (materials.some(material => material.name === 'grass')) ground.push(object);
  });
  const groundRay = new Raycaster(), rng = random(4185), clumps:number[][] = [];
  const at = (u:number, s:number) => [center[0] + tangent[0] * u + normal[0] * s, center[2] + tangent[2] * u + normal[2] * s];
  for (const side of [-1, 1]) for (let s = 8; s < 91; s += .48) {
    if (rng() > .66) continue;
    const [x, z] = at(side * (45.5 + rng() * .4), s + rng() * .4);
    groundRay.set(new Vector3(x, 35, z), new Vector3(0, -1, 0));
    const hit = groundRay.intersectObjects(ground, false)[0];
    if (hit) clumps.push([x, hit.point.y + .006, z]);
  }
  for (let u = -44.8; u < 45; u += .63) {
    if (rng() > .42) continue;
    const [x, z] = at(u, 91.55 + rng() * .25);
    groundRay.set(new Vector3(x, 35, z), new Vector3(0, -1, 0));
    const hit = groundRay.intersectObjects(ground, false)[0];
    if (hit) clumps.push([x, hit.point.y + .006, z]);
  }
  const grassMaterial = new MeshStandardMaterial({name:'courtyardGrassEdges', color:'#808961', vertexColors:true, side:DoubleSide, roughness:1});
  windMaterial(grassMaterial, windTime, true);
  const grass = new InstancedMesh(grassGeometry(), grassMaterial, clumps.length);
  grass.name = 'Mown lawn edge tufts'; grass.receiveShadow = true;
  grass.userData.excludeFromAO = true;
  // Keep low-quality grass distributed across every edge when draw count drops.
  for (let i = clumps.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1)); [clumps[i], clumps[j]] = [clumps[j], clumps[i]];
  }
  clumps.forEach(([x, y, z], index) => {
    position.set(x, y, z); rotation.setFromAxisAngle(UP, rng() * TWO_PI);
    const height = .08 + rng() * .10;
    scale.set(.85 + rng() * .5, height, .85 + rng() * .5);
    grass.setMatrixAt(index, matrix.compose(position, rotation, scale));
    color.setHSL(.19 + rng() * .035, .18, .64 + rng() * .15); grass.setColorAt(index, color);
  });
  grass.instanceMatrix.needsUpdate = true;
  if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
  grass.computeBoundingSphere(); result.add(grass);
  qualityMeshes.push({mesh:grass, count:clumps.length, shadow:false, ratio:.5});
  result.traverse(object => {
    if (object instanceof Mesh && object.userData.collision !== 'wall') object.userData.collision = 'none';
  });
  result.userData.windTime = windTime;
  result.userData.replacesLegacyVegetation = true;
  result.userData.bounds = new Box3().setFromObject(result);
  result.userData.stats = {trees:anchors.length, heroTrees:anchors.filter(tree => tree.hero).length, branches:branchCount, leafCards:cards, grassClumps:clumps.length, lowQuality, legacyVegetationDownloadOmitted:true};
  result.userData.treeAnchors = anchors;
  result.userData.setQuality = (quality:'standard'|'low') => {
    const low = quality === 'low';
    for (const entry of qualityMeshes) {
      entry.mesh.count = Math.round(entry.count * (low ? entry.ratio : 1));
      entry.mesh.castShadow = entry.shadow && !low;
    }
    limbs.castShadow = !low;
    result.userData.stats.lowQuality = low;
    result.userData.stats.activeLeafCards = qualityMeshes.slice(0, -1).filter((_, i) => i % 2 === 0).reduce((sum, entry) => sum + entry.mesh.count, 0);
    result.userData.stats.activeGrassClumps = grass.count;
  };
  result.userData.setQuality(lowQuality ? 'low' : 'standard');
  return result;
}
