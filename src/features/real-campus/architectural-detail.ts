import {
  BoxGeometry, BufferGeometry, Color, CylinderGeometry, Group, InstancedMesh, Matrix4, Mesh,
  MeshStandardMaterial, Quaternion, Vector3,
} from 'three';

type Opening = {id:string; x:number; w:number; bottom:number; top:number};
type Facade = {
  center:number[]; normal:number[]; glassDepth:number; openings:Opening[];
};
export type ArchitecturalDetailManifest = {
  courtyardFacades?:Facade[];
  dome?:{center:number[]; profile:number[][]};
};
type Instance = {position:Vector3; size:Vector3; angle:number; color:Color};

function hash(text:string) {
  let seed = 2166136261;
  for (let i = 0; i < text.length; i++) seed = Math.imul(seed ^ text.charCodeAt(i), 16777619);
  return (seed >>> 0) / 4294967296;
}

/** Small physical cavities behind the existing glazing, not a second facade.
 * Room finishes and raised-shade states are illustrative; openings stay at the
 * recorded GIS/photo-study anchors. Drum relief follows maclaurin-oblique.webp.
 */
export function createArchitecturalDetail(source:Group, manifest:ArchitecturalDetailManifest):Group {
  const detail = new Group();
  detail.name = 'courtyard-architectural-depth';
  detail.userData.collision = 'none';
  const rooms:Instance[] = [], shades:Instance[] = [], relief:Instance[] = [], drops:Instance[] = [];
  const roomTones = ['#44473f', '#50514a', '#444a48', '#565249', '#404742'];
  const shadeTones = ['#b9b7ab', '#a9ada5', '#c1baaa', '#a7ada8'];
  const stone = new Color('#bdb8ab');
  let windows = 0;

  function box(list:Instance[], facade:Facade, x:number, y:number, depth:number,
    width:number, height:number, thickness:number, color:Color) {
    const [nx, , nz] = facade.normal, [cx, , cz] = facade.center;
    list.push({position:new Vector3(cx + nz * x + nx * depth, y, cz - nx * x + nz * depth),
      size:new Vector3(width, height, thickness), angle:Math.atan2(nx, nz), color});
  }

  for (const facade of manifest.courtyardFacades || []) for (const opening of facade.openings) {
    const width = opening.w - .15, height = opening.top - opening.bottom - .14;
    if (width <= 0 || height <= 0) continue;
    windows++;
    const center = (opening.bottom + opening.top) / 2, shade = hash(opening.id + ':shade');
    const tone = new Color(roomTones[Math.floor(hash(opening.id + ':room') * roomTones.length)]);
    // Existing glass is 35 mm thick; leave a 90 mm clear gap to its back face.
    // Existing cavity backing is at -0.92 m. These shallow surfaces stay in
    // front of it, so none can clip the walls or the visible glazing/frame.
    const front = facade.glassDepth - .11, back = facade.glassDepth - .545;
    const depth = front - back;
    box(rooms, facade, opening.x, center, back, width, height, .018, tone);
    for (const side of [-1, 1]) {
      box(rooms, facade, opening.x + side * width / 2, center, (front + back) / 2,
        .016, height, depth, tone.clone().multiplyScalar(.82));
      box(rooms, facade, opening.x, center + side * height / 2, (front + back) / 2,
        width, .016, depth, tone.clone().multiplyScalar(side === 1 ? .73 : 1.12));
    }
    // A mixture of open and partly drawn roller shades breaks the conspicuous
    // repeated cyan window grid without claiming a surveyed interior layout.
    if (shade < .49 || height < 1.25) continue;
    const coverage = .19 + hash(opening.id + ':height') * .60;
    const fabricHeight = height * coverage;
    const fabric = new Color(shadeTones[Math.floor(hash(opening.id + ':fabric') * shadeTones.length)]);
    const fabricBottom = center + height / 2 - fabricHeight;
    box(shades, facade, opening.x, fabricBottom + fabricHeight / 2, front - .075,
      width - .065, fabricHeight, .018, fabric);
    box(rooms, facade, opening.x, fabricBottom, front - .061,
      width - .06, .026, .029, fabric.clone().multiplyScalar(.67));
  }

  const dome = manifest.dome;
  if (dome && dome.profile.length && dome.profile[0][0] > 0) {
    const radius = dome.profile[0][0];
    // The source already includes 64 central panel strips and two continuous
    // moldings. Add only their paired narrow ribs and the five small pendants
    // visible under each strip in the local front/oblique photographs.
    for (let i = 0; i < 64; i++) {
      const angle = i * Math.PI * 2 / 64;
      const facade:Facade = {center:[dome.center[0], 0, dome.center[1]],
        normal:[Math.sin(angle), 0, Math.cos(angle)], glassDepth:0, openings:[]};
      for (const side of [-1, 1]) box(relief, facade, side * .135, 34.7,
        radius + .083, .055, 1.035, .145, stone);
      for (let j = -2; j <= 2; j++) box(drops, facade, j * .071, 33.975,
        radius + .128, 1, 1, 1, stone);
    }
  }

  const unit = new BoxGeometry(1, 1, 1), matrix = new Matrix4();
  const rotation = new Quaternion(), up = new Vector3(0, 1, 0);
  const roomMaterial = new MeshStandardMaterial({color:'white', roughness:.96});
  roomMaterial.name = 'architecturalRoom';
  const shadeMaterial = new MeshStandardMaterial({color:'white', roughness:1});
  shadeMaterial.name = 'architecturalShade';
  const stoneMaterial = new MeshStandardMaterial({color:'white', roughness:.86});
  stoneMaterial.name = 'architecturalRelief';

  function batch(name:string, instances:Instance[], material:MeshStandardMaterial, geometry:BufferGeometry = unit) {
    if (!instances.length) return;
    const mesh = new InstancedMesh(geometry, material, instances.length);
    mesh.name = name;
    mesh.userData.collision = 'none';
    mesh.castShadow = name.startsWith('drum');
    mesh.receiveShadow = true;
    instances.forEach((instance, index) => {
      rotation.setFromAxisAngle(up, instance.angle);
      matrix.compose(instance.position, rotation, instance.size);
      mesh.setMatrixAt(index, matrix);
      mesh.setColorAt(index, instance.color);
    });
    mesh.computeBoundingBox();mesh.computeBoundingSphere();
    detail.add(mesh);
  }
  batch('window-cavity-returns', rooms, roomMaterial);
  batch('partly-raised-window-shades', shades, shadeMaterial);
  batch('drum-paired-relief', relief, stoneMaterial);
  if (drops.length) batch('drum-guttae', drops, stoneMaterial, new CylinderGeometry(.035, .026, .085, 5));
  if (!rooms.length) roomMaterial.dispose();
  if (!shades.length) shadeMaterial.dispose();
  if (!relief.length && !drops.length) stoneMaterial.dispose();
  if (!rooms.length && !shades.length && !relief.length) unit.dispose();

  // Preserve the existing reflection/pane shader; its former 72% opaque blue
  // surface hid all cavity depth. Neutral glazing reveals the shaded rooms.
  source.traverse(object => {
    if (!(object instanceof Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!(material instanceof MeshStandardMaterial) || material.name !== 'courtyardGlass') continue;
      material.color.set('#86928d');
      material.opacity = .41;
      material.roughness = .20;
      material.metalness = .08;
      material.transparent = true;
      material.depthWrite = false;
      material.needsUpdate = true;
    }
  });
  detail.userData.architecturalDetail = {windows, shades:shades.length, batches:detail.children.length,
    source:'Local MIT reference photographs; shade positions and interior finishes are illustrative'};
  return detail;
}
