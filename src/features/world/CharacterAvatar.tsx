import {useEffect, useRef, useState} from 'react';
import {useFrame} from '@react-three/fiber';
import {AnimationMixer, Box3, Group, Material, Mesh, MeshToonMaterial, SkinnedMesh, Texture, type AnimationAction, type BufferGeometry, type Skeleton} from 'three';
import {GLTFLoader, type GLTF} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {clone} from 'three/examples/jsm/utils/SkeletonUtils.js';
import {toonGradient} from './scene-assets';
import {characterCandidate, type CharacterId, type CharacterMotion} from './character-catalog';
import {isMobileWorld} from './mobile-device';
import {createCharacterRidingPose} from './character-riding-pose';
import type {RideMode} from './commute-vehicle-model';

// Avatars share source geometry/textures while mounted and own their bones,
// mixers and converted materials. Only the small entry sources stay cached.
// R3F must not dispose assets that another mounted avatar is still using.
type CharacterSource = {promise: Promise<GLTF>; users: number; retired: boolean; phase:'fetch'|'decode'|'ready'; source?: GLTF; controller: AbortController};
const sources = new Map<string, CharacterSource>();
const geometryUsers = new WeakMap<BufferGeometry, number>();
function disposeSource(source: GLTF) {
  const textures=new Set<Texture>(),materials=new Set<Material>(),geometries=new Set<BufferGeometry>();
  source.scenes.forEach(scene=>scene.traverse(object=>{
    if(!(object instanceof Mesh))return;
    geometries.add(object.geometry);
    (Array.isArray(object.material)?object.material:[object.material]).forEach(material=>materials.add(material));
  }));
  materials.forEach(material=>{
    Object.values(material).forEach(value=>{if(value instanceof Texture)textures.add(value);});
    material.dispose();
  });
  const images=new Set<{close?:()=>void}>();
  textures.forEach(texture=>{images.add(texture.source.data);texture.dispose();});
  images.forEach(image=>image?.close?.());
  geometries.forEach(geometry=>geometry.dispose());
}
function acquireSource(url: string) {
  let entry = sources.get(url);
  if (!entry) {
    const controller=new AbortController();
    const created:CharacterSource={promise:null!,users:0,retired:false,phase:'fetch',controller};
    let timeout=0;
    const loading=fetch(url,{signal:controller.signal}).then(async response=>{
      if(!response.ok)throw new Error(`模型读取失败（${response.status}）`);
      const bytes=await response.arrayBuffer();
      controller.signal.throwIfAborted();created.phase='decode';
      return new GLTFLoader().parseAsync(bytes,url.slice(0,url.lastIndexOf('/')+1));
    }).then(source=>{
      created.phase='ready';
      // A cancelled HD switch may finish decoding after its last user leaves.
      if(created.retired||created.users===0&&url.includes('/characters/mobile-hd/')){
        disposeSource(source);created.retired=true;
        if(sources.get(url)===created)sources.delete(url);
        throw new Error('人物加载已取消。');
      }
      created.source=source;
      return source;
    },error=>{created.phase='ready';if(sources.get(url)===created)sources.delete(url);throw error;});
    // Include texture decoding in the deadline: aborting fetch alone would
    // leave a stalled GLTF parse cached and make every retry wait on it again.
    const deadline=new Promise<GLTF>((_,reject)=>{
      timeout=window.setTimeout(()=>{controller.abort();reject(new Error('人物加载超时，请检查网络后重试。'));},60000);
    });
    created.promise=Promise.race([loading,deadline]).finally(()=>clearTimeout(timeout));
    entry=created;sources.set(url,created);
    void created.promise.catch(()=>{
      created.retired=true;
      // A timed-out parse cannot be aborted. Keep its rejected promise until
      // it settles so a retry cannot start a second simultaneous HD decode.
      if(created.phase!=='decode'&&sources.get(url)===created)sources.delete(url);
    });
  }
  entry.users++;
  const retained=entry;let released=false;
  return {promise:retained.promise,release(){
    if(released)return;released=true;retained.users--;
    // Keep the small entry avatars warm, but release HD CPU images, textures
    // and geometry when downgrading or leaving. No hidden HD cache accumulates.
    if(retained.users===0&&url.includes('/characters/mobile-hd/')){
      // Reuse an in-flight parse if HD is requested again. Only its eventual
      // completion may release decoded images; AbortController stops fetch only.
      if(retained.phase==='decode')return;
      if(sources.get(url)===retained)sources.delete(url);
      retained.retired=true;retained.controller.abort();
      if(retained.source){disposeSource(retained.source);retained.source=undefined;}
    }
  }};
}

function createCharacter(gltf: GLTF, facing: number) {
  const scene = clone(gltf.scene);
  scene.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(scene, true);
  const height = bounds.max.y - bounds.min.y;
  if (!Number.isFinite(height) || height <= 0) throw new Error('角色模型没有有效尺寸。');
  const root = new Group();
  root.name = 'campus-character';
  const scale = 1.75 / height;
  root.scale.setScalar(scale);
  root.position.y = -bounds.min.y * scale;
  root.rotation.y = facing;
  root.add(scene);
  const gradient = toonGradient();
  const materials = new Map<Material, MeshToonMaterial>();
  const skeletons = new Set<Skeleton>();
  const geometries = new Set<BufferGeometry>();
  const convert = (source: Material) => {
    const cached = materials.get(source);
    if (cached) return cached;
    const original = source as Material & Partial<MeshToonMaterial>;
    const material = new MeshToonMaterial({
      color: original.color, map: original.map ?? null,
      alphaMap: original.alphaMap ?? null, gradientMap: gradient,
    });
    // Preserve glTF alpha modes, sidedness and depth state (eyelashes and hair).
    Material.prototype.copy.call(material, source);
    material.gradientMap = gradient;
    material.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
        // Keep the bright campus sun from washing out painted face details.
        outgoingLight = diffuseColor.rgb * (vec3(0.32, 0.37, 0.43) + min(outgoingLight / max(diffuseColor.rgb, vec3(0.001)), vec3(1.7)) * 0.48);
        #include <opaque_fragment>
      `);
    };
    material.customProgramCacheKey = () => 'campus-character-toon-v1';
    materials.set(source, material);
    return material;
  };
  scene.traverse(object => {
    if (!(object instanceof Mesh)) return;
    geometries.add(object.geometry);
    object.material = Array.isArray(object.material) ? object.material.map(convert) : convert(object.material);
    object.castShadow = true;
    object.receiveShadow = true;
    if (object instanceof SkinnedMesh) {object.frustumCulled = false; skeletons.add(object.skeleton);}
  });
  const mixer = new AnimationMixer(scene);
  const actions = new Map<string, AnimationAction>();
  gltf.animations.forEach(clip => actions.set(clip.name, mixer.clipAction(clip)));
  const riding=createCharacterRidingPose(root,scene);
  geometries.forEach(geometry=>geometryUsers.set(geometry,(geometryUsers.get(geometry)??0)+1));
  let disposed=false;
  return {
    root, mixer, actions,riding,
    get disposed(){return disposed;},
    dispose() {
      if(disposed)return;
      disposed=true;
      mixer.stopAllAction(); mixer.uncacheRoot(scene);
      skeletons.forEach(skeleton => skeleton.dispose());
      materials.forEach(material => material.dispose()); gradient.dispose();
      // A cached geometry otherwise retains one morph-texture buffer per old
      // renderer through its dispose listeners. Release GPU state only after
      // its last avatar leaves; its source vertex data remains reusable.
      geometries.forEach(geometry=>{
        const users=(geometryUsers.get(geometry)??1)-1;
        if(users>0)geometryUsers.set(geometry,users);
        else{geometryUsers.delete(geometry);geometry.dispose();}
      });
      geometries.clear();
    },
  };
}
type CharacterInstance = ReturnType<typeof createCharacter>;

export function CharacterAvatar({id = 'pixiv', motion = 'Idle', quality = 'low', ride,onReady, onError}: {
  id?: CharacterId; motion?: CharacterMotion; quality?: 'standard'|'low'; ride?:RideMode;onReady?: () => void; onError?: (message: string) => void;
}) {
  const candidate = characterCandidate(id);
  const [mobile]=useState(isMobileWorld);
  const url=mobile&&id!=='hiyori'?`/assets/characters/${quality==='standard'?'mobile-hd':'mobile'}/${id}.glb`:candidate.url;
  const [instance, setInstance] = useState<CharacterInstance | null>(null);
  const callbacks = useRef({onReady, onError}); callbacks.current = {onReady, onError};
  useEffect(() => {
    let cancelled = false, owned: CharacterInstance | null = null;
    setInstance(null);
    if (!url) {callbacks.current.onError?.('该候选模型尚未导入。'); return;}
    const retained=acquireSource(url);
    void retained.promise.then(source => {
      if (cancelled) return;
      owned = createCharacter(source, candidate.facing);
      setInstance(owned); callbacks.current.onReady?.();
    }).catch(error => {if (!cancelled) callbacks.current.onError?.(`人物加载失败：${error instanceof Error ? error.message : String(error)}`);});
    return () => {cancelled = true; owned?.dispose();retained.release();};
  }, [candidate.facing,url]);
  useEffect(() => {
    // React can retain the old instance for one render while its replacement
    // loads (including fast refresh). Never reactivate an uncached action.
    if (!instance || instance.disposed) return;
    if(!ride)instance.riding.reset();
    const next = instance.actions.get(ride?'Seated':motion) ?? instance.actions.get('Idle');
    if (!next) return;
    instance.actions.forEach(action => {if (action !== next) action.fadeOut(.2);});
    next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(.2).play();
  }, [instance, motion,ride]);
  useFrame(({clock}, delta) => {
    if (!instance || instance.disposed) return;
    instance.riding.restore();
    instance.mixer.update(Math.min(delta, .05));
    if(ride)instance.riding.apply(ride,clock.elapsedTime);
    if (import.meta.env.DEV) {
      instance.root.userData.motion = motion;
      instance.root.userData.characterId = id;
    }
  });
  return instance ? <primitive object={instance.root} dispose={null}/> : null;
}
