import {useEffect, useRef, useState, type ReactNode} from 'react';
import {useFrame} from '@react-three/fiber';
import {
  AnimationMixer, BufferGeometry, CatmullRomCurve3, Color, DoubleSide, ExtrudeGeometry, Float32BufferAttribute,
  Group, Mesh, MeshToonMaterial, Shape, SkinnedMesh, TubeGeometry, Vector3,
  type AnimationAction, type AnimationClip, type Material, type MeshStandardMaterial, type Skeleton,
} from 'three';
import {GLTFLoader, type GLTF} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {clone} from 'three/examples/jsm/utils/SkeletonUtils.js';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {RoundedBoxGeometry} from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {toonGradient} from './scene-assets';

// The existing Renderpeople source remains an immutable, local evaluation asset.
// Source and web-distribution limits: public/assets/people/ATTRIBUTION.md.
let sourcePromise: Promise<GLTF> | null = null;
function studentSource() {
  if (!sourcePromise) {
    sourcePromise = fetch('/assets/people/nathan.glb').then(response => {
      if (!response.ok) throw new Error(`Student asset: ${response.status}`);
      return response.arrayBuffer();
    }).then(bytes => new GLTFLoader().parseAsync(bytes, '/assets/people/'));
    void sourcePromise.catch(() => {sourcePromise = null;});
  }
  return sourcePromise;
}

type StudentInstance = {
  scene: Group; mixer: AnimationMixer; clips: AnimationClip[]; action: AnimationAction | null;
  materials: Set<Material>; geometries: Set<BufferGeometry>; skeletons: Set<Skeleton>;
  palette: {value: Color}; dispose(): void;
};

function makePaintedMaterial(source: MeshStandardMaterial, palette: {value: Color}, gradient: ReturnType<typeof toonGradient>) {
  // Keep the artist's garment seams, facial features and shoes. Removing the
  // scan's pore-scale normal map and compressing albedo gives broad painted tones.
  const material = new MeshToonMaterial({map: source.map, color: '#ffffff', gradientMap: gradient});
  material.name = 'Student · painted cloth and skin';
  material.onBeforeCompile = shader => {
    shader.uniforms.studentPalette = palette;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vStudentBody;');
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvStudentBody = position.xy;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 studentPalette;\nvarying vec2 vStudentBody;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      #include <map_fragment>
      // The light neutral shirt is distinct from warm skin and dark denim.
      // The bind-pose mask prevents the palette from tinting faces or shoes.
      float shirt = smoothstep(0.94, 1.02, vStudentBody.y)
        * (1.0 - smoothstep(1.62, 1.68, vStudentBody.y))
        * (1.0 - smoothstep(0.46, 0.55, abs(vStudentBody.x)))
        * (1.0 - smoothstep(0.012, 0.065, diffuseColor.r - diffuseColor.b));
      float clothLight = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
      diffuseColor.rgb = mix(diffuseColor.rgb, studentPalette * (0.74 + clothLight * 0.66), shirt * 0.93);
      float trousers = smoothstep(.18,.26,vStudentBody.y) * (1.0-smoothstep(.95,1.04,vStudentBody.y));
      vec3 cloth = vec3(.055,.077,.090) * (.8 + clothLight * 1.6);
      diffuseColor.rgb = mix(diffuseColor.rgb, cloth, trousers * .83);
      vec3 paint = floor(sqrt(max(diffuseColor.rgb, vec3(0.0))) * 12.0 + 0.5) / 12.0;
      diffuseColor.rgb = mix(diffuseColor.rgb, paint * paint, 0.65);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.32, 0.34, 0.30), 0.055);
    `);
  };
  material.customProgramCacheKey = () => 'painted-student-v2';
  return material;
}

function strapGeometry(points: number[][], width: number) {
  const curve = new CatmullRomCurve3(points.map(point => new Vector3(...point as [number, number, number])));
  const positions: number[] = [], indices: number[] = [];
  const steps = 22;
  for (let i = 0; i <= steps; i++) {
    const point = curve.getPoint(i / steps);
    positions.push(point.x - width / 2, point.y, point.z, point.x + width / 2, point.y, point.z);
    if (i < steps) {const n = i * 2; indices.push(n, n + 1, n + 2, n + 1, n + 3, n + 2);}
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

function makeBackpack(gradient: ReturnType<typeof toonGradient>, materials: Set<Material>, geometries: Set<BufferGeometry>) {
  const group = new Group(); group.name = 'Student · canvas daypack';
  const batches = new Map<MeshToonMaterial, BufferGeometry[]>();
  const make = (color: string) => {const material = new MeshToonMaterial({color, gradientMap: gradient}); materials.add(material); batches.set(material, []); return material;};
  const canvas = make('#59635c'), edging = make('#363f3a'), pocket = make('#657066'), leather = make('#b6a080'), metal = make('#a9aca0');
  edging.side = DoubleSide;
  const box = (size: [number, number, number], position: [number, number, number], radius: number, material: MeshToonMaterial) => {
    const geometry = new RoundedBoxGeometry(...size, 2, radius);
    geometry.translate(...position); batches.get(material)!.push(geometry);
  };
  const outline = new Shape();
  outline.moveTo(-.113,1.095);
  outline.quadraticCurveTo(-.149,1.095,-.149,1.14);
  outline.lineTo(-.142,1.36);
  outline.bezierCurveTo(-.136,1.535,.128,1.535,.142,1.36);
  outline.lineTo(.149,1.14);
  outline.quadraticCurveTo(.149,1.095,.113,1.095);
  outline.closePath();
  const shell = new ExtrudeGeometry(outline,{depth:.145,steps:1,bevelEnabled:true,bevelThickness:.018,bevelSize:.016,bevelSegments:3,curveSegments:10});
  shell.translate(0,0,-.30); batches.get(canvas)!.push(shell);
  // Curved upper zipper and a rounded lower pocket break up the soft pack.
  const zipper = new CatmullRomCurve3([new Vector3(-.123,1.25,-.32),new Vector3(-.118,1.39,-.32),new Vector3(0,1.465,-.32),new Vector3(.118,1.39,-.32),new Vector3(.123,1.25,-.32)]);
  batches.get(edging)!.push(new TubeGeometry(zipper,32,.003,5,false));
  box([.246, .136, .065], [0, 1.18, -.318], .039, pocket);
  box([.219, .006, .004], [0, 1.227, -.355], .002, edging);
  box([.015, .026, .008], [.09, 1.214, -.36], .002, metal);
  box([.034, .027, .006], [0, 1.179, -.354], .004, leather);
  box([.096, .028, .043], [0, 1.495, -.167], .012, edging);
  for (const side of [-1, 1]) {
    // Shoulder straps wrap around the torso, not two flat bars on the shirt.
    const points = [
      [side * .17, 1.08, .121], [side * .154, 1.29, .152],
      [side * .184, 1.50, .075], [side * .173, 1.559, -.023],
      [side * .128, 1.465, -.133],
    ];
    const strap = strapGeometry(points, .046);
    batches.get(edging)!.push(strap);
    box([.061, .063, .052], [side * .163, 1.153, .124], .008, edging);
    box([.044, .027, .01], [side * .163, 1.158, .154], .004, metal);
    box([.045, .118, .075], [side * .153, 1.175, -.223], .018, pocket);
    box([.011, .05, .011], [side * .123, 1.064, -.279], .003, leather);
  }
  for (const [material, parts] of batches) {
    // Authored backpack details cost five draw calls for each player.
    const normalized = parts.map(part => {
      const result = part.index ? part.toNonIndexed() : part.clone();
      result.deleteAttribute('uv'); return result;
    });
    const geometry = mergeGeometries(normalized);
    parts.forEach(part => part.dispose()); normalized.forEach(part => part.dispose());
    if (!geometry) continue;
    const mesh = new Mesh(geometry, material); mesh.castShadow = true; mesh.receiveShadow = true;
    geometries.add(geometry); group.add(mesh);
  }
  return group;
}

function createStudent(source: GLTF, color: string): StudentInstance {
  const scene = clone(source.scene) as Group;
  const materials = new Set<Material>(), geometries = new Set<BufferGeometry>(), skeletons = new Set<Skeleton>();
  const gradient = toonGradient(), palette = {value: new Color(color)};
  scene.name = 'StudentAvatar · painted rig';
  scene.traverse(object => {
    if (object instanceof Mesh) {
      const originals = Array.isArray(object.material) ? object.material : [object.material];
      const painted = originals.map(original => {const material = makePaintedMaterial(original as MeshStandardMaterial, palette, gradient); materials.add(material); return material;});
      object.material = Array.isArray(object.material) ? painted : painted[0];
      object.castShadow = true; object.receiveShadow = true;
    }
    if (object instanceof SkinnedMesh) {skeletons.add(object.skeleton); object.frustumCulled = false;}
  });
  const mixer = new AnimationMixer(scene);
  // Evaluate an actual pose before binding the daypack to the upper spine.
  const idle = source.animations.find(clip => /idle/i.test(clip.name));
  const action = idle ? mixer.clipAction(idle).play() : null;
  mixer.update(0); scene.updateMatrixWorld(true);
  const backpack = makeBackpack(gradient, materials, geometries);
  scene.add(backpack); scene.updateMatrixWorld(true);
  const spine = scene.getObjectByName('rp_nathan_animated_003_walking_spine_03');
  if (spine) spine.attach(backpack);
  scene.userData.studentAvatar = {ready: true, source: 'nathan', clip: idle?.name ?? null};
  return {
    scene, mixer, clips: source.animations, action, materials, geometries, skeletons, palette,
    dispose() {
      mixer.stopAllAction(); mixer.uncacheRoot(scene);
      skeletons.forEach(skeleton => skeleton.dispose());
      materials.forEach(material => material.dispose());
      geometries.forEach(geometry => geometry.dispose()); gradient.dispose();
      // Source mesh data, animations and albedo textures are shared read-only.
    },
  };
}

export function PaintedStudent({color, walking, running, fallback}: {color: string; walking: boolean; running: boolean; fallback: ReactNode}) {
  const [instance, setInstance] = useState<StudentInstance | null>(null);
  const live = useRef({color, walking, running}); live.current = {color, walking, running};
  useEffect(() => {
    let cancelled = false, owned: StudentInstance | null = null;
    void studentSource().then(source => {
      if (cancelled) return;
      owned = createStudent(source, live.current.color); setInstance(owned);
    }).catch(() => {/* Preserve a visible, movable fallback when the local asset is unavailable. */});
    return () => {cancelled = true; owned?.dispose();};
  }, []);
  useEffect(() => {instance?.palette.value.set(color);}, [instance, color]);
  useEffect(() => {
    if (!instance) return;
    const clip = instance.clips.find(candidate => (walking ? /walk/i : /idle/i).test(candidate.name));
    if (!clip || instance.action?.getClip() === clip) return;
    const previous = instance.action;
    const next = instance.mixer.clipAction(clip).reset().setEffectiveWeight(1).play();
    if (previous) {previous.fadeOut(.22); next.fadeIn(.22);}
    instance.action = next; instance.scene.userData.studentAvatar.clip = clip.name;
  }, [instance, walking]);
  useFrame((_, delta) => {
    if (!instance || document.hidden) return;
    instance.mixer.timeScale = walking ? (running ? 2.05 : 1.42) : 1;
    instance.mixer.update(Math.min(delta, .05));
  });
  return instance ? <primitive object={instance.scene} dispose={null}/> : fallback;
}
