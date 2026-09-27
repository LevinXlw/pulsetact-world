import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTexture, cityFacadeTexture, random } from './empire-materials';

/** An illustrative Midtown-scale setting, not surveyed neighboring buildings. */
export function buildCity() {
  const group = new T.Group(); group.name = 'Illustrative Midtown setting';
  const rng = random(3405), batches = new Map<T.Material, T.BufferGeometry[]>();
  const asphaltMap = canvasTexture(256, 256, ctx => {
    ctx.fillStyle = '#535653'; ctx.fillRect(0, 0, 256, 256);
    const pixels = ctx.getImageData(0, 0, 256, 256);
    for (let i = 0; i < pixels.data.length; i += 4) { const noise = (rng() - .5) * 25; for (let k = 0; k < 3; k++) pixels.data[i + k] += noise; }
    ctx.putImageData(pixels, 0, 0);
  });
  asphaltMap.repeat.set(300, 300);
  const asphalt = new T.MeshStandardMaterial({ map: asphaltMap, roughness: .97 });
  const pavement = new T.MeshStandardMaterial({ color: '#a7a49b', roughness: .91 });
  const roof = new T.MeshStandardMaterial({ color: '#77766d', roughness: .93 });
  const trim = new T.MeshStandardMaterial({ color: '#9b9689', roughness: .8 });
  const equipment = new T.MeshStandardMaterial({ color: '#969b96', metalness: .4, roughness: .7 });
  const white = new T.MeshStandardMaterial({ color: '#cac7b7', roughness: .92 });
  const yellow = new T.MeshStandardMaterial({ color: '#d6b34e', roughness: .84 });
  const iron = new T.MeshStandardMaterial({ color: '#444b48', metalness: .5, roughness: .57 });
  const wood = new T.MeshStandardMaterial({ color: '#726351', roughness: .87 });
  const carGlass = new T.MeshStandardMaterial({ color: '#394c54', metalness: .45, roughness: .23 });
  const lamp = new T.MeshStandardMaterial({ color: '#d9d8b7', emissive: '#ffd391', emissiveIntensity: 0, roughness: .5 });
  const carPaint = ['#bf9b2c', '#252d31', '#c6c6bd', '#7b2923', '#6c797b'].map(color => new T.MeshStandardMaterial({ color, metalness: .45, roughness: .35 }));
  const facades = Array.from({ length: 6 }, (_, style) => new T.MeshStandardMaterial({ map: cityFacadeTexture(style), emissiveMap: cityFacadeTexture(style, true), emissive: '#ffc689', emissiveIntensity: 0, roughness: .84, color: '#ddd9d1' }));
  function box(material: T.Material, x: number, y: number, z: number, w: number, h: number, d: number, facade = false) {
    const geometry = new T.BoxGeometry(w, h, d);
    if (facade) {
      const uv = geometry.attributes.uv;
      for (let i = 0; i < uv.count; i++) {
        const face = Math.floor(i / 4), horizontal = face < 2 ? d : w;
        uv.setXY(i, uv.getX(i) * horizontal / 24, uv.getY(i) * h / 57.6);
      }
    }
    geometry.translate(x, y, z);
    const list = batches.get(material) ?? []; list.push(geometry); batches.set(material, list);
  }
  const floor = new T.Mesh(new T.PlaneGeometry(8500, 8500), asphalt); floor.rotation.x = -Math.PI / 2; floor.position.y = -.22; floor.receiveShadow = true; group.add(floor);
  box(pavement, 0, -.12, 0, 143, .3, 73);
  let buildings = 0;
  for (let bx = -11; bx <= 11; bx++) for (let bz = -18; bz <= 18; bz++) {
    if (bx === 0 && bz === 0) continue;
    const centerX = bx * 180, centerZ = bz * 106;
    box(pavement, centerX, -.08, centerZ, 151, .35, 80);
    for (let slot = 0; slot < 3; slot++) {
      const x = centerX + (slot - 1) * 47, z = centerZ + (rng() - .5) * 5;
      const w = 39 + rng() * 5, d = 55 + rng() * 13;
      let h = 20 + Math.pow(rng(), 1.4) * 94;
      if (rng() > .9) h += rng() * 95;
      // Keep the nearest sight lines readable while retaining street enclosure.
      if (Math.abs(bx) <= 1 && Math.abs(bz) <= 1) h = 26 + rng() * 42;
      h = Math.round(h / 3.6) * 3.6;
      const facade = facades[Math.floor(rng() * facades.length)];
      box(facade, x, h / 2, z, w, h, d, true);
      box(roof, x, h + .2, z, w + .25, .4, d + .25);
      if (Math.abs(bx) < 4 && Math.abs(bz) < 6) {
        for (const side of [-1, 1]) {
          box(trim, x, h + .6, z + side * d / 2, w, 1.2, .45);
          box(trim, x + side * w / 2, h + .6, z, .45, 1.2, d);
        }
        box(equipment, x + 4, h + 2, z, 6, 3.4, 8);
        box(iron, x + 4, h + 3.73, z, 5, .1, 6.5);
        if (slot % 2 === 0) {
          const upperHeight = 7.2 + Math.floor(rng() * 3) * 3.6;
          box(facade, x - 5, h + upperHeight / 2, z - 7, w * .48, upperHeight, d * .55, true);
          box(roof, x - 5, h + upperHeight + .15, z - 7, w * .48 + .4, .3, d * .55 + .4);
        }
        for (let y = 7; y < h; y += 14.4) box(trim, x, y, z + d / 2 + .12, w + .12, .32, .4);
        if (rng() > .6) {
          const tankX = x + w * .23, tankZ = z - d * .24;
          for (const dx of [-1.6, 1.6]) for (const dz of [-1.6, 1.6]) box(iron, tankX + dx, h + 2, tankZ + dz, .13, 4, .13);
          const tank = new T.CylinderGeometry(2.1, 2.1, 4.3, 16); tank.translate(tankX, h + 5, tankZ);
          const cap = new T.ConeGeometry(2.35, 1.25, 16); cap.translate(tankX, h + 7.78, tankZ);
          const list = batches.get(wood) ?? []; list.push(tank, cap); batches.set(wood, list);
        }
      }
      buildings++;
    }
  }
  // Street markings, traffic and lamp posts give the lower camera a human scale.
  for (let bz = -4; bz <= 4; bz++) {
    const z = bz * 106 + 53;
    for (let x = -780; x < 781; x += 12) { box(yellow, x, .012, z, 5, .018, .14); box(yellow, x, .012, z + .5, 5, .018, .14); }
    for (let bx = -4; bx <= 4; bx++) {
      const x = bx * 180 + 90;
      for (let k = 0; k < 10; k++) for (const sign of [-1, 1]) box(white, x + sign * 17, .02, z - 11 + k * 2.2, 5, .025, 1);
    }
  }
  for (let i = 0; i < 125; i++) {
    const z = (Math.floor(rng() * 7) - 3) * 106 + 53 + (rng() > .5 ? 5 : -5), x = (rng() - .5) * 1300;
    const paint = carPaint[Math.floor(rng() * carPaint.length)];
    box(iron, x, .42, z, 4.3, .6, 1.9); box(paint, x, .9, z, 4.5, .72, 1.83);
    box(carGlass, x - .2, 1.43, z, 2.4, .55, 1.63); box(paint, x - .25, 1.72, z, 1.8, .1, 1.66);
    if (paint === carPaint[0]) box(lamp, x, 1.89, z, .6, .26, .45);
  }
  for (let x = -240; x <= 241; x += 30) for (const z of [-38, 38, -144, 144]) {
    box(iron, x, 3.8, z, .12, 7.6, .12); box(iron, x, 7.6, z - 1.1, .13, .12, 2.2); box(lamp, x, 7.52, z - 2.1, .48, .12, .85);
  }
  for (const [material, geometries] of batches) {
    const merged = mergeGeometries(geometries); geometries.forEach(geometry => geometry.dispose());
    const mesh = new T.Mesh(merged, material); mesh.castShadow = material !== white && material !== yellow && material !== pavement; mesh.receiveShadow = true; group.add(mesh);
  }
  return { group, buildings, setNight(night: boolean) { facades.forEach(material => { material.emissiveIntensity = night ? .7 : 0; }); lamp.emissiveIntensity = night ? 2 : 0; } };
}
