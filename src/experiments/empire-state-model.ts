import * as T from 'three';
import { limestoneTexture, random, windowTexture } from './empire-materials';

// Setback floors follow the NYC LPC designation report. Widths and floor heights
// are photo-calibrated approximations, not a survey or recovered game transforms.
export const EMPIRE_TIERS = [
  { bottom: 0, top: 22.4, width: 129.5, depth: 61.5, floors: 5 },
  { bottom: 22.4, top: 76.5, width: 91.5, depth: 58.5, floors: 15 },
  { bottom: 76.5, top: 91.6, width: 82.5, depth: 54.5, floors: 4 },
  { bottom: 91.6, top: 110.8, width: 73.5, depth: 50.5, floors: 5 },
  { bottom: 110.8, top: 264.2, width: 57, depth: 43, floors: 42 },
  { bottom: 264.2, top: 297, width: 51, depth: 39.5, floors: 9 },
  { bottom: 297, top: 313, width: 38.5, depth: 30, floors: 4 },
  { bottom: 313, top: 320, width: 31, depth: 25, floors: 2 },
];
type Placement = { matrix: T.Matrix4; tint: T.Color; glow: number };

export function buildEmpireState(library: T.Group) {
  const building = new T.Group(); building.name = 'Empire_State_Building_reference_study_v2';
  const rng = random(19310501), unitBox = new T.BoxGeometry(1, 1, 1), stoneMap = limestoneTexture();
  const stone = new T.MeshStandardMaterial({ name: 'Indiana limestone / pale honed surface', map: stoneMap, roughness: .84, color: '#f4f1e8' });
  const pier = new T.MeshStandardMaterial({ name: 'Limestone vertical piers', color: '#c7c2b6', roughness: .86 });
  const aluminum = new T.MeshStandardMaterial({ name: 'Dull aluminum spandrels', color: '#91938d', metalness: .45, roughness: .56 });
  const frames = new T.MeshStandardMaterial({ name: 'Nickel chrome window surrounds', color: '#a4a9a4', metalness: .65, roughness: .36 });
  const dark = new T.MeshStandardMaterial({ name: 'Recessed window reveals', color: '#343b3b', roughness: .7 });
  const roof = new T.MeshStandardMaterial({ name: 'Weathered roof membrane', color: '#6a6c65', roughness: .98 });
  const hardware = new T.MeshStandardMaterial({ name: 'Roof equipment', color: '#878b87', metalness: .45, roughness: .62 });
  const granite = new T.MeshStandardMaterial({ name: 'Polished entrance granite', color: '#333a39', metalness: .13, roughness: .32 });
  const glass = new T.MeshStandardMaterial({ name: 'Recessed double hung office glazing', map: windowTexture(), color: '#adb8b8', metalness: .28, roughness: .28, envMapIntensity: .8 });
  const glasses = [glass, ...[1, 2, 3].map(style => { const material = glass.clone(); material.name += ` / blind ${style}`; material.map = windowTexture(style); return material; })];
  const mortar = new T.MeshStandardMaterial({ name: 'Fine limestone block joints', color: '#afaba1', roughness: .95 });
  const crownStone = new T.MeshStandardMaterial({ name: 'Upper crown limestone', color: '#bfbeb2', roughness: .75 });
  const batches = new Map<T.Material, Placement[]>(), kitBatches = new Map<string, T.Matrix4[]>();
  const white = new T.Color(1, 1, 1), q = new T.Quaternion(), up = new T.Vector3(0, 1, 0);
  function box(material: T.Material, x: number, y: number, z: number, w: number, h: number, d: number, yaw = 0, tint = white, glow = 0) {
    const list = batches.get(material) ?? [];
    list.push({ matrix: new T.Matrix4().compose(new T.Vector3(x, y, z), q.setFromAxisAngle(up, yaw), new T.Vector3(w, h, d)), tint, glow });
    batches.set(material, list);
  }
  function kit(label: string, x: number, y: number, z: number, yaw = 0, sx = 1, sy = sx, sz = sx) {
    const list = kitBatches.get(label) ?? [];
    list.push(new T.Matrix4().compose(new T.Vector3(x, y, z), q.setFromAxisAngle(up, yaw), new T.Vector3(sx, sy, sz)));
    kitBatches.set(label, list);
  }
  let facadeCells = 0;
  for (const [tierIndex, tier] of EMPIRE_TIERS.entries()) {
    const { bottom, top, width, depth, floors } = tier, height = top - bottom;
    box(tierIndex >= 6 ? crownStone : stone, 0, (top + bottom) / 2, 0, width, height, depth);
    box(roof, 0, top + .02, 0, width - .35, .16, depth - .35);
    for (let side = 0; side < 4; side++) {
      const span = side % 2 === 0 ? width : depth, yaw = side * Math.PI / 2;
      function face(material: T.Material, u: number, y: number, out: number, w: number, h: number, d: number, tint = white, glow = 0) {
        if (tierIndex >= 6 && (material === stone || material === pier)) material = crownStone;
        const x = side === 0 ? u : side === 1 ? width / 2 + out : side === 2 ? -u : -width / 2 - out;
        const z = side === 0 ? depth / 2 + out : side === 1 ? -u : side === 2 ? -depth / 2 - out : u;
        box(material, x, y, z, w, h, d, yaw, tint, glow);
      }
      const columns = Math.max(3, Math.floor((span - 3.2) / 5.05)), pitch = (span - 3.2) / columns;
      // Paired vertical window strips, broad stone piers and solid aluminum spandrels.
      for (let col = 0; col < columns; col++) {
        const u = -span / 2 + 1.6 + pitch * (col + .5);
        const projection = col % 3 === 1 && tierIndex > 0 ? .25 : 0, bayWidth = 2.67;
        face(aluminum, u, (top + bottom) / 2, .036 + projection, bayWidth, height - .18, .08);
        face(pier, u - bayWidth / 2 - .14, (top + bottom) / 2, .13 + projection, .28, height, .32);
        face(pier, u + bayWidth / 2 + .14, (top + bottom) / 2, .13 + projection, .28, height, .32);
        const floorHeight = height / floors;
        for (let floor = 0; floor < floors; floor++) {
          const y = bottom + floorHeight * (floor + .57), windowHeight = Math.min(2.34, floorHeight * .65);
          if (tierIndex === 0 && floor === 0) continue;
          face(dark, u, y, .1 + projection, 2.69, windowHeight + .14, .1);
          face(frames, u, y, .15 + projection, .075, windowHeight + .15, .12);
          for (const sign of [-1, 1]) {
            const v = .76 + rng() * .24, tint = new T.Color().setRGB(v * .97, v, v * 1.01);
            face(glasses[Math.floor(rng() * 4)], u + sign * .665, y, .155 + projection, 1.23, windowHeight, .04, tint, rng() > .7 ? .55 + rng() * .6 : .015);
            facadeCells++;
          }
          face(frames, u, y - windowHeight / 2 - .035, .22 + projection, 2.82, .09, .29);
          face(frames, u, y + windowHeight / 2 + .035, .16 + projection, 2.72, .06, .16);
          face(aluminum, u, y - floorHeight * .43, .095 + projection, 2.66, .08, .14);
          if (col < columns - 1) for (let seam = 0; seam < 3; seam++) {
            face(mortar, u + pitch / 2, bottom + floor * floorHeight + seam * floorHeight / 3, .016, pitch - bayWidth - .7, .016, .013);
          }
        }
      }
      face(pier, 0, top + .4, -.1, span, .8, .42);
      face(stone, 0, top + .83, -.1, span + .06, .13, .53);
      for (const u of [-span / 2 + .45, span / 2 - .45]) face(pier, u, (bottom + top) / 2, .04, .9, height, .27);
      if (tierIndex === 0) {
        face(granite, 0, 4.1, .16, span, .48, .4);
        for (let u = -span / 2 + 2.6; u < span / 2; u += 4.8) {
          face(dark, u, 1.85, .04, 3.65, 3.65, .13);
          for (const dx of [-.94, .94]) face(glass, u + dx, 1.9, .13, 1.7, 3.32, .06);
          face(frames, u, 1.9, .19, .08, 3.5, .12);
        }
      }
    }
    if (tierIndex < 7) {
      const next = EMPIRE_TIERS[tierIndex + 1];
      for (const sign of [-1, 1]) for (const z of [-depth * .23, depth * .23]) {
        const x = sign * (width + next.width) / 4, w = Math.min(3.5, Math.max(.6, (width - next.width) / 2 - 1.5));
        box(hardware, x, top + .9, z, w, 1.5, 2.2); box(dark, x, top + 1.66, z, w * .8, .05, 1.7);
      }
    }
  }
  for (const x of [-6, 0, 6]) kit('empire-entrance', x, 0, 30.86, 0, .9, 1.12, 1);
  box(granite, 0, 4.95, 31.4, 22, .46, 2.1); box(frames, 0, 5.21, 31.82, 22.25, .075, 1.45);
  for (const x of [-11.8, 11.8]) box(pier, x, 9.6, 31.05, 1.5, 19.2, .75);
  // 86th-floor terrace and fluted crown, connecting the extracted mast geometry.
  for (let side = 0; side < 4; side++) {
    const span = side % 2 === 0 ? 30 : 24;
    for (let u = -span / 2; u < span / 2; u += 2) {
      kit('empire-railing', side === 0 ? u : side === 1 ? 15 : side === 2 ? -u : -15, 320.3,
        side === 0 ? 12 : side === 1 ? -u : side === 2 ? -12 : u, side * Math.PI / 2, 1, .82, 1);
    }
    for (const u of [-8, -4, 0, 4, 8]) {
      const x = side === 0 ? u : side === 1 ? 10.6 : side === 2 ? -u : -10.6;
      const z = side === 0 ? 10.6 : side === 1 ? -u : side === 2 ? -10.6 : u;
      box(crownStone, x, 322.8, z, .95, 8, .85, side * Math.PI / 2);
    }
  }
  box(crownStone, 0, 322, 0, 20, 4, 20); box(aluminum, 0, 325, 0, 18, .38, 18);
  kit('empire-spire', 0, 320, 0, 0, 10);
  // Narrow horizontal joints articulate the mast's vertical metal panels.
  for (let y = 330; y < 367; y += 3.25) {
    for (const z of [-5.62, 5.62]) box(frames, 0, y, z, 5.7, .12, .08);
    for (const x of [-5.62, 5.62]) box(frames, x, y, 0, .08, .12, 5.7);
  }
  const spireTop = 320 + 6.084228515625 * 10;
  const antennaScale = (443.2 - spireTop) / (7.140625 + .062744140625);
  kit('empire-antenna', 0, spireTop + .062744140625 * antennaScale, 0, 0, 8.2, antennaScale, 8.2);

  for (const material of glasses) material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float instanceGlow;\nvarying float vWindowGlow;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWindowGlow = instanceGlow;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vWindowGlow;').replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vWindowGlow;');
  };
  glasses.forEach(material => { material.customProgramCacheKey = () => 'empire-office-glow-v2'; });
  const kitMaterialCache = new Map<string, T.MeshStandardMaterial>(), mastMaterials: T.MeshStandardMaterial[] = [];
  let instances = 0, triangles = 0;
  for (const [material, list] of batches) {
    const isGlass = glasses.includes(material as T.MeshStandardMaterial);
    const geometry = isGlass ? unitBox.clone() : unitBox;
    if (isGlass) geometry.setAttribute('instanceGlow', new T.InstancedBufferAttribute(new Float32Array(list.map(item => item.glow)), 1));
    const mesh = new T.InstancedMesh(geometry, material, list.length); mesh.name = material.name;
    list.forEach((item, index) => { mesh.setMatrixAt(index, item.matrix); mesh.setColorAt(index, item.tint); });
    mesh.castShadow = !isGlass && material !== frames && material !== mortar; mesh.receiveShadow = true;
    mesh.computeBoundingBox(); mesh.computeBoundingSphere(); building.add(mesh);
    instances += list.length; triangles += 12 * list.length;
  }
  library.updateMatrixWorld(true);
  for (const [label, placements] of kitBatches) {
    const source = library.getObjectByName(label); if (!source) throw new Error(`Missing kit ${label}`);
    source.traverse(object => {
      if (!(object instanceof T.Mesh) || Array.isArray(object.material)) return;
      const original = object.material as T.MeshStandardMaterial, key = label + original.name;
      let material = kitMaterialCache.get(key);
      if (!material) {
        material = original.clone(); material.name = `${label} / ${original.name}`;
        material.color.set('#babdb7'); material.roughness = .46; material.metalness = .5;
        if (original.name.includes('bricks')) { material.map = stoneMap; material.color.set('#ede9df'); material.metalness = 0; material.roughness = .82; }
        else { material.map = null; material.normalMap = null; }
        if (original.name.includes('window')) material.color.set('#535f62');
        if (label === 'empire-spire') { material.color.set(original.name.includes('glass') ? '#a8b1b1' : '#c9c9be'); mastMaterials.push(material); }
        kitMaterialCache.set(key, material);
      }
      const mesh = new T.InstancedMesh(object.geometry, material, placements.length); mesh.name = label;
      placements.forEach((matrix, index) => mesh.setMatrixAt(index, matrix.clone().multiply(object.matrixWorld)));
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.computeBoundingBox(); mesh.computeBoundingSphere(); building.add(mesh);
      instances += placements.length; triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3 * placements.length;
    });
  }
  const bounds = new T.Box3().setFromObject(building);
  function setNight(night: boolean) {
    glasses.forEach(material => { material.emissive.set(night ? '#ffd4a0' : '#000000'); material.emissiveIntensity = night ? .55 : 0; });
    crownStone.emissive.set(night ? '#ffd1a0' : '#000000'); crownStone.emissiveIntensity = night ? .13 : 0;
    mastMaterials.forEach(material => { material.emissive.set(night ? '#ffe1b2' : '#000000'); material.emissiveIntensity = night ? (material.name.includes('glass') ? .26 : .08) : 0; });
  }
  const stats = { revision: 2, facadeCells, components: [...kitBatches.values()].reduce((n, list) => n + list.length, 0), instancedPrimitives: instances, triangles, height: bounds.max.y, bounds: [bounds.min.toArray(), bounds.max.toArray()], gameKitTypes: kitBatches.size, setbackFloors: [5, 20, 24, 29, 71, 80, 84, 86] };
  return { building, stats, setNight };
}
